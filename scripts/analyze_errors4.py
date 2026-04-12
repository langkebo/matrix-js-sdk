import json

with open('/tmp/vitest-unit-results2.json') as f:
    data = json.load(f)

for result in data.get('testResults', []):
    short = result['name'].replace('/Users/ljf/Desktop/hu/matrix-js-sdk/', '')
    if 'OutgoingRequestProcessor' in short:
        print(f'File: {short}')
        print(f'Status: {result.get("status")}')
        print(f'Keys: {list(result.keys())}')
        failed = [a for a in result.get('assertionResults', []) if a.get('status') == 'failed']
        print(f'Failed tests: {len(failed)}')
        if failed:
            a = failed[0]
            print(f'First failed test: {a.get("fullName")}')
            print(f'  Status: {a.get("status")}')
            print(f'  Keys: {list(a.keys())}')
            print(f'  failureMessages: {a.get("failureMessages", "MISSING")}')
            for k, v in a.items():
                if k not in ['fullName', 'status', 'failureMessages']:
                    print(f'  {k}: {repr(v)[:200]}')
        break
