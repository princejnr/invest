#!/usr/bin/env python3
import json

with open("scratch/signals_analysis_dump.json", "r") as f:
    signals = json.load(f)

print(f"Total signals loaded: {len(signals)}\n")

for i, s in enumerate(signals[:20], 1):
    sid = s.get("id")
    sym = s.get("symbol")
    side = s.get("side")
    status = s.get("status")
    src = s.get("source") or s.get("source_agent") or "Unknown"
    strat = s.get("strategy_name")
    conf = s.get("confidence_score")
    qual = s.get("setup_quality_score")
    regime = s.get("market_regime")
    c_at = s.get("created_at")
    cl_at = s.get("closed_at")
    
    ep = s.get("entry_plan_json") or {}
    sp = s.get("stop_plan_json") or {}
    tp = s.get("target_plan_json") or s.get("take_profit_json") or {}
    tc = ep.get("trading_central_levels") or {}
    
    ai_summary = s.get("ai_summary") or ""
    ai_risks = s.get("ai_risks") or ""
    exit_reason = s.get("exit_reason") or ""
    
    print(f"================================================================================")
    print(f"Signal #{i}: {sym} {side} | Status: {status} | Source: {src} | Created: {c_at}")
    print(f"  ID: {sid}")
    print(f"  Strategy: {strat} | Regime: {regime} | Conf: {conf} | Setup Quality: {qual}")
    print(f"  Entry: {ep.get('price') or ep.get('suggested_entry_price')} ({ep.get('order_type')}) | Stop: {sp.get('stop')} (Initial: {sp.get('initial')}) | TP: {tp.get('tp') or tc.get('tp1')}")
    print(f"  AI Summary Snippet:\n    {ai_summary[:350]}...")
    if ai_risks:
        print(f"  AI Risks / Rejection Note:\n    {ai_risks[:250]}")
    if exit_reason:
        print(f"  Exit Reason: {exit_reason}")
    print()
