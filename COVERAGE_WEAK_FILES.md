# 快速覆盖率分析报告

## 分析时间
2026-09-30 13:13

## 分析方法
方案 B: 文件级覆盖率分析（静默扫描，不运行测试）
- 扫描 `src` 下所有 TypeScript 文件
- 识别 HTTP 调用方法：`makeRequest`, `withRetry`, `authedRequest`, `authedRequestClient`
- 计算风险评分：`risk = 100 - (lines < 300 ? 20 : 0) - (httpCalls = 0 ? 30 : 0)`

## 最薄弱的 5 个文件

### 1. src/client/worker/worker.ts
- **规模**: 427 行代码
- **HTTP 调用**: 1 次
- **测试状态**: ❌ 无对应测试文件
- **风险评分**: 100
- **建议**: 创建 `spec/unit/client/worker/worker.spec.ts`

### 2. src/client-crypto-requests.ts
- **规模**: 190 行代码
- **HTTP 调用**: 38 次 (!!)
- **测试状态**: ❌ 无对应测试文件
- **风险评分**: 100
- **建议**: 创建 `spec/unit/client-crypto-requests.spec.ts`
- **说明**: HTTP 调用密度极高（每 5 行 1 次调用），风险极大

### 3. src/client-room-discovery-requests.ts
- **规模**: 95 行代码
- **HTTP 调用**: 6 次
- **测试状态**: ❌ 无对应测试文件
- **风险评分**: 100
- **建议**: 创建 `spec/unit/client-room-discovery-requests.spec.ts`

### 4. src/client-secure-backup-requests.ts
- **规模**: 156 行代码
- **HTTP 调用**: 22 次 (!!)
- **测试状态**: ❌ 无对应测试文件
- **风险评分**: 100
- **建议**: 创建 `spec/unit/client-secure-backup-requests.spec.ts`
- **说明**: HTTP 调用密度很高（每 7 行 1 次调用）

### 5. src/client.ts
- **规模**: 4114 行代码 (!!)
- **HTTP 调用**: 25 次
- **测试状态**: ❌ 无对应测试文件
- **风险评分**: 100
- **建议**: 创建 `spec/unit/client.spec.ts`
- **说明**: 核心客户端类，规模最大，风险最高

## 总体统计
- 扫描文件总数: 476 个源文件
- 无测试覆盖文件: 多个核心模块
- HTTP 调用热点: `client-crypto-requests.ts` (38 次), `client-secure-backup-requests.ts` (22 次)

## 下一步行动

1. **立即行动**: 补充 `src/client-crypto-requests.ts` 的测试
   - HTTP 调用密度最高 (38 次)
   - 文件规模合理 (190 行)
   - 风险回报比最高

2. **优先排序**:
   - P0: `client-crypto-requests.ts` (38 次 HTTP 调用)
   - P0: `client-secure-backup-requests.ts` (22 次 HTTP 调用)
   - P1: `client.ts` (4114 行核心类)
   - P2: `client-room-discovery-requests.ts`
   - P3: `client/worker/worker.ts`

3. **验证测试**: 使用 `test_http_request_coverage.mjs` 验证覆盖效果

---

*生成时间: 2026-09-30*
*脚本: scripts/quality/find-lowest-coverage-files.mjs*
