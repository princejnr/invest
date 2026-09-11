#!/usr/bin/env python3
import os
import json
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
ENV_PATH = PROJECT_ROOT / ".env"

env_vars = {}
if ENV_PATH.exists():
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                env_vars[key.strip()] = val.strip().strip('"').strip("'")

supabase_url = os.environ.get("SUPABASE_URL") or env_vars.get("SUPABASE_URL") or "https://ktezlusdkqlfdwqrldtn.supabase.co"
service_role_key = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or env_vars.get("SUPABASE_SERVICE_ROLE_KEY")
    or "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0ZXpsdXNka3FsZmR3cXJsZHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDYyNDQ2MiwiZXhwIjoyMDYwMjAwNDYyfQ.t1U0KpSeGL8SrsMDuLWVfpXI-SsV5UnJIdRIRNAi9ZM"
)

headers = {
    "apikey": service_role_key,
    "Authorization": f"Bearer {service_role_key}",
    "Content-Type": "application/json"
}

def query(endpoint):
    req = urllib.request.Request(f"{supabase_url}/rest/v1/{endpoint}", headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

print("================================================================================")
print("=== 1. CURRENT OPEN / PENDING TRADES ===")
print("================================================================================")
current_trades = query("user_trades?status=in.(OPEN,PENDING,VPS_PENDING,VPS_PROCESSING)&order=created_at.desc")
print(f"Total active/open trades: {len(current_trades)}")
for t in current_trades:
    opp_id = t.get("opportunity_id")
    opp = {}
    if opp_id:
        opp_list = query(f"trade_opportunities?id=eq.{opp_id}")
        if opp_list:
            opp = opp_list[0]
    print(f"\nTrade ID: {t.get('id')}")
    print(f"  Ticket: {t.get('meta_api_order_id')} | Symbol: {t.get('symbol')} | Side: {t.get('side')} | Type: {t.get('trade_type')}")
    print(f"  Status: {t.get('status')} | Vol: {t.get('volume')} | OpenPx: {t.get('open_price')} | Risk: ${t.get('risk_amount')}")
    print(f"  Created: {t.get('created_at')} | Error/Msg: {t.get('error_message')}")
    if opp:
        print(f"  Opp ID: {opp.get('id')} | Strategy: {opp.get('strategy_name')} | Status: {opp.get('status')}")
        print(f"  Conf: {opp.get('confidence_score')} | Regime: {opp.get('market_regime')} | Quality: {opp.get('setup_quality_score')}")
        print(f"  Entry Plan: {json.dumps(opp.get('entry_plan_json'))}")
        print(f"  Stop Plan: {json.dumps(opp.get('stop_plan_json'))}")
        print(f"  Target Plan: {json.dumps(opp.get('target_plan_json'))}")

print("\n================================================================================")
print("=== 2. LAST 25 CLOSED / RESOLVED TRADES ===")
print("================================================================================")
closed_trades = query("user_trades?status=in.(WON,LOST,CLOSED,VPS_CLOSE,EXPIRED,CANCELLED)&order=closed_at.desc.nullslast,created_at.desc&limit=25")
print(f"Retrieved {len(closed_trades)} trades:")
for idx, t in enumerate(closed_trades[:25]):
    opp_id = t.get("opportunity_id")
    opp = {}
    if opp_id:
        opp_list = query(f"trade_opportunities?id=eq.{opp_id}")
        if opp_list:
            opp = opp_list[0]
    pnl = t.get("profit_usd")
    status = t.get("status")
    print(f"\n#{idx+1} [Status: {status}] PnL: ${pnl} | Symbol: {t.get('symbol')} {t.get('side')} ({t.get('trade_type')})")
    print(f"  Ticket: {t.get('meta_api_order_id')} | Vol: {t.get('volume')} | Risk: ${t.get('risk_amount')}")
    print(f"  Open: {t.get('open_price')} -> Close: {t.get('close_price')}")
    print(f"  Created: {t.get('created_at')} | Closed: {t.get('closed_at')}")
    print(f"  Close Reason / Error: {t.get('error_message')}")
    if opp:
        print(f"  Opp ID: {opp.get('id')} | Strategy: {opp.get('strategy_name')} | Setup Quality: {opp.get('setup_quality_score')} | Conf: {opp.get('confidence_score')}")
        print(f"  Exit Reason: {opp.get('exit_reason')} | Actual RR: {opp.get('actual_rr')} | Market Regime: {opp.get('market_regime')}")
        print(f"  Entry Plan: {json.dumps(opp.get('entry_plan_json'))}")
        print(f"  Stop Plan: {json.dumps(opp.get('stop_plan_json'))}")
        print(f"  Target Plan: {json.dumps(opp.get('target_plan_json'))}")
