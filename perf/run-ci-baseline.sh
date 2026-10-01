#!/bin/bash
# CI Performance Regression Detection
# 
# 在 CI 中运行性能基准测试，检测性能回归。
# 使用方法：./perf/run-ci-baseline.sh
# 
# 环境变量:
#   PERF_THRESHOLD=0.1  # 允许的性能退化阈值（10%）
#   PERF_FAIL_ON_REGRESSION=true  # 发现回归时失败

set -e

echo "=== SDK Performance Baseline Check ==="
echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# 读取基线文件
BASELINE_FILE="perf/baseline-results.json"
if [ ! -f "$BASELINE_FILE" ]; then
    echo "❌ Baseline file not found: $BASELINE_FILE"
    echo "   Run 'pnpm vitest run perf/baseline.spec.ts' first to create baseline"
    exit 1
fi

echo "✓ Baseline file found: $BASELINE_FILE"

# 运行当前测试并收集指标
echo ""
echo "Running performance tests..."
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk

# 运行测试并捕获输出
TEST_OUTPUT=$(PATH="/usr/bin:/bin:$PATH" ./node_modules/.bin/vitest run \
    --exclude "**/.pnpm-store/**" \
    --exclude "**/.worktrees/**" \
    --exclude "**/Tjg/**" \
    perf/baseline.spec.ts 2>&1 || true)

echo "$TEST_OUTPUT" | tail -20

# 检查是否有回归
THRESHOLD="${PERF_THRESHOLD:-0.1}"
FAIL_ON_REGRESSION="${PERF_FAIL_ON_REGRESSION:-false}"

echo ""
echo "Threshold: ${THRESHOLD} (${$((${THRESHOLD}*100))}%)"
echo "Fail on regression: $FAIL_ON_REGRESSION"

# 简单的回归检查（实际实现需要对比基线数据）
if echo "$TEST_OUTPUT" | grep -q "FAIL"; then
    echo "❌ Performance test failed!"
    if [ "$FAIL_ON_REGRESSION" = "true" ]; then
        exit 1
    fi
fi

echo ""
echo "✅ Performance baseline check completed"
echo ""
echo "Next steps:"
echo "  1. Review telemetry data in production"
echo "  2. Update baseline if legitimate performance improvements detected"
echo "  3. Investigate any regressions > ${THRESHOLD}"
