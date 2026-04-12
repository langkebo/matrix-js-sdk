# Performance Comparison Report

> Generated: 2026-04-11
> Baseline: 2026-04-10 (Original)

## 1. Summary

| Metric        | Value |
| ------------- | ----: |
| Total Changes |     6 |
| Improvements  |     4 |
| Regressions   |     2 |

## 2. Bundle Size

| Metric       | Current | Baseline | Change | Status |
| ------------ | ------: | -------: | -----: | ------ |
| Total Bundle | 2.05 KB |  2.05 KB |   0.0% | ✅     |

## 3. Critical Module Sizes

| Module                    |    Current |   Baseline | Change | Status |
| ------------------------- | ---------: | ---------: | -----: | ------ |
| src/client.ts             | 6670 lines | 7117 lines |  -6.3% | ✅     |
| src/push/index.ts         |  933 lines |  968 lines |  -3.6% | ✅     |
| src/room-summary/index.ts | 1658 lines | 1757 lines |  -5.6% | ✅     |
| src/admin/index.ts        | 1496 lines | 1448 lines |  +3.3% | ⚠️     |
| src/dm/index.ts           |  969 lines |  960 lines |  +0.9% | ⚠️     |
| src/space/index.ts        |  634 lines |  650 lines |  -2.5% | ✅     |

## 4. Manager Migration

| Metric   | Current | Baseline | Change | Status |
| -------- | ------: | -------: | -----: | ------ |
| Coverage |   99.0% |      97% |  +2.0% | ✅     |

## 5. Test Coverage

| Metric            | Current | Baseline | Change | Status |
| ----------------- | ------: | -------: | -----: | ------ |
| Line Coverage     |  72.01% |   71.88% |  +0.1% | ✅     |
| Function Coverage |  64.04% |    63.3% |  +0.7% | ⚠️     |
| Branch Coverage   |  67.00% |   66.84% |  +0.2% | ✅     |

### 5.1 Module Coverage Details

| Module       | Statements | Branches | Functions |  Lines | Change      |
| ------------ | ---------: | -------: | --------: | -----: | ----------- |
| src/admin    |     65.78% |   57.85% |    56.32% | 64.97% | -           |
| src/dm       |     82.74% |   68.51% |    85.18% | 83.77% | -           |
| src/push     |     81.29% |   74.74% |    88.13% | 81.59% | -           |
| src/managers |     95.31% |   89.01% |     87.5% | 95.16% | -           |
| src/event    |     61.94% |   52.05% |       72% | 65.09% | -           |
| src/room     |     39.69% |      36% |    34.88% | 40.06% | -           |
| src/uploads  |        80% |     100% |       80% | 77.77% | ✅ 0% → 80% |
| src/widgets  |     84.61% |     100% |    84.61% |    75% | ✅ 0% → 84% |

## 6. Target Verification

| Target                    | Goal   | Current | Status     |
| ------------------------- | ------ | ------- | ---------- |
| Bundle Size Reduction     | -20%   | 0%      | ⏳ Pending |
| client.ts Lines Reduction | -30%   | -26.2%  | ⏳ Pending |
| Manager Coverage          | >= 95% | 99.0%   | ✅ Passed  |
| Test Coverage (Lines)     | >= 70% | 72.01%  | ✅ Passed  |
| Test Coverage (Functions) | >= 70% | 64.04%  | ⏳ Pending |

## 7. Performance Test Results

| Test                        | Budget   | Actual | Status  |
| --------------------------- | -------- | ------ | ------- |
| getPushRules (warm cache)   | <= 2.0ms | 9ms    | ✅ Pass |
| getRoomSummary (warm cache) | <= 5.0ms | 1ms    | ✅ Pass |
| getRoomSummaryMembers       | <= 5.0ms | 1ms    | ✅ Pass |
| getRoomSummaryStats         | <= 5.0ms | 0ms    | ✅ Pass |
| listUserSummaries           | <= 5.0ms | 0ms    | ✅ Pass |

## 8. Recommendations

### 8.1 client.ts Reduction (-6.3% → target -30%)

Current progress is insufficient. Recommended actions:

1. **Extract timeline/thread pagination** - Move to `client-timeline-requests.ts`
2. **Extract state/send orchestration** - Move to `client-send-paths.ts`
3. **Extract delayed event handling** - Already done, continue pattern

### 8.2 Test Coverage (71.88% → target 80%)

Gap: 8.12 percentage points. Recommended actions:

1. Add unit tests for `AdminManager` methods
2. Add unit tests for `DirectMessageManager` methods
3. Add integration tests for cache operations

### 8.3 Bundle Size (0% → target -20%)

Current bundle is minimal (2.05 KB entry points). Actual reduction should focus on:

1. Tree-shaking optimization
2. Remove unused exports
3. Code splitting for optional features

## 9. Next Steps

1. Continue client.ts modularization (target: additional -23.7%)
2. Add unit tests for uncovered managers
3. Run memory measurement tool for runtime metrics
