import json

with open('/tmp/vitest-unit-results2.json') as f:
    data = json.load(f)

seen_errors = {}
for result in data.get('testResults', []):
    for assertion in result.get('assertionResults', []):
        if assertion.get('status') == 'failed':
            msgs = assertion.get('failureMessages', [])
            if msgs:
                first_line = msgs[0].split('\n')[0]
                if first_line not in seen_errors:
                    seen_errors[first_line] = []
                short = result['name'].replace('/Users/ljf/Desktop/hu/matrix-js-sdk/', '')
                seen_errors[first_line].append(f'{short} > {assertion["fullName"]}')

for error, tests in sorted(seen_errors.items(), key=lambda x: len(x[1]), reverse=True):
    print(f'\n=== {error} ({len(tests)} failures) ===')
    for t in tests[:3]:
        print(f'    {t}')
    if len(tests) > 3:
        print(f'    ... and {len(tests)-3} more')
