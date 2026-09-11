#!/usr/bin/env python3
import json
import re
from datetime import datetime, timezone

def parse_iso(dt_str):
    if not dt_str:
        return None
    # normalize iso string
    clean_str = dt_str.replace("Z", "+00:00")
    # match timestamp with timezone
    m = re.match(r"^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2}:?\d{2})?$", clean_str)
    if m:
        base, frac, tz = m.groups()
        if frac:
            frac = (frac + "000000")[:6]
            clean_str = f"{base}.{frac}"
        else:
            clean_str = base
        if tz:
            tz_clean = tz if ":" in tz else f"{tz[:3]}:{tz[3:]}"
            clean_str += tz_clean
        else:
            clean_str += "+00:00"
    return datetime.fromisoformat(clean_str)

with open("scratch/trade_analysis_dump.json", "r") as f:
    data = json.load(f)

open_trades = data["open_trades"]
closed_trades = data["closed_trades"]

now_utc = datetime.now(timezone.utc)

print("================================================================================")
print("=== 1. SUMMARY OF CURRENT OPEN TRADES (EXNESS LIVE SYNC) ===")
print("================================================================================")
for i, item in enumerate(open_trades, 1):
    t = item["trade"]
    opp = item.get("opportunity") or {}
    ep = opp.get("entry_plan_json") or {}
    sp = opp.get("stop_plan_json") or {}
    tp = opp.get("take_profit_json") or {}
    tc = ep.get("trading_central_levels") or {}

    c_at = t.get("created_at")
    dt = parse_iso(c_at)
    duration_h = (now_utc - dt).total_seconds() / 3600.0 if dt else 0

    planned_entry = ep.get("price") or ep.get("suggested_entry_price") or ep.get("entry_price")
    open_px = t.get("open_price")
    sl_px = sp.get("stop") or sp.get("stop_price")
    tp1 = tc.get("tp1") or tp.get("tp1") or tp.get("tp")
    tp2 = tc.get("tp2") or tp.get("tp2")

    print(f"Open #{i}: {t.get('symbol')} {t.get('side')} [{t.get('trade_type')}]")
    print(f"  MT5 Ticket: {t.get('meta_api_order_id')} | Status: {t.get('status')} | Volume: {t.get('volume')} lots | Risk: ${t.get('risk_amount')}")
    print(f"  Open Price: {open_px} (Planned: {planned_entry}) | SL: {sl_px} | TP1: {tp1} | TP2: {tp2}")
    print(f"  Age: {duration_h:.1f} hours | Created: {c_at}")
    print(f"  Notes: {t.get('error_message')}")
    print()

print("================================================================================")
print("=== 2. DETAILED BREAKDOWN OF LAST 20 CLOSED TRADES ===")
print("================================================================================")

wins = [x for x in closed_trades if (x["trade"].get("profit_usd") or 0) > 0]
losses = [x for x in closed_trades if (x["trade"].get("profit_usd") or 0) <= 0]
total_pnl = sum((x["trade"].get("profit_usd") or 0) for x in closed_trades)
win_rate = (len(wins) / len(closed_trades) * 100.0) if closed_trades else 0

print(f"Total Trades: {len(closed_trades)} | Wins: {len(wins)} | Losses: {len(losses)} | Win Rate: {win_rate:.1f}%")
print(f"Net PnL: ${total_pnl:.2f}\n")

trade_evaluations = []

for i, item in enumerate(closed_trades, 1):
    t = item["trade"]
    opp = item.get("opportunity") or {}
    ep = opp.get("entry_plan_json") or {}
    sp = opp.get("stop_plan_json") or {}
    tp = opp.get("take_profit_json") or {}
    tc = ep.get("trading_central_levels") or {}

    pnl = float(t.get("profit_usd") or 0.0)
    risk = float(t.get("risk_amount") or 0.0)
    r_mult = (pnl / risk) if risk > 0 else 0.0

    c_at = t.get("created_at")
    cl_at = t.get("closed_at")
    dt1 = parse_iso(c_at)
    dt2 = parse_iso(cl_at)
    duration_h = (dt2 - dt1).total_seconds() / 3600.0 if (dt1 and dt2) else 0

    planned_entry = ep.get("price") or ep.get("suggested_entry_price") or ep.get("entry_price")
    open_px = t.get("open_price")
    close_px = t.get("close_price")
    sl_px = sp.get("stop") or sp.get("stop_price")
    pivot = tc.get("pivot_point")
    tp1 = tc.get("tp1") or tp.get("tp1") or tp.get("tp")
    tp2 = tc.get("tp2") or tp.get("tp2")

    has_ticket = bool(t.get("meta_api_order_id") and t.get("meta_api_order_id") != "0")
    sync_ok = has_ticket and open_px is not None and close_px is not None

    trade_evaluations.append({
        "num": i,
        "id": t.get("id"),
        "ticket": t.get("meta_api_order_id"),
        "symbol": t.get("symbol"),
        "side": t.get("side"),
        "type": t.get("trade_type"),
        "status": t.get("status"),
        "pnl": pnl,
        "risk": risk,
        "r_mult": r_mult,
        "duration_h": duration_h,
        "open_px": open_px,
        "close_px": close_px,
        "planned_entry": planned_entry,
        "sl": sl_px,
        "pivot": pivot,
        "tp1": tp1,
        "tp2": tp2,
        "sync_ok": sync_ok,
        "reason": t.get("error_message")
    })

for ev in trade_evaluations:
    res = "WIN 🟢" if ev["pnl"] > 0 else "LOSS 🔴"
    print(f"#{ev['num']} [{res}] {ev['symbol']} {ev['side']} ({ev['type']})")
    print(f"   Ticket: {ev['ticket']} | Sync: {'IN_SYNC' if ev['sync_ok'] else 'DESYNC'}")
    print(f"   PnL: ${ev['pnl']:.2f} ({ev['r_mult']:+.2f}R) | Risk: ${ev['risk']:.2f} | Duration: {ev['duration_h']:.1f}h")
    print(f"   Open: {ev['open_px']} -> Close: {ev['close_px']} | SL: {ev['sl']} | Pivot: {ev['pivot']} | Planned: {ev['planned_entry']}")
    print(f"   Close Type: {ev['reason']}")
    print()
