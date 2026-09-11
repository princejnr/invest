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

# Fetch last 25 signals to analyze 20 comprehensively
signals = q('trade_opportunities?order=created_at.desc&limit=25')

with open('scratch/signals_analysis_dump.json', 'w') as f:
    json.dump(signals, f, indent=2)

print(f"Dumped {len(signals)} signals to scratch/signals_analysis_dump.json")
