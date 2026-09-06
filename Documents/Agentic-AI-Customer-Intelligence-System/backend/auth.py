"""
auth.py
-------
Two ways to sign in:

  1. Email + password — register-on-first-use. The first login with a new
     email saves that email + a securely hashed password; every login after
     that must match, or it's rejected.

  2. "Sign in with Google" — the frontend gets a signed ID token from
     Google's Identity Services library and sends it here. We verify that
     token really came from Google (via GOOGLE_CLIENT_ID below), and since
     Google has already confirmed the person owns that email, we sign them
     straight in — creating the account on first use, same as method 1.

Both methods land in the same USERS store and issue the same kind of
session cookie, so the rest of the app doesn't need to know which one
someone used.

Setup required for Google Sign-In (see README for full steps):
  1. Create an OAuth Client ID at https://console.cloud.google.com/
  2. Put it in backend/.env as GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
  Until that's set, the Google button simply won't appear — email/password
  login keeps working either way.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import time
from typing import Optional

from fastapi import APIRouter, Request, Response, HTTPException
from pydantic import BaseModel
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

router = APIRouter()

COOKIE_NAME = "agentic_session"
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60  # sessions last 7 days
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

USERS_FILE = os.path.join(os.path.dirname(__file__), "users_store.json")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()

SESSIONS: dict[str, dict] = {}


# ---------------------------------------------------------------- storage --
def _load_users() -> dict:
    if not os.path.exists(USERS_FILE):
        return {}
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_users(users: dict) -> None:
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)


# email -> {"auth_method": "password"|"google", "salt":, "hash":, "created_at":}
USERS: dict = _load_users()


# ------------------------------------------------------------- password ---
def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000).hex()


def _register_password(email: str, password: str) -> None:
    salt = secrets.token_bytes(16)
    USERS[email] = {
        "auth_method": "password",
        "salt": salt.hex(),
        "hash": _hash_password(password, salt),
        "created_at": time.time(),
    }
    _save_users(USERS)


def _verify_password(email: str, password: str) -> bool:
    record = USERS.get(email)
    if not record or record.get("auth_method") != "password":
        return False
    salt = bytes.fromhex(record["salt"])
    return hmac.compare_digest(_hash_password(password, salt), record["hash"])


def _register_google(email: str) -> None:
    USERS[email] = {"auth_method": "google", "created_at": time.time()}
    _save_users(USERS)


# ---------------------------------------------------------------- session --
def _session(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    record = SESSIONS.get(token)
    if record is None:
        return None
    if record["expiry"] < time.time():
        SESSIONS.pop(token, None)
        return None
    return record


def is_authenticated(request: Request) -> bool:
    return _session(request.cookies.get(COOKIE_NAME)) is not None


def current_email(request: Request) -> Optional[str]:
    record = _session(request.cookies.get(COOKIE_NAME))
    return record["email"] if record else None


def _start_session(email: str, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = {"email": email, "expiry": time.time() + SESSION_TTL_SECONDS}
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        path="/",
    )


# ------------------------------------------------------------------ routes -
class LoginRequest(BaseModel):
    email: str
    password: str


class GoogleLoginRequest(BaseModel):
    credential: str  # the ID token from Google Identity Services


@router.get("/api/config")
async def public_config():
    # Safe to expose: an OAuth Client ID is not a secret, it's meant to be
    # visible in frontend code. Frontend uses this to decide whether to
    # render the Google button at all.
    return {"google_client_id": GOOGLE_CLIENT_ID}


@router.post("/api/login")
async def login(req: LoginRequest, response: Response):
    email = req.email.strip().lower()
    password = req.password

    if not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")

    existing = USERS.get(email)
    if existing and existing.get("auth_method") == "google":
        raise HTTPException(
            status_code=400,
            detail="This email is registered with Google Sign-In. Use the Google button instead.",
        )

    if not existing:
        _register_password(email, password)
        _start_session(email, response)
        return {"success": True, "email": email, "new_account": True}

    if not _verify_password(email, password):
        raise HTTPException(status_code=401, detail="Incorrect password for this email.")

    _start_session(email, response)
    return {"success": True, "email": email, "new_account": False}


@router.post("/api/login/google")
async def login_google(req: GoogleLoginRequest, response: Response):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="Google Sign-In isn't configured on the server (missing GOOGLE_CLIENT_ID in .env).",
        )

    try:
        payload = google_id_token.verify_oauth2_token(
            req.credential, google_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Could not verify Google sign-in. Please try again.")

    if not payload.get("email_verified", False):
        raise HTTPException(status_code=401, detail="Your Google email isn't verified.")

    email = payload["email"].strip().lower()

    if email not in USERS:
        _register_google(email)

    _start_session(email, response)
    return {"success": True, "email": email}


@router.post("/api/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        SESSIONS.pop(token, None)
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"success": True}


@router.get("/api/session")
async def session_status(request: Request):
    record = _session(request.cookies.get(COOKIE_NAME))
    return {"authenticated": record is not None, "email": record["email"] if record else None}
