"""
generate_local_cert.py
-----------------------
Creates a self-signed HTTPS certificate for local development
(cert.pem + key.pem, valid for 127.0.0.1 and localhost).

Why: some antivirus / "safe browsing" software silently blocks password
form submissions sent over plain HTTP as a phishing/data-loss-prevention
safeguard. Since GET requests were working fine and only POST /api/login
was hanging, that's almost certainly what's happening here. Running the
dev server over HTTPS (even a self-signed one) sidesteps that.

Run once:
    python generate_local_cert.py

Then start the server with:
    python -m uvicorn main:app --reload --ssl-keyfile=key.pem --ssl-certfile=cert.pem

And visit https://127.0.0.1:8000 (not http://) — your browser will warn
"Your connection isn't private" because the certificate is self-signed,
not because anything is actually wrong. Click "Advanced" -> "Proceed to
127.0.0.1 (unsafe)" (Chrome/Edge wording). You only need to do that once
per browser profile.

cert.pem and key.pem are gitignored — never commit a private key, even a
throwaway local one.
"""

import datetime
import ipaddress

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

KEY_PATH = "key.pem"
CERT_PATH = "cert.pem"

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1"),
])

cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(issuer)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
    .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=825))
    .add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        ]),
        critical=False,
    )
    .sign(key, hashes.SHA256())
)

with open(KEY_PATH, "wb") as f:
    f.write(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ))

with open(CERT_PATH, "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))

print(f"Created {CERT_PATH} and {KEY_PATH} — valid for 127.0.0.1 and localhost, 825 days.")
print("Start the server with:")
print("  python -m uvicorn main:app --reload --ssl-keyfile=key.pem --ssl-certfile=cert.pem")
print("Then visit: https://127.0.0.1:8000")
