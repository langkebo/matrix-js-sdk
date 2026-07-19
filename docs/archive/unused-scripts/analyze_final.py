import json

with open('/tmp/vitest-final-results.json') as f:
    data = json.load(f)

total_failed = 0
for result in data.get('testResults', []):
    short = result['name'].replace('/Users/ljf/Desktop/hu/matrix-js-sdk/', '')
    failed = [a for a in result.get('assertionResults', []) if a.get('status') == 'failed']
    if failed:
        total_failed += len(failed)
        print(f'{len(failed):3d} failures | {short}')
        for a in failed[:3]:
            msgs = a.get('failureMessages', [])
            if msgs:
                print(f'    - {a["fullName"]}')
                print(f'      {msgs[0].split(chr(10))[0][:150]}')
            else:
                print(f'    - {a["fullName"]} (no message)')
        if len(failed) > 3:
            print(f'    ... and {len(failed)-3} more')

print(f'\nTotal failed: {total_failed}')
print(f'Total tests: {data.get("numTotalTests")}')
print(f'Passed: {data.get("numPassedTests")}')
print(f'Failed: {data.get("numFailedTests")}')
