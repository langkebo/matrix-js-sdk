import json

with open('/tmp/vitest-unit-results2.json') as f:
    data = json.load(f)

for result in data.get('testResults', []):
    for assertion in result.get('assertionResults', []):
        if assertion.get('status') == 'failed':
            short = result['name'].replace('/Users/ljf/Desktop/hu/matrix-js-sdk/', '')
            msgs = assertion.get('failureMessages', [])
            if not msgs:
                print(f'NO MESSAGE: {short} > {assertion["fullName"]}')
                print(f'  Status: {assertion.get("status")}')
                print(f'  Keys: {list(assertion.keys())}')
            else:
                first_lines = msgs[0].split('\n')[:3]
                print(f'FAILED: {short} > {assertion["fullName"]}')
                for line in first_lines:
                    print(f'  {line}')
                print()
