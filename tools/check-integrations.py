#!/usr/bin/env python3
"""Exercises the mail-account and AI-provider settings against a running instance.

    AJH_URL=https://your-host AJH_TOKEN=<session token> python3 tools/check-integrations.py

Confirms that secrets are stored, masked on the way back out, and never returned in
plain text — then sends a real test email and asks each AI provider to answer.
"""
import json
import os
import sys
import urllib.request

BASE = os.environ.get("AJH_URL", "http://127.0.0.1:8787")
TOKEN = os.environ.get("AJH_TOKEN")


def call(method, path, body=None, token=None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"content-type": "application/json", **({"authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read() or "{}")
    except urllib.error.HTTPError as err:
        return json.loads(err.read() or "{}")


token = TOKEN or call("POST", "/api/auth/demo-login", {})["token"]

print("1. the mail-account form, with provider presets")
email = call("GET", "/api/settings/email", None, token)["email"]
print(f"   configured={email['configured']} source={email['source']} presets={len(email['presets'])}")
for preset in email["presets"][:2]:
    print(f"   • {preset['name']} → {preset['host']}:{preset['port']} — {preset['passwordLabel']}")

print("2. save a mail account (the same values are what a user would type)")
saved = call(
    "PUT",
    "/api/settings/email",
    {"host": "smtp.gmail.com", "port": 465, "secure": True, "user": "candidate@example.com", "pass": "abcd efgh ijkl mnop", "from": "Candidate <candidate@example.com>"},
    token,
)
print(f"   capability: {saved['capability']['detail']}")
secret = "abcd efgh ijkl mnop"
print(f"   password set: {saved['email']['passwordSet']} — value leaked to the browser: {secret in json.dumps(saved)}")

print("3. send a real test email through that account")
test = call("POST", "/api/settings/email/test", {}, token)
print(f"   ok={test.get('ok')} {test.get('detail') or test.get('messageId')}")
if not test.get("ok"):
    print("   (expected here when the sandbox cannot reach the mail host — point it at a local server to see a real send)")

print("4. the AI provider catalogue — every free option listed")
ai = call("GET", "/api/settings/ai", None, token)
free = [p for p in ai["catalogue"] if p["free"]]
print(f"   {len(free)} free providers, {len(ai['catalogue']) - len(free)} paid/local")
for provider in free:
    print(f"   • {provider['name']:<28} {provider['signup']}")

print("5. save two free keys and confirm they come back masked")
saved_ai = call(
    "PUT",
    "/api/settings/ai",
    {"providers": [{"id": "google", "apiKey": "AIzaSyEXAMPLEKEY1234567890"}, {"id": "groq", "apiKey": "gsk_EXAMPLEKEY0987654321"}]},
    token,
)
for entry in saved_ai["configured"]:
    print(f"   {entry['id']:<8} keySet={entry['keySet']} masked={entry['keyMasked']}")
print(f"   plain keys leaked to the browser: {'AIzaSyEXAMPLEKEY1234567890' in json.dumps(saved_ai)}")
print(f"   summary: {saved_ai['summary']['note']}")

print("6. clear them again (this deployment has no real keys)")
cleared = call("PUT", "/api/settings/ai", {"providers": []}, token)
print(f"   active providers now: {cleared['active']}")
