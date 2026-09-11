#!/usr/bin/env python3
import urllib.request
import json

url = 'https://ktezlusdkqlfdwqrldtn.supabase.co/rest/v1'
key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0ZXpsdXNka3FsZmR3cXJsZHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDYyNDQ2MiwiZXhwIjoyMDYwMjAwNDYyfQ.t1U0KpSeGL8SrsMDuLWVfpXI-SsV5UnJIdRIRNAi9ZM'
headers = {'apikey': key, 'Authorization': f'Bearer {key}'}

def q(ep):
    req = urllib.request.Request(f'{url}/{ep}', headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

# 1. Open trades
open_trades = q('user_trades?status=in.(OPEN,PENDING,VPS_PENDING,VPS_PROCESSING)&order=created_at.desc')
# 2. Closed trades
closed_trades = q('user_trades?status=in.(WON,LOST,CLOSED,VPS_CLOSE)&order=closed_at.desc.nullslast,created_at.desc&limit=20')

all_data = {
    'open_trades': [],
    'closed_trades': []
}

for t in open_trades:
    opp_id = t.get('opportunity_id')
    opp = q(f'trade_opportunities?id=eq.{opp_id}')[0] if opp_id else {}
    all_data['open_trades'].append({'trade': t, 'opportunity': opp})

for t in closed_trades:
    opp_id = t.get('opportunity_id')
    opp = q(f'trade_opportunities?id=eq.{opp_id}')[0] if opp_id else {}
    all_data['closed_trades'].append({'trade': t, 'opportunity': opp})

with open('scratch/trade_analysis_dump.json', 'w') as f:
    json.dump(all_data, f, indent=2)

print(f"Dumped {len(all_data['open_trades'])} open trades and {len(all_data['closed_trades'])} closed trades to scratch/trade_analysis_dump.json")
