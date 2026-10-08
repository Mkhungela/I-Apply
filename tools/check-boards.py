#!/usr/bin/env python3
"""Checks which board tokens in a list are real, against a running AI Job Hunter instance.

The same thing the "Verify saved list" button does in the Connectors tab, from a terminal:

    AJH_URL=https://your-host AJH_TOKEN=<session token> python3 tools/check-boards.py

It only ever calls each platform's own public read API — nothing is scraped, and no
CAPTCHA, bot detection or rate limit is worked around. Tokens that are not found are
reported so you can prune them.
"""
import json
import os
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("AJH_URL", "http://127.0.0.1:8787")
# Point AJH_TOKEN at a signed-in session to run this against your own deployment;
# without it the script signs in to the local demo account.
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


GREENHOUSE = """vercel, figma, stripe, tailwindlabs, robinhood, toast, bitwarden, bruntworkwear, xendit, capco,
airbnb, dropbox, reddit, doordash, coinbase, github, tripadvisor, forbes, remote,
takealotgroup, takealotcom, offerzen, sociallabsa, stitch-6, luno, float-7, yoco, peachpayments, tyme, tymebank,
betway, multichoice, superbalist, mrprice, enjin, oldmutual, allangray, coronation, ninetyone, sanlam, momentum,
discovery-sa, intercept, clickatell"""

LEVER = ["moo", "getwingapp", "jobgether", "smarsh", "mukuru", "ozow", "paystack", "flutterwave",
         "chipper-cash", "wave-2", "crossswitch", "interswitch", "capitec-fintech-hub"]

WORKABLE = ["remote-recruitment", "sparkschools", "luno-sa", "bank-zero", "crossfin", "centbee", "valr",
            "alt-coin-trader", "easyproperties", "purple-group"]

token = TOKEN or call("POST", "/api/auth/demo-login", {})["token"]

print("1. paste the Greenhouse list (mixed commas and newlines)")
res = call("POST", "/api/connectors/greenhouse/boards", {"text": GREENHOUSE}, token)
print(f"   stored {res['total']} boards (added {res['added']})")

print("2. append the Lever slugs")
res = call("POST", "/api/connectors/lever/boards", {"tokens": LEVER}, token)
print(f"   stored {res['total']} slugs")

print("3. append the Workable subdomains")
res = call("POST", "/api/connectors/workable/boards", {"text": ", ".join(WORKABLE)}, token)
print(f"   stored {res['total']} subdomains")

print("4. re-paste two names that already exist (must not duplicate)")
res = call("POST", "/api/connectors/greenhouse/boards", {"tokens": ["figma", "stripe"]}, token)
print(f"   total still {res['total']}")

print("5. read the list back, exactly as the Connectors UI receives it")
connectors = call("GET", "/api/connectors", None, token)["connectors"]
fields = {"greenhouse": "boardTokens", "lever": "companies", "workable": "subdomains", "smartrecruiters": "companies"}
for connector in connectors:
    if connector["key"] not in fields:
        continue
    config = connector.get("config", {})
    values = config.get(fields[connector["key"]], [])
    if isinstance(values, str):
        values = [v for v in values.split(",") if v]
    junk = [k for k in config if len(k) == 1]
    print(
        f"   {connector['key']:<16} enabled={str(connector['enabled']):<5} "
        f"identifiers={len(values):<3} config-ok={not junk} "
        f"ready={connector['readiness']['ready']} autoApply={connector['readiness']['canAutoApply']}"
    )

print("6. verification against the live platform APIs")
res = call("POST", "/api/connectors/greenhouse/verify-boards", {"limit": 3}, token)
if "totals" in res:
    print(f"   live={res['totals']['ok']} notFound={res['totals']['notFound']} jobs={res['totals']['jobsFound']}")
    for row in res.get("other", [])[:2]:
        print(f"   {row['identifier']}: {row['status']}")
elif "error" in res:
    print(f"   {res['error']}")
