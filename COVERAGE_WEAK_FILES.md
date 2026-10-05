# 覆盖盲区台账（门禁文件）

> 本文件不是快照报告，而是**受 CI 强制的门禁台账**。
> 机器可读版本：`scripts/quality/coverage-critical-ledger.json`
> 门禁脚本：`scripts/quality/check-coverage-critical-files.mjs`
> 覆盖判定单一真相源：`scripts/quality/lib/spec-import-graph.mjs`
> 命令：`pnpm quality:coverage:critical-files`（已接入 `pnpm lint`，因此也在 `prepublishOnly` 内）

## 为什么会有这份文件

2026-09-30 的旧版报告声称 `client-crypto-requests.ts` / `client-secure-backup-requests.ts`
「无对应测试文件」，风险评分 100。事后核查发现这是**扫描器缺陷造成的误报**。该缺陷有**三层**，
每修掉一层都会暴露出下一层的假阳性：

| #   | 缺陷                                                                                                                       | 症状                                                                                                           | 影响脚本                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | `walkDir(dir, [".spec.ts"])`：`path.extname("foo.spec.ts")` 返回 `".ts"`，永远匹配不上（**同一份代码被复制到了两个脚本**） | 输出 `Found 471 source files and 0 test files`，所有源文件被判「无测试」                                       | `find-lowest-coverage-files.mjs`、`find-lowest-coverage-modules.mjs` |
| 2   | 改用后缀匹配后，仍按 **basename** 猜对应关系                                                                               | 本仓 spec 不同名（`client.ts` ← `matrix-client.spec.ts`、`three-pids/` ← `threepids.spec.ts`），继续产出假阳性 | 同上                                                                 |
| 3   | 只扫 `spec/` 目录，漏掉**放在源文件旁边的 in-src 测试**                                                                    | `src/client/worker/worker.spec.ts` 看不见 ⇒ `worker.ts` 被误列进台账（已由 R4 清出）                           | `check-coverage-critical-files.mjs`                                  |

**教训**：靠文件名猜测「有没有测试」在本仓必然失真。三层缺陷现在统一收口到
`scripts/quality/lib/spec-import-graph.mjs`（**单一真相源**），改用可验证信号：

1. **直接 spec**：镜像路径或扁平同名；
2. **import 图**：任意 spec（含 in-src 的 `src/**/*.spec.ts`）import 了该文件。

> 只有当一个源文件真的被某个 spec import 时，才认为它被测试。

## 门禁判定

```
critical = 含 HTTP 调用(withRetry/authedRequest/makeRequest/.request(Method)
           且 无直接 spec
           且 无任何 spec import 该模块
```

规则（任一违反 → exit 1）：

| 规则   | 含义                     | 触发条件                                                        |
| ------ | ------------------------ | --------------------------------------------------------------- |
| **R1** | 出现未登记的覆盖盲区     | 新的 critical 文件未写入台账                                    |
| **R2** | 台账条目不完整           | 缺 `owner` / `deadline` / `reason`，或 deadline 非 `YYYY-MM-DD` |
| **R3** | 台账条目已过期           | `deadline < 今天` 且文件仍未覆盖                                |
| **R4** | 台账条目已失效（防腐烂） | 文件现在已被 spec 覆盖，条目却仍留在台账里                      |

R4 是关键：它强制「修好一个就删一条」，否则台账会重新退化成永不收敛的文档。

## 当前状态（2026-10-05）

- 源文件 588 个（已排除 `src/**/*.spec.ts` 这类 in-src 测试与 `.d.ts`）
- spec 文件 443 个（`spec/` 401 + in-src 42）
- critical 文件 **20 个**，全部已登记且在期限内

> 与台账机器可读版本（`coverage-critical-ledger.json`）**必须完全一致**：
> 数字对不上时以门禁输出为准，并按下方「维护约定」同步本文件。

### P0（2 周内，deadline 2026-10-19）

| 文件                                                            | 规模   | HTTP 调用 | owner    | 说明                                               |
| --------------------------------------------------------------- | ------ | --------- | -------- | -------------------------------------------------- |
| `src/room-summary/sub-managers/room-event-operation-manager.ts` | 939 行 | **42**    | langkebo | 全仓 HTTP 调用密度最高的未覆盖文件，房间事件写路径 |

### P1（1 个月内，deadline 2026-11-02）

| 文件                                                | 规模   | HTTP 调用 | owner    | 说明                     |
| --------------------------------------------------- | ------ | --------- | -------- | ------------------------ |
| `src/dm/sub-managers/dm-room-list-manager.ts`       | 636 行 | 4         | langkebo | 直聊房间列表读写         |
| `src/rust-crypto/DehydratedDeviceManager.ts`        | 396 行 | 4         | langkebo | 脱水设备管理（加密敏感） |
| `src/room-summary/sub-managers/room-key-manager.ts` | 143 行 | 5         | langkebo | 房间密钥管理（写路径）   |
| `src/feature-flags/index.ts`                        | 140 行 | 4         | langkebo | 特性开关影响全端行为分支 |

### P2（季度内，deadline 2026-11-30）

| 文件                                                   | 规模   | HTTP 调用 |
| ------------------------------------------------------ | ------ | --------- |
| `src/friend/sub-managers/friend-list-manager.ts`       | 613 行 | 3         |
| `src/dm/sub-managers/dm-room-creation-manager.ts`      | 352 行 | 3         |
| `src/room-summary/sub-managers/room-search-manager.ts` | 256 行 | 3         |
| `src/dm/sub-managers/dm-room-operation-manager.ts`     | 166 行 | 3         |
| `src/room-summary/sub-managers/room-state-manager.ts`  | 137 行 | 3         |
| `src/room-creation/index.ts`                           | 99 行  | 3         |

### P3（季度末，deadline 2026-12-31）

`room-invite-policy-manager.ts` / `room-thread-manager.ts` / `sessions/index.ts` /
`crypto-store/index.ts` / `federation-query-manager.ts` / `federation-room-manager.ts` /
`federation-server-manager.ts` / `friend-request-manager.ts` / `lifecycle/index.ts`（共 9 个，均 ≤4 HTTP 调用）。

> `owner` 暂统一填仓主 handle，请按 `module` 字段重新指派到实际负责人。

## 已完成（本轮）

两个被旧报告点名的文件经核查**早已有 spec**，本轮做的是**加深断言**（原断言只覆盖请求体正确性）：

| 文件                                              | 修复前 | 修复后    | 新增覆盖                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec/unit/client-crypto-requests.spec.ts`        | 14 例  | **27 例** | 4xx/5xx → `MatrixError` 传播、429 限流可重试判定、`M_UNRECOGNIZED` 判定、requestId 百分号编码边界、空输入                                                                                                                                                                                             |
| `spec/unit/client-secure-backup-requests.spec.ts` | 10 例  | **29 例** | 口令非 ASCII / 空值、`session_keys` 结构保序、`M_WRONG_ROOM_KEYS_VERSION` 版本不匹配、403 错误口令、404 缺失备份、401 令牌过期；并**首次覆盖**原先零测试的 5 个 helper（`getMyRoomsRequest` / `searchRoomsRequest` / `searchRecipientsRequest` / `getClientConfigRequest` / `getSSOUserInfoRequest`） |

## 相关命令

```bash
pnpm quality:coverage:critical-files          # 门禁（CI 强制）
node scripts/quality/check-coverage-critical-files.mjs --json   # 机器可读摘要
pnpm quality:coverage:weak-files              # 信息性：当前 top-20 高风险文件（不阻断）
pnpm quality:coverage                         # lcov 实测覆盖率门禁（需先 pnpm coverage）
```

## 维护约定

1. 新增源文件若含 HTTP 调用且暂无 spec，门禁会以 R1 失败 —— 补 spec，或在台账登记（必须含 owner/deadline/reason）。
2. 补完测试后**必须删除对应台账条目**，否则 R4 失败。
3. 调整 deadline 需在 PR 说明理由；R3 到期即红，不允许静默续期。
4. 新增/删除台账条目后，**同步更新本文件的「当前状态」数字与分档表**（两处不一致等同文档漂移）。
