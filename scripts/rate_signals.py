#!/usr/bin/env python3
import json

with open("scratch/signals_analysis_dump.json", "r") as f:
    signals = json.load(f)

rated_signals = []

for i, s in enumerate(signals[:20], 1):
    sid = s.get("id")
    sym = s.get("symbol")
    side = s.get("side")
    status = s.get("status")
    src = s.get("source") or s.get("source_agent") or "Unknown"
    c_at = s.get("created_at")
    
    ep = s.get("entry_plan_json") or {}
    sp = s.get("stop_plan_json") or {}
    tp = s.get("target_plan_json") or s.get("take_profit_json") or {}
    tc = ep.get("trading_central_levels") or {}
    
    summary = s.get("ai_summary") or ""
    risks = s.get("ai_risks") or ""
    
    entry = float(ep.get("price") or ep.get("suggested_entry_price") or 0.0)
    stop = float(sp.get("stop") or sp.get("initial") or 0.0)
    target = float(tp.get("tp") or tp.get("tp2") or tc.get("tp2") or tc.get("tp1") or 0.0)
    
    risk_dist = abs(entry - stop) if (entry and stop) else 0.0
    reward_dist = abs(target - entry) if (entry and target) else 0.0
    rr = (reward_dist / risk_dist) if risk_dist > 0 else 0.0
    
    # 4 Scored Categories out of 2.5 each:
    # 1. Macro & HTF Regime Alignment (0-2.5)
    # 2. Structural Precision & Level Anchoring (0-2.5)
    # 3. Risk:Reward Geometry (0-2.5)
    # 4. Execution Feasibility & Redundancy (0-2.5)
    
    c1 = 2.0
    c2 = 2.0
    c3 = 2.0
    c4 = 2.0
    
    # Category 1: HTF & Sibling Alignment
    if "GBPUSD" in sym and side == "LONG":
        c1 -= 1.0 # Counter-trend into USD rally
    if sym == "UKOIL" and side == "SHORT" and "17:54" in c_at:
        c1 -= 1.0 # Clashing with UKOIL bullish breakout
    if sym == "US30" and side == "SHORT" and "SPX500" in risks:
        c1 -= 1.0 # Clashing with open SPX500 Long
    if "XAGUSD" in sym and side == "SHORT":
        c1 = min(2.5, c1 + 0.3) # Trend aligned
        
    # Category 2: Level Anchoring
    if "FVG" in summary or "Fibonacci" in summary or "S/R flip" in summary:
        c2 = min(2.5, c2 + 0.3)
    if not entry or not stop:
        c2 -= 1.0
        
    # Category 3: R:R Geometry
    if "R:R ratio 0.56" in risks or "R:R too low (1:0.61)" in summary:
        c3 = 0.5 # Disastrous initial R:R
    elif rr >= 2.0:
        c3 = 2.5
    elif rr >= 1.5:
        c3 = 2.0
    elif rr >= 1.0:
        c3 = 1.2
    else:
        c3 = 0.8
        
    # Category 4: Execution Feasibility & Redundancy
    if "Blowout Protection" in risks:
        c4 = 0.5 # Sizing exceeds account safety
    elif "Redundant duplicate" in risks:
        c4 = 1.0 # Spam duplication
    elif "Aged PENDING_APPROVAL" in risks:
        c4 = 1.2 # Ignored/unactionable
    elif status == "WON":
        c4 = 2.5
    elif status == "ACTIVE":
        c4 = 2.2
        
    total_score = round(max(1.0, min(10.0, c1 + c2 + c3 + c4)), 1)
    
    rated_signals.append({
        "num": i,
        "id": sid,
        "symbol": sym,
        "side": side,
        "status": status,
        "source": src,
        "rr": rr,
        "score": total_score,
        "c1": c1, "c2": c2, "c3": c3, "c4": c4,
        "summary": summary,
        "risks": risks
    })

print(f"{'#':<3} | {'Symbol':<8} | {'Side':<5} | {'Status':<16} | {'Source':<12} | {'R:R':<6} | {'Score':<5} | Key Analysis Assessment")
print("-" * 105)
for r in rated_signals:
    status_str = r['status']
    rr_str = f"1:{r['rr']:.2f}" if r['rr'] > 0 else "N/A"
    
    notes = []
    if r['score'] >= 8.5:
        notes.append("High-conviction, disciplined R:R")
    if "R:R ratio 0.56" in r['risks'] or "1:0.61" in r['summary']:
        notes.append("Severe R:R flaw (<0.65R)")
    if "Blowout" in r['risks']:
        notes.append("Oversized stop blows account limit")
    if "duplicate" in r['risks']:
        notes.append("Duplicate burst spam")
    if "GBPUSD" in r['symbol'] and r['side'] == "LONG":
        notes.append("Counter-trend USD trap")
    if "Contradictory" in r['risks']:
        notes.append("Correlated index contradiction")
    if not notes:
        if r['status'] == 'WON':
            notes.append("Clean execution & target hit")
        elif r['status'] == 'PENDING_APPROVAL':
            notes.append("Solid thesis awaiting operator review")
        elif r['status'] == 'EXPIRED':
            notes.append("Aged setup on saturated asset")
        else:
            notes.append("Average setup")
            
    note_str = ", ".join(notes)
    print(f"{r['num']:<3} | {r['symbol']:<8} | {r['side']:<5} | {status_str:<16} | {r['source']:<12} | {rr_str:<6} | {r['score']:<5} | {note_str}")

avg_score = sum(r['score'] for r in rated_signals) / len(rated_signals)
print(f"\nAverage Analysis Score: {avg_score:.2f} / 10")
