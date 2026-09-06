"""
agent.py
--------
This is the "agentic" part of the project.

Instead of just stuffing the whole CSV into a prompt, the LLM is given a TOOL
(run_pandas_query) that lets it execute real pandas code against the uploaded
dataframe. The model decides what to run, sees the result, and can run more
queries before giving a final answer. That loop (think -> act -> observe ->
think again) is what makes this "agentic" rather than a plain chatbot.
"""

import os
import re
import json
import pandas as pd
import numpy as np
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL_NAME = "openai/gpt-oss-120b"  # supports tool/function calling on Groq
# Note: llama-3.3-70b-versatile was Groq's recommended default here, but Groq
# fully decommissioned it on August 16, 2026 (announced June 17, 2026).
# openai/gpt-oss-120b is Groq's official migration recommendation — same
# tool-calling support, comparable quality, faster inference.
# See: https://console.groq.com/docs/deprecations

client = Groq(api_key=GROQ_API_KEY, timeout=30.0, max_retries=2) if GROQ_API_KEY else None

# ---------------------------------------------------------------------------
# Safety: only allow simple, read-only pandas EXPRESSIONS (not statements).
# This blocks imports, file access, and other dangerous calls.
# ---------------------------------------------------------------------------
BLOCKED_PATTERNS = [
    "import", "__", "open(", "exec(", "eval(", "os.", "sys.", "subprocess",
    "shutil", "requests", "socket", "input(", "globals(", "locals(",
    "compile(", "getattr(", "setattr(", "delattr(", ".to_csv(", ".to_excel(",
    ".to_pickle(", "write", "os,", "sys,",
]


def is_expression_safe(expr: str) -> bool:
    lowered = expr.lower()
    return not any(bad in lowered for bad in BLOCKED_PATTERNS)


def run_pandas_query(df: pd.DataFrame, expression: str) -> str:
    """Safely evaluate a single pandas expression against `df` and return
    a short string representation of the result."""
    if not is_expression_safe(expression):
        return "Error: expression rejected for safety reasons."

    safe_globals = {"__builtins__": {}}
    safe_locals = {"df": df, "pd": pd, "np": np}

    try:
        result = eval(expression, safe_globals, safe_locals)  # noqa: S307 (sandboxed)
    except Exception as e:
        return f"Error running expression: {e}"

    # Keep the result compact so it doesn't blow up the context window
    if isinstance(result, (pd.DataFrame, pd.Series)):
        text = result.head(20).to_string()
    else:
        text = str(result)

    return text[:2000]


def generate_chart_data(df: pd.DataFrame, chart_type: str, column_x: str, column_y: str = None, aggregation: str = "count") -> dict:
    """Builds Chart.js-ready data from the dataframe based on what the agent
    decided to visualize. Used by the create_chart tool so the assistant can
    respond to things like 'show me income vs spending score' with an actual
    rendered chart, not just a text description."""
    if column_x not in df.columns:
        return {"error": f"Column '{column_x}' not found."}

    chart_type = chart_type if chart_type in ("bar", "pie", "line") else "bar"

    if column_y and column_y in df.columns and aggregation != "count":
        grouped = df.groupby(column_x)[column_y]
        if aggregation == "mean":
            series = grouped.mean()
        elif aggregation == "sum":
            series = grouped.sum()
        else:
            series = grouped.count()
        series = series.sort_values(ascending=False).head(15)
        label = f"{aggregation} of {column_y} by {column_x}"
    elif pd.api.types.is_numeric_dtype(df[column_x]):
        counts, bins = np.histogram(df[column_x].dropna(), bins=8)
        return {
            "type": "bar",
            "label": column_x,
            "labels": [f"{round(bins[i],1)}-{round(bins[i+1],1)}" for i in range(len(bins) - 1)],
            "values": counts.tolist(),
        }
    else:
        series = df[column_x].value_counts().head(10)
        label = column_x

    return {
        "type": chart_type,
        "label": label,
        "labels": [str(x) for x in series.index],
        "values": [round(float(v), 2) for v in series.values],
    }


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_pandas_query",
            "description": (
                "Execute a single-line, read-only pandas expression against the "
                "uploaded dataframe (variable name `df`) and return the result. "
                "Use this for counts, means, filters, groupby, value_counts, "
                "correlations, etc. Only one expression per call."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": (
                            "A single pandas/python expression using `df`. "
                            "Examples: df['age'].mean() | "
                            "df[df['city']=='Delhi'].shape[0] | "
                            "df.groupby('category')['sales'].sum()"
                        ),
                    }
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_chart",
            "description": (
                "Generate a chart from the dataframe to visually answer requests like "
                "'show me X vs Y' or 'chart the distribution of X'. Renders inline in the "
                "chat for the user. Use this INSTEAD OF run_pandas_query when the user "
                "explicitly wants to see/visualize something rather than get a number."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "chart_type": {"type": "string", "enum": ["bar", "pie", "line"]},
                    "column_x": {"type": "string", "description": "Main column to chart (categories, or a numeric column to histogram)"},
                    "column_y": {"type": "string", "description": "Optional numeric column to aggregate per group in column_x"},
                    "aggregation": {"type": "string", "enum": ["count", "mean", "sum"], "description": "How to aggregate column_y per group. Defaults to count."},
                },
                "required": ["chart_type", "column_x"],
            },
        },
    },
]


MAX_COLUMNS_LISTED = 40
MAX_VALUE_LENGTH = 60
MAX_PREVIEW_CHARS = 2500


def _truncate(val, limit=MAX_VALUE_LENGTH):
    s = str(val)
    return s if len(s) <= limit else s[:limit] + "..."


def build_system_prompt(df: pd.DataFrame) -> str:
    columns_info = []
    columns_to_show = list(df.columns[:MAX_COLUMNS_LISTED])

    for col in columns_to_show:
        dtype = str(df[col].dtype)
        sample_vals = [_truncate(v) for v in df[col].dropna().unique()[:5].tolist()]
        columns_info.append(f"- {col} ({dtype}) e.g. {sample_vals}")

    if len(df.columns) > MAX_COLUMNS_LISTED:
        remaining = len(df.columns) - MAX_COLUMNS_LISTED
        columns_info.append(f"... and {remaining} more columns (use df.columns to see all of them)")

    # Truncate long text cells before stringifying the preview, and cap the
    # overall preview length, so a few huge text fields (reviews, comments,
    # descriptions...) can't blow up the prompt on their own.
    preview_df = df.head(5).copy()
    for col in preview_df.select_dtypes(include="object").columns:
        preview_df[col] = preview_df[col].apply(_truncate)
    preview = preview_df.to_string()
    if len(preview) > MAX_PREVIEW_CHARS:
        preview = preview[:MAX_PREVIEW_CHARS] + "\n... (truncated)"

    return f"""You are Agentic AI Assistant, a data analysis agent.
You have access to a pandas dataframe called `df` loaded from a user-uploaded CSV.
The full dataset has {df.shape[0]} rows and {df.shape[1]} columns (more than what's
listed below if it was truncated) — use the run_pandas_query tool to inspect
anything not shown here, rather than assuming.

Columns:
{chr(10).join(columns_info)}

Sample rows:
{preview}

Rules:
- To answer questions with numbers/facts, call `run_pandas_query` with a pandas expression on `df`.
- If the user wants to SEE something (a chart, a distribution, "X vs Y"), call `create_chart` instead — don't describe a chart in words when you can render one.
- You may call tools multiple times if needed before answering.
- Once you have enough information, give a clear, concise final answer in plain English.
- Do not make up numbers — always verify with a tool.
- If asked to explain why a specific row/record is unusual, compare its values to df.describe() and column means/stds for context, and explain in plain English.
- If a question can't be answered from this dataset, say so honestly.
"""


def ask_agent(df: pd.DataFrame, question: str, prior_history: list = None, max_steps: int = 5) -> dict:
    """Runs the think -> act -> observe loop and returns the final answer,
    a trace of what the agent did, and a chart payload if it generated one.
    `prior_history` (a list of {"role","content"} dicts) lets follow-up
    questions like "what about column X?" refer back to earlier turns."""

    if client is None:
        return {
            "answer": "Server is missing GROQ_API_KEY. Add it to backend/.env and restart.",
            "trace": [],
            "chart": None,
        }

    messages = [{"role": "system", "content": build_system_prompt(df)}]
    if prior_history:
        messages.extend(prior_history)
    messages.append({"role": "user", "content": question})

    trace = []
    chart_payload = None
    tool_use_retries = 0
    MAX_TOOL_USE_RETRIES = 2

    # Matches Groq's occasional malformed output: <function=name{"arg": "val"}></function>
    MALFORMED_CALL_RE = re.compile(r"<function=(\w+)\s*(\{.*?\})\s*(?:</function>|$)", re.DOTALL)

    def dispatch_tool(name: str, args: dict) -> str:
        """Runs the requested tool and returns a short string for the model.
        Chart payloads are captured in the enclosing scope, not returned
        here, since the full chart data shouldn't go back into the prompt."""
        nonlocal chart_payload
        if name == "create_chart":
            result = generate_chart_data(
                df,
                chart_type=args.get("chart_type", "bar"),
                column_x=args.get("column_x", ""),
                column_y=args.get("column_y"),
                aggregation=args.get("aggregation", "count"),
            )
            if "error" in result:
                return f"Error: {result['error']}"
            chart_payload = result
            return f"Chart generated: {result['type']} chart of {result['label']} with {len(result['labels'])} data points. It will render for the user automatically."
        else:
            expr = args.get("expression", "")
            result = run_pandas_query(df, expr)
            trace.append({"expression": expr, "result": result})
            return result

    for _ in range(max_steps):
        try:
            response = client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.2,
                parallel_tool_calls=False,
            )
        except Exception as e:
            # Groq's Llama models occasionally emit a malformed function call
            # like <function=run_pandas_query{"expression": "..."}></function>
            # instead of a proper structured tool call. The API rejects this
            # as "tool_use_failed" — but the intended call is right there in
            # the error body, so we can recover instead of just failing.
            body = getattr(e, "body", None)
            failed_generation = ""
            if isinstance(body, dict):
                failed_generation = body.get("error", {}).get("failed_generation", "") or ""

            match = MALFORMED_CALL_RE.search(failed_generation)
            if match and match.group(1) in ("run_pandas_query", "create_chart"):
                try:
                    args = json.loads(match.group(2))
                    tool_result = dispatch_tool(match.group(1), args)
                    messages.append({"role": "assistant", "content": failed_generation})
                    messages.append({"role": "user", "content": f"Tool result:\n{tool_result}"})
                    continue
                except (json.JSONDecodeError, Exception):
                    pass  # fall through to retry/error handling below

            is_tool_use_glitch = "tool_use_failed" in str(e)
            if is_tool_use_glitch and tool_use_retries < MAX_TOOL_USE_RETRIES:
                tool_use_retries += 1
                continue

            error_text = str(e).lower()
            if "context_length" in error_text or "too large" in error_text or "request too large" in error_text:
                answer = (
                    "This dataset has too many columns/too much text for the AI to look at "
                    "all at once. Try asking about specific columns by name, or ask a "
                    "narrower question."
                )
            elif "rate_limit" in error_text or "429" in error_text:
                answer = "Groq's rate limit was hit — wait a few seconds and try again."
            elif "api_key" in error_text or "401" in error_text or "authentication" in error_text:
                answer = "Your GROQ_API_KEY looks invalid or missing. Check backend/.env."
            else:
                answer = f"Couldn't reach the Groq API ({e}). Check your GROQ_API_KEY and internet connection."

            return {"answer": answer, "trace": trace, "chart": chart_payload}
        msg = response.choices[0].message

        if msg.tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": [tc.model_dump() for tc in msg.tool_calls],
                }
            )
            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments or "{}")
                tool_result = dispatch_tool(tc.function.name, args)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_result,
                    }
                )
            continue  # loop again so the model can respond to the tool result

        # No tool call -> this is the final answer
        return {"answer": msg.content, "trace": trace, "chart": chart_payload}

    return {
        "answer": "I ran out of steps trying to answer that — try rephrasing your question.",
        "trace": trace,
        "chart": chart_payload,
    }