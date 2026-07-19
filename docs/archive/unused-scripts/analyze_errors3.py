import json

with open('/tmp/vitest-unit-results2.json') as f:
    data = json.load(f)

target_files = [
    'OutgoingRequestProcessor.spec.ts',
    'rust-crypto.spec.ts',
    'autodiscovery.spec.ts',
    'fetch.spec.ts',
    'queueToDevice.spec.ts',
    'PerSessionKeyBackupDownloader.spec.ts',
    'login.spec.ts',
    'tokenRefresher.spec.ts',
    'read-receipt.spec.ts',
    'room-member.spec.ts',
    'scheduler.spec.ts',
    'room-hierarchy.spec.ts',
    'http-api/index.spec.ts',
    'KeyClaimManager.spec.ts',
    'backup.spec.ts',
    'pusher.spec.ts',
]

for result in data.get('testResults', []):
    short = result['name'].replace('/Users/ljf/Desktop/hu/matrix-js-sdk/', '')
    is_target = any(t in short for t in target_files)
    if not is_target:
        continue
    for assertion in result.get('assertionResults', []):
        if assertion.get('status') == 'failed':
            msgs = assertion.get('failureMessages', [])
            print(f'FAILED: {short} > {assertion["fullName"]}')
            if msgs:
                first_lines = msgs[0].split('\n')[:5]
                for line in first_lines:
                    print(f'  {line}')
            else:
                print(f'  (no failure message)')
            print()
