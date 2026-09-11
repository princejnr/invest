#!/usr/bin/env python3
import json
import re
from datetime import datetime, timezone

def parse_iso(dt_str):
    if not dt_str:
        return None
    clean_str = dt_str.replace("Z", "+00:00")
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

closed = data["closed_trades"]

results = []

pareto_assets = {"BTCUSD", "ETHUSD", "XAUUSD", "XAGUSD", "USOIL", "UKOIL", "US30"}

for idx, item in enumerate(closed, 1):
    t = item["trade"]
    opp = item.get("opportunity") or {}
    ep = opp.get("entry_plan_json") or {}
    sp = opp.get("stop_plan_json") or {}
    tc = ep.get("trading_central_levels") or {}

    sym = t.get("symbol")
    side = t.get("side")
    t_type = t.get("trade_type")
    ticket = t.get("meta_api_order_id")
    pnl = float(t.get("profit_usd") or 0.0)
    risk = float(t.get("risk_amount") or 0.0)
    r_mult = (pnl / risk) if risk > 0 else 0.0
    open_px = float(t.get("open_price") or 0.0)
    close_px = float(t.get("close_price") or 0.0)
    planned_px = float(ep.get("price") or ep.get("suggested_entry_price") or open_px)
    sl_px = float(sp.get("stop") or sp.get("stop_price") or 0.0)
    pivot = float(tc.get("pivot_point") or 0.0)
    tp1 = float(tc.get("tp1") or 0.0)
    tp2 = float(tc.get("tp2") or 0.0)

    # Scored categories out of 2.5 each:
    # 1. Market Alignment & Context (0-2.5)
    # 2. Risk & Position Sizing (0-2.5)
    # 3. Execution & Slippage (0-2.5)
    # 4. Trade Management & Payoff (0-2.5)

    c1 = 2.0 # default context
    c2 = 2.5 # default risk
    c3 = 2.5 # default execution
    c4 = 2.0 # default management

    # Penalties/Bonuses:
    # Context
    if "GBPUSD" in sym and side == "LONG":
        c1 -= 1.0 # repeated counter-trend longs against strong USD
    elif "EURUSD" in sym and side == "LONG":
        c1 -= 0.8
    elif "NZDUSD" in sym and side == "LONG":
        c1 -= 0.8
    elif sym in pareto_assets:
        c1 = min(2.5, c1 + 0.3)

    # Risk sizing relative to $10 account unit risk (1% of $1000)
    if risk > 15.0:
        c2 -= 1.0 # over-risked
    elif risk > 11.0:
        c2 -= 0.5
    elif risk == 0:
        c2 -= 0.5 # missing risk attribution

    # Execution & Slippage
    if planned_px > 0 and open_px > 0:
        slip_pct = abs(open_px - planned_px) / planned_px * 100
        if slip_pct > 0.1:
            c3 -= 0.5

    # Trade Management & Payoff
    if pnl > 0:
        if r_mult >= 1.0:
            c4 = 2.5
        elif r_mult >= 0.5:
            c4 = 2.2
        else:
            c4 = 1.8 # closed prematurely (<0.5R)
    else:
        if r_mult <= -1.15:
            c4 -= 1.0 # slippage past SL
        elif abs(r_mult - (-1.0)) < 0.15:
            c4 = 1.8 # clean stop-out, respected risk
        elif r_mult > -0.5:
            c4 = 2.0 # quick cut / scratch

    score = round(max(1.0, min(10.0, c1 + c2 + c3 + c4)), 1)

    results.append({
        "idx": idx,
        "symbol": sym,
        "side": side,
        "type": t_type,
        "ticket": ticket,
        "pnl": pnl,
        "risk": risk,
        "r_mult": r_mult,
        "open_px": open_px,
        "close_px": close_px,
        "sl_px": sl_px,
        "pivot": pivot,
        "score": score,
        "c1": c1, "c2": c2, "c3": c3, "c4": c4
    })

print(f"{'#':<3} | {'Symbol':<8} | {'Side':<5} | {'Type':<10} | {'Ticket':<10} | {'PnL ($)':<9} | {'R-Mult':<7} | {'Score':<5} | Key Drivers")
print("-" * 95)
for r in results:
    pnl_s = f"${r['pnl']:+.2f}"
    r_s = f"{r['r_mult']:+.2f}R"
    drivers = []
    if r['score'] >= 8.0:
        drivers.append("Strong execution & R:R" if r['pnl'] > 0 else "Disciplined risk")
    if "GBPUSD" in r['symbol'] and r['side'] == "LONG":
        drivers.append("Counter-trend USD drag")
    if r['risk'] > 15.0:
        drivers.append(f"Oversized risk (${r['risk']:.1f})")
    if r['r_mult'] < -1.1:
        drivers.append(f"Adverse slippage at stop")
    if r['pnl'] > 0 and r['r_mult'] < 0.5:
        drivers.append("Cut early (<0.5R)")
    if not drivers:
        drivers.append("Clean stop out at plan" if r['pnl'] < 0 else "Target hit")
    
    driver_str = ", ".join(drivers)
    print(f"{r['idx']:<3} | {r['symbol']:<8} | {r['side']:<5} | {r['type']:<10} | {r['ticket']:<10} | {pnl_s:<9} | {r_s:<7} | {r['score']:<5} | {driver_str}")

avg_score = sum(r['score'] for r in results) / len(results)
print(f"\nAverage Rating: {avg_score:.2f} / 10")
