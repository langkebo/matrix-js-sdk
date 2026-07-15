# Matrix JS SDK 系统性优化方案

**基于**: [synapse-rust COMPREHENSIVE_AUDIT_REPORT v5.0](../synapse-rust/COMPREHENSIVE_AUDIT_REPORT_2026-06-03.md)  
**制定日期**: 2026-06-09  
**目标**: 确保 SDK 封装的 API 接口与优化后的 synapse-rust 后端服务（v10 Schema）保持完全一致  
**适用范围**: `/Users/ljf/Desktop/hu_ts/matrix-js-sdk`

---

## 一、后端优化成果概览（对 SDK 的影响）

| 后端变更                                            | 状态      | 对 SDK 的影响                                  |
| --------------------------------------------------- | --------- | ---------------------------------------------- |
| C-1 联邦 X-Matrix 时间戳校验（±30s + nonce）        | ✅ 已完成 | SDK 联邦请求需携带精确 Origin 时间戳           |
| C-2 Canonical JSON 修复（U+2028/2029/FFFD）         | ✅ 已完成 | SDK JSON 序列化需对齐                          |
| C-3 Sync since token 单次解析                       | ✅ 已完成 | SDK 需验证 token 格式兼容性                    |
| C-5 E2EE vodozemac 收敛（Phase 1+2 ✅，Phase 3 🚧） | 🚧 90%    | SDK Megolm 需支持 vodozemac 双路径             |
| C-6 JWT 旧 token 默认拒绝                           | ✅ 已完成 | SDK TokenRefresh 逻辑需验证                    |
| C-7 TOTP 恒时比较                                   | ✅ 已完成 | 无 API 变更                                    |
| C-8 NOW()/DateTime BIGINT 类型全线清零              | ✅ 已完成 | 无 API 变更（时间戳统一毫秒）                  |
| P2 #32 Push `/pushers` 鉴权（device_id 校验）       | ✅ 已完成 | SDK pusher 方法需传 device_id                  |
| P2 #33 Admin 审计日志                               | ✅ 已完成 | Admin 方法响应可能含审计字段                   |
| P2 #34 m-30 媒体 URL 签名（HMAC-SHA256）            | ✅ 已完成 | SDK 媒体下载需处理签名 URL                     |
| m-13 设备名长度限制（≤100 字符）                    | ✅ 已完成 | SDK 设备方法需添加前端校验                     |
| Redis 健康检查（P2 #36）                            | ✅ 已完成 | `/health` 端点返回新增 Redis 检查项            |
| OpenAPI/Swagger UI 集成（P2 #37）                   | ✅ 已完成 | SDK 可利用 `/_api-doc/openapi.json` 做契约校验 |
| v10 Schema（250 表）                                | ✅ 已部署 | SDK 集成测试数据库验证基准更新                 |
| M-3 sqlx 编译期宏 1358/12.2% 动态                   | ✅ 已完成 | 后端 SQL 类型安全提升，无 API 变更             |

---

## 二、API 差异对比分析

### 2.1 错误码体系对齐

**后端定义的 Matrix 错误码**（`src/common/error.rs`，26 个）：

```
M_FORBIDDEN, M_UNKNOWN_TOKEN, M_MISSING_TOKEN, M_BAD_JSON, M_NOT_JSON,
M_NOT_FOUND, M_LIMIT_EXCEEDED, M_UNKNOWN, M_UNRECOGNIZED, M_UNAUTHORIZED,
M_USER_DEACTIVATED, M_USER_IN_USE, M_INVALID_USERNAME, M_ROOM_IN_USE,
M_INVALID_ROOM_STATE, M_THREEPID_IN_USE, M_THREEPID_NOT_FOUND,
M_THREEPID_AUTH_FAILED, M_THREEPID_DENIED, M_SERVER_NOT_TRUSTED,
M_UNSUPPORTED_ROOM_VERSION, M_INCOMPATIBLE_ROOM_VERSION, M_BAD_STATE,
M_GUEST_ACCESS_FORBIDDEN, M_CAPTCHA_NEEDED, M_CAPTCHA_INVALID,
M_MISSING_PARAM, M_INVALID_PARAM, M_TOO_LARGE, M_EXCLUSIVE,
M_RESOURCE_LIMIT_EXCEEDED, M_CANNOT_LEAVE_SERVER_NOTICE_ROOM,
M_REQUEST_TIMEOUT
```

**SDK 当前错误处理**（`src/http-api/errors.ts`）：`MatrixError` 解析 `errcode`/`error` 字段，`HTTPError` 处理 HTTP 状态码，`ConnectionError`/`TokenRefreshError` 用于非 Matrix 错误。

| 差异项                              | 后端行为                            | SDK 当前                               | 是否需修改                                                                  |
| ----------------------------------- | ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `M_UNRECOGNIZED` HTTP 状态码        | 404（Matrix Spec v1.11+）           | 未特殊处理                             | **需修改** — 当前 SDK 可能以 400 解析，导致 Element 显示 "bad request" 错误 |
| `M_SERVER_NOT_TRUSTED`              | 502 Bad Gateway                     | 未被 SDK 错误类型单独覆盖              | **需添加** — 联邦相关请求需识别此错误                                       |
| `M_REQUEST_TIMEOUT`                 | 408 Request Timeout                 | 未单独处理                             | **需添加** — 超时错误应有专用处理                                           |
| `M_CANNOT_LEAVE_SERVER_NOTICE_ROOM` | 403 Forbidden                       | 未识别                                 | **需添加** — UI 需特殊提示                                                  |
| `retry_after_ms` 字段               | 包含在错误响应中                    | `MatrixError.getRetryAfterMs()` 已处理 | ✅ 无需修改                                                                 |
| 错误响应结构                        | `{errcode, error, retry_after_ms?}` | `MatrixError` 已适配                   | ✅ 兼容                                                                     |

**操作**:

- P0: 在 SDK 错误枚举中添加缺失的 `M_UNRECOGNIZED`（404）/ `M_SERVER_NOT_TRUSTED` / `M_REQUEST_TIMEOUT` / `M_CANNOT_LEAVE_SERVER_NOTICE_ROOM` 处理
- P1: 添加 Matrix 错误码常量文件，与后端 `MatrixErrorCode` 枚举保持同步

### 2.2 各模块 API 差异详情

#### 2.2.1 认证模块（Auth）

| 端点                     | 后端变更                          | SDK 影响                                           | 优先级    |
| ------------------------ | --------------------------------- | -------------------------------------------------- | --------- |
| `POST /login`            | JWT 旧 token 默认拒绝（C-6）      | `TokenRefreshFunction` 可能触发更频繁的刷新        | P0        |
| `POST /refresh`          | is_legacy_token_window_open=false | SDK token 刷新失败需更准确区分「过期」与「已撤销」 | P0        |
| `GET /login/get_qr_code` | v1 端点，QR 登录新增              | SDK 已有 `qr-login` 模块                           | ✅ 已封装 |
| `POST /register`         | 无变更                            | 无影响                                             | —         |

**操作**:

1. 在 `TokenRefreshFunction` 回调中增加 `M_UNKNOWN_TOKEN` 区分处理（token 已撤销 vs 临时网络错误）
2. 添加 `TokenRefreshLogoutError` 的触发条件文档注释，明确标注 C-6 行为变更

#### 2.2.2 设备模块（Device）

| 端点                         | 后端变更                  | SDK 影响                             | 优先级 |
| ---------------------------- | ------------------------- | ------------------------------------ | ------ |
| `GET /devices`               | 无变更                    | 无影响                               | —      |
| `PUT /devices/{deviceId}`    | 设备名 ≤ 100 字符（m-13） | SDK `setDeviceName()` 需前端校验长度 | P1     |
| `DELETE /devices/{deviceId}` | 无变更                    | 无影响                               | —      |

**操作**:

1. 在 `DeviceManager.setDeviceName()` / `MatrixClient.setDeviceDetails()` 中添加 `display_name.length > 100` 的前端校验，抛出 `ValidationError`

#### 2.2.3 E2EE 模块（End-to-End Encryption）

| 端点                                     | 后端变更               | SDK 影响                                        | 优先级  |
| ---------------------------------------- | ---------------------- | ----------------------------------------------- | ------- |
| `POST /keys/claim`                       | vodozemac Phase 1+2 ✅ | SDK `key-claim` 模块需确保兼容                  | P1      |
| `POST /keys/upload`                      | vodozemac 兼容         | 无 API 格式变更                                 | ✅ 兼容 |
| `POST /sendToDevice/{eventType}/{txnId}` | 无变更                 | 无影响                                          | —       |
| `GET /room_keys/version`                 | 无变更                 | 无影响                                          | —       |
| Megolm session 管理                      | vodozemac 双路径       | SDK 需支持 vodozemac 模式下的 session 导入/导出 | P0      |

**操作**:

1. P0: 与后端 vodozemac Phase 3 互操作测试对齐，确保 SDK Megolm session 在 vodozemac 模式下正常收发
2. P0: 更新 `src/rust-crypto/` 中的 WASM 绑定，确保与后端 vodozemac 0.9+ 兼容
3. P1: 添加 `E2EE_USE_VODOZEMAC_MEGOLM` 对应的 SDK 客户端配置项

#### 2.2.4 推送模块（Push）

| 端点                | 后端变更                      | SDK 影响                                  | 优先级 |
| ------------------- | ----------------------------- | ----------------------------------------- | ------ |
| `GET /pushers`      | 新增 device_id 校验（P2 #32） | SDK `getPushers()` 需确保请求带 device_id | P1     |
| `POST /pushers/set` | device_id 必填                | `setPusher()` 参数需包含 device_id        | P1     |
| `GET /pushrules/`   | 无变更                        | 无影响                                    | —      |

**操作**:

1. `setPusher()` 方法签名验证 device_id 参数是否必填
2. 如果 SDK 后端测试调用 `setPusher()` 未传 device_id，更新测试用例

#### 2.2.5 同步模块（Sync）

| 端点                        | 后端变更                    | SDK 影响                  | 优先级  |
| --------------------------- | --------------------------- | ------------------------- | ------- |
| `GET /sync`                 | since token 单次解析（C-3） | SDK sync token 格式未变化 | ✅ 兼容 |
| `POST /sync` (Sliding Sync) | 无变更                      | 无影响                    | —       |

**操作**:

1. 验证 SDK `since` token 在多次 sync 请求中的连续性
2. 确认 SDK 测试覆盖 token 格式异常场景（如空 token、过期 token）

#### 2.2.6 媒体模块（Media）

| 端点                                          | 后端变更         | SDK 影响                   | 优先级 |
| --------------------------------------------- | ---------------- | -------------------------- | ------ |
| `GET /media/download/{serverName}/{mediaId}`  | URL 签名（m-30） | SDK 下载方法需处理签名 URL | P1     |
| `GET /media/thumbnail/{serverName}/{mediaId}` | URL 签名         | 同上                       | P1     |
| `POST /media/upload`                          | 无变更           | 无影响                     | —      |

**操作**:

1. 确保 `MatrixClient.mxcUrlToHttp()` 正确构建带签名的 URL
2. 添加媒体 URL 过期后的重新获取逻辑

#### 2.2.7 在线状态模块（Presence）

| 端点                            | 后端变更                             | SDK 影响                               | 优先级 |
| ------------------------------- | ------------------------------------ | -------------------------------------- | ------ |
| `GET /presence/{userId}/status` | 已实现                               | 无影响                                 | ✅     |
| `PUT /presence/{userId}/status` | 不完整（仅 shared/subscribe/online） | SDK `setPresence()` 可能返回非预期错误 | P1     |

**操作**:

1. 更新 `PresenceManager` 文档，标注当前仅支持 `online`/`offline`/`unavailable` 三种状态
2. 添加 `setPresence()` 调用时的前端校验

#### 2.2.8 Admin 模块

| 端点                    | 后端变更           | SDK 影响            | 优先级 |
| ----------------------- | ------------------ | ------------------- | ------ |
| `/admin/purge_history`  | 审计日志（P2 #33） | 响应可能含 audit_id | P2     |
| `/admin/users/{userId}` | 无变更             | 无影响              | —      |
| `/admin/rooms/{roomId}` | 无变更             | 无影响              | —      |

**操作**:

1. 更新 Admin 相关 TypeScript 类型定义，添加可能返回的 `audit_id` 字段

#### 2.2.9 联邦模块（Federation）

| 端点                                 | 后端变更                       | SDK 影响                                                        | 优先级 |
| ------------------------------------ | ------------------------------ | --------------------------------------------------------------- | ------ |
| `GET /_matrix/federation/v1/version` | X-Matrix 时间戳校验（C-1）     | SDK 联邦请求需携带精确 `X-Matrix-Origin` + `Authorization` 签名 | P0     |
| `GET /_matrix/key/v2/server`         | 新鲜度校验 + nonce 缓存（C-2） | SDK 联邦签名验证需对齐                                          | P1     |

**操作**:

1. P0: 确保 SDK 联邦请求在所有需要签名的端点中正确设置 `X-Matrix-Origin` 和 `X-Matrix-Timestamp`
2. P1: 验证 SDK JSON Canonicalization 与后端 C-2 修复后的行为一致（特别是 U+2028/U+2029 字符处理）

#### 2.2.10 健康检查模块（Health）

| 端点           | 后端变更                    | SDK 影响                | 优先级 |
| -------------- | --------------------------- | ----------------------- | ------ |
| `GET /_health` | 新增 Redis 检查项（P2 #36） | 响应结构新增 Redis 字段 | P2     |

**操作**:

1. 更新 `HealthStatus` 类型定义，添加 Redis 健康状态字段

### 2.3 汇总差异矩阵

| 模块       | 需修改端点 | P0 项 | P1 项 | P2 项 | 主要风险         |
| ---------- | ---------- | ----- | ----- | ----- | ---------------- |
| Auth       | 2          | 2     | 0     | 0     | Token 刷新逻辑   |
| Device     | 1          | 0     | 1     | 0     | 名称长度截断     |
| E2EE       | 3          | 2     | 1     | 0     | vodozemac 互操作 |
| Push       | 2          | 0     | 2     | 0     | device_id 缺失   |
| Sync       | 0          | 0     | 0     | 0     | 无（✅ 兼容）    |
| Media      | 2          | 0     | 2     | 0     | 签名 URL 过期    |
| Presence   | 1          | 0     | 1     | 0     | 状态不完整       |
| Admin      | 1          | 0     | 0     | 1     | 审计字段         |
| Federation | 2          | 1     | 1     | 0     | 时间戳+签名      |
| Health     | 1          | 0     | 0     | 1     | 字段新增         |
| **总计**   | **15**     | **5** | **8** | **2** | —                |

---

## 三、实施计划

### 3.1 阶段划分

#### Phase 1: 错误处理对齐与基础设施（第 1-2 周）

| 编号  | 任务                                                           | 优先级 | 预计工作量 | 依赖  |
| ----- | -------------------------------------------------------------- | ------ | ---------- | ----- |
| SDK-1 | 添加缺失的 Matrix 错误码常量定义文件（`src/@types/errors.ts`） | P0     | 0.5d       | —     |
| SDK-2 | `M_UNRECOGNIZED` 404 状态码处理（Element 兼容）                | P0     | 0.5d       | SDK-1 |
| SDK-3 | Token 刷新逻辑适配 C-6（JWT 旧 token 拒绝）                    | P0     | 1d         | —     |
| SDK-4 | Federation 请求 X-Matrix-Timestamp 精确携带                    | P0     | 1d         | —     |
| SDK-5 | E2EE vodozemac Phase 3 互操作适配                              | P0     | 2d         | —     |
| SDK-6 | 建立 API 一致性自动化校验脚本                                  | P1     | 1d         | —     |

**Phase 1 验收标准**:

- SDK 能正确解析后端返回的所有 26 个 Matrix 错误码
- Token 刷新在 C-6 模式下正确区分过期/撤销
- Federation 请求携带正确的 `X-Matrix` 请求头
- 自动化校验脚本可运行

#### Phase 2: API 接口同步（第 3-4 周）

| 编号   | 任务                                     | 优先级 | 预计工作量 | 依赖         |
| ------ | ---------------------------------------- | ------ | ---------- | ------------ |
| SDK-7  | Push pusher 方法 device_id 参数必填化    | P1     | 1d         | —            |
| SDK-8  | Media URL 签名处理逻辑                   | P1     | 1d         | —            |
| SDK-9  | Device 名称长度前端校验                  | P1     | 0.5d       | —            |
| SDK-10 | Presence setPresence 前端校验 + 文档更新 | P1     | 0.5d       | —            |
| SDK-11 | Federation Canonical JSON 对齐验证       | P1     | 1d         | SDK-4        |
| SDK-12 | 更新 `src/@types/synapse.ts` 类型定义    | P1     | 1d         | SDK-4, SDK-7 |

**Phase 2 验收标准**:

- 所有 P1 项 API 差异已消除
- 类型定义与后端 DTO 100% 一致
- 真实后端测试通过

#### Phase 3: 测试与文档（第 5-6 周）

| 编号   | 任务                                        | 优先级 | 预计工作量 | 依赖      |
| ------ | ------------------------------------------- | ------ | ---------- | --------- |
| SDK-13 | 编写后端 API 契约差异集成测试（15 个端点）  | P1     | 2d         | SDK-7～11 |
| SDK-14 | Admin 审计字段类型定义 + 文档更新           | P2     | 0.5d       | —         |
| SDK-15 | Health 检查响应类型更新（Redis 字段）       | P2     | 0.5d       | —         |
| SDK-16 | 更新 SDK 错误码文档 + 迁移指南              | P1     | 1d         | SDK-1     |
| SDK-17 | 更新 `docs/api-contract/` 契约文档对齐 v5.0 | P1     | 2d         | 全部      |
| SDK-18 | 编写自动化 OpenAPI 契约校验工具             | P2     | 1d         | —         |

**Phase 3 验收标准**:

- 15 个受影响端点的集成测试全部通过
- 契约文档与后端 v5.0 审计报告完全一致
- OpenAPI 自动化校验可检测 API 漂移

---

### 3.2 甘特图概览

```
Week 1-2 (Phase 1):  ████████████  P0 错误处理 + Federation + vodozemac
Week 3-4 (Phase 2):  ████████████  P1 API 同步 + 类型定义
Week 5-6 (Phase 3):  ████████████  测试 + 文档 + 自动化工具
```

---

## 四、兼容性处理策略

### 4.1 SDK 版本策略

- **当前版本**: 基于 element-hq/matrix-js-sdk 的 fork（HuLa 定制版）
- **本次优化版本**: 建议标记为 `v41.0.0`（Major 版本，含 P0 破坏性变更）
- **兼容窗口**: 保持与上一个大版本（v40.x）2 个版本的 API 兼容期

### 4.2 破坏性变更

| 变更                                      | 影响范围                         | 兼容措施                               |
| ----------------------------------------- | -------------------------------- | -------------------------------------- |
| Token 刷新 `M_UNKNOWN_TOKEN` 视为不可恢复 | 依赖 TokenRefresh 自动恢复的应用 | 通过 `Session.logged_out` 事件通知用户 |
| `setPusher()` device_id 变必填            | 未传 device_id 的调用方          | 添加 `@deprecated` 旧签名，v42 移除    |
| Federation 请求新增 X-Matrix 头           | 自定义联邦客户端                 | 添加迁移文档                           |

### 4.3 渐进式适配

1. **Feature Flag 机制**: 对 vodozemac 相关变更使用 `E2EE_USE_VODOZEMAC_MEGOLM` 环境变量控制，允许渐进切换
2. **弃用警告**: 所有旧 API 添加 `@deprecated` JSDoc 标签 + `console.warn`
3. **类型守卫**: 新增字段使用可选类型（`audit_id?: string`），不强制消费

### 4.4 SDK 向后兼容清单

```
✅ 现有 MatrixClient API 签名不变（仅新增可选参数）
✅ 现有 Manager 模式不变（仅内部逻辑更新）
✅ 错误类型保持继承层级（MatrixError extends HTTPError extends Error）
✅ 事件名称不变（仅新增事件类型）
✅ pnpm-lock.yaml 依赖不升级（避免级联风险）
```

---

## 五、API 一致性校验机制

### 5.1 校验体系架构

```
┌─────────────────────────────────────────────────────┐
│                   校验体系                           │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ OpenAPI Diff │  │ 类型对比    │  │ 集成测试   │ │
│  │   (L1)       │  │   (L2)      │  │   (L3)    │ │
│  │              │  │             │  │           │ │
│  │ 后端          │  │ 后端 DTO    │  │ 真实后端   │ │
│  │ openapi.json │  │ ↔ SDK 类型  │  │ ↔ SDK 请求  │ │
│  │ ↔ SDK 方法   │  │             │  │           │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │           CI Pipeline（L4）                   │   │
│  │  GitHub Actions → 每次 PR 自动运行三级校验      │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 5.2 L1: OpenAPI 契约差异检测

**工具**: 自定义脚本 `scripts/api-contract-diff.mjs`

**流程**:

1. 从后端 `/_api-doc/openapi.json` 获取 OpenAPI 规范
2. 从 SDK `src/` 提取所有 HTTP 方法调用
3. 对比两者差异：
    - 后端有、SDK 无：**缺失端点**（告警）
    - SDK 有、后端无：**幽灵端点**（错误）
    - 参数不匹配：**签名差异**（错误）
    - 响应结构不匹配：**类型差异**（告警）

```javascript
// scripts/api-contract-diff.mjs 核心逻辑
async function diffEndpoints(openapiSpec, sdkEndpoints) {
    const issues = [];
    for (const [path, methods] of Object.entries(openapiSpec.paths)) {
        for (const [method, spec] of Object.entries(methods)) {
            const sdkImpl = findSdkMethod(sdkEndpoints, method, path);
            if (!sdkImpl) {
                issues.push({ severity: "warn", type: "missing", path, method });
            }
        }
    }
    return issues;
}
```

### 5.3 L2: 类型定义静态对比

**工具**: TypeScript 编译期类型检查

**方法**:

1. 在后端 `src/web/api_doc.rs` 中标记的 `#[derive(utoipa::ToSchema)]` 结构体 → 导出为 JSON Schema
2. 在 SDK `src/@types/synapse.ts` 中定义对应 TypeScript 接口
3. 使用 `ts-json-schema-generator` 生成 SDK 端的 JSON Schema
4. 使用 `ajv` 或自定义脚本对比差异

```typescript
// 示例: 后端 HealthStatus 对应的 SDK 类型
interface SdkHealthStatus {
    ok: boolean;
    checks: {
        database: SdkCheckResult;
        redis: SdkCheckResult; // ← P2 #36 新增
        federation: SdkCheckResult;
    };
}
```

### 5.4 L3: 真实后端集成测试

**配置**: 已有 `spec/integ/real-backend/` 测试目录

**扩展**:

```
spec/integ/real-backend/
├── api-consistency/
│   ├── auth.spec.ts          # 认证 API 一致性
│   ├── device.spec.ts        # 设备 API 一致性
│   ├── e2ee.spec.ts          # E2EE API 一致性
│   ├── federation.spec.ts    # 联邦 API 一致性
│   ├── media.spec.ts         # 媒体 API 一致性
│   ├── presence.spec.ts      # 在线状态 API 一致性
│   ├── push.spec.ts          # 推送 API 一致性
│   └── errors.spec.ts        # 错误码一致性
```

**测试模式**: 每个端点覆盖以下场景

- 正常请求 → 验证返回结构与类型定义一致
- 参数错误 → 验证返回正确的 `errcode` + HTTP 状态码
- 边界条件 → 设备名 100 字符、push device_id 缺失等

### 5.5 CI 门禁

```yaml
# .github/workflows/api-consistency.yml (新增)
jobs:
    openapi-diff:
        steps:
            - name: Fetch backend OpenAPI spec
              run: curl https://matrix.test/_api-doc/openapi.json -o openapi.json
            - name: Run contract diff
              run: node scripts/api-contract-diff.mjs openapi.json

    type-check:
        steps:
            - name: TypeScript strict check
              run: pnpm lint:types

    real-backend-test:
        steps:
            - name: Run API consistency tests
              run: pnpm test:real-backend:batch -- spec/integ/real-backend/api-consistency/
```

---

## 六、错误处理统一方案

### 6.1 后端错误响应格式

```json
{
    "errcode": "M_FORBIDDEN",
    "error": "You are not allowed to perform this action",
    "retry_after_ms": 5000
}
```

### 6.2 SDK 错误处理重构方案

**新增文件**: `src/@types/errors.ts`

```typescript
/**
 * Matrix 错误码常量定义（与后端 src/common/error.rs:MatrixErrorCode 对齐）
 */
export const MatrixErrorCode = {
    M_FORBIDDEN: "M_FORBIDDEN",
    M_UNKNOWN_TOKEN: "M_UNKNOWN_TOKEN",
    M_MISSING_TOKEN: "M_MISSING_TOKEN",
    M_BAD_JSON: "M_BAD_JSON",
    M_NOT_JSON: "M_NOT_JSON",
    M_NOT_FOUND: "M_NOT_FOUND",
    M_LIMIT_EXCEEDED: "M_LIMIT_EXCEEDED",
    M_UNKNOWN: "M_UNKNOWN",
    M_UNRECOGNIZED: "M_UNRECOGNIZED", // ← 新增处理
    M_UNAUTHORIZED: "M_UNAUTHORIZED",
    M_USER_DEACTIVATED: "M_USER_DEACTIVATED",
    M_USER_IN_USE: "M_USER_IN_USE",
    M_INVALID_USERNAME: "M_INVALID_USERNAME",
    M_ROOM_IN_USE: "M_ROOM_IN_USE",
    M_INVALID_ROOM_STATE: "M_INVALID_ROOM_STATE",
    M_THREEPID_IN_USE: "M_THREEPID_IN_USE",
    M_THREEPID_NOT_FOUND: "M_THREEPID_NOT_FOUND",
    M_THREEPID_AUTH_FAILED: "M_THREEPID_AUTH_FAILED",
    M_THREEPID_DENIED: "M_THREEPID_DENIED",
    M_SERVER_NOT_TRUSTED: "M_SERVER_NOT_TRUSTED", // ← 新增处理
    M_UNSUPPORTED_ROOM_VERSION: "M_UNSUPPORTED_ROOM_VERSION",
    M_INCOMPATIBLE_ROOM_VERSION: "M_INCOMPATIBLE_ROOM_VERSION",
    M_BAD_STATE: "M_BAD_STATE",
    M_GUEST_ACCESS_FORBIDDEN: "M_GUEST_ACCESS_FORBIDDEN",
    M_CAPTCHA_NEEDED: "M_CAPTCHA_NEEDED",
    M_CAPTCHA_INVALID: "M_CAPTCHA_INVALID",
    M_MISSING_PARAM: "M_MISSING_PARAM",
    M_INVALID_PARAM: "M_INVALID_PARAM",
    M_TOO_LARGE: "M_TOO_LARGE",
    M_EXCLUSIVE: "M_EXCLUSIVE",
    M_RESOURCE_LIMIT_EXCEEDED: "M_RESOURCE_LIMIT_EXCEEDED",
    M_CANNOT_LEAVE_SERVER_NOTICE_ROOM: "M_CANNOT_LEAVE_SERVER_NOTICE_ROOM", // ← 新增
    M_REQUEST_TIMEOUT: "M_REQUEST_TIMEOUT", // ← 新增
} as const;

export type MatrixErrorCodeType = (typeof MatrixErrorCode)[keyof typeof MatrixErrorCode];

/**
 * Matrix 错误码对应的 HTTP 状态码（与后端 http_status() 方法对齐）
 */
export const MATRIX_ERROR_HTTP_STATUS: Record<string, number> = {
    [MatrixErrorCode.M_FORBIDDEN]: 403,
    [MatrixErrorCode.M_UNKNOWN_TOKEN]: 401,
    [MatrixErrorCode.M_MISSING_TOKEN]: 401,
    [MatrixErrorCode.M_BAD_JSON]: 400,
    [MatrixErrorCode.M_NOT_JSON]: 400,
    [MatrixErrorCode.M_NOT_FOUND]: 404,
    [MatrixErrorCode.M_LIMIT_EXCEEDED]: 429,
    [MatrixErrorCode.M_UNKNOWN]: 500,
    [MatrixErrorCode.M_UNRECOGNIZED]: 404, // ← Spec v1.11+ 改为 404
    [MatrixErrorCode.M_UNAUTHORIZED]: 401,
    [MatrixErrorCode.M_USER_DEACTIVATED]: 403,
    [MatrixErrorCode.M_USER_IN_USE]: 409,
    [MatrixErrorCode.M_INVALID_USERNAME]: 400,
    [MatrixErrorCode.M_ROOM_IN_USE]: 409,
    [MatrixErrorCode.M_INVALID_ROOM_STATE]: 400,
    [MatrixErrorCode.M_THREEPID_IN_USE]: 409,
    [MatrixErrorCode.M_THREEPID_NOT_FOUND]: 400,
    [MatrixErrorCode.M_THREEPID_AUTH_FAILED]: 403,
    [MatrixErrorCode.M_THREEPID_DENIED]: 403,
    [MatrixErrorCode.M_SERVER_NOT_TRUSTED]: 502,
    [MatrixErrorCode.M_UNSUPPORTED_ROOM_VERSION]: 400,
    [MatrixErrorCode.M_INCOMPATIBLE_ROOM_VERSION]: 400,
    [MatrixErrorCode.M_BAD_STATE]: 400,
    [MatrixErrorCode.M_GUEST_ACCESS_FORBIDDEN]: 403,
    [MatrixErrorCode.M_CAPTCHA_NEEDED]: 400,
    [MatrixErrorCode.M_CAPTCHA_INVALID]: 400,
    [MatrixErrorCode.M_MISSING_PARAM]: 400,
    [MatrixErrorCode.M_INVALID_PARAM]: 400,
    [MatrixErrorCode.M_TOO_LARGE]: 413,
    [MatrixErrorCode.M_EXCLUSIVE]: 409,
    [MatrixErrorCode.M_RESOURCE_LIMIT_EXCEEDED]: 403,
    [MatrixErrorCode.M_CANNOT_LEAVE_SERVER_NOTICE_ROOM]: 403,
    [MatrixErrorCode.M_REQUEST_TIMEOUT]: 408,
};
```

### 6.3 HTTP 错误码到 Matrix 错误码映射

| HTTP 状态码 | 后端对应 errcode                                                | SDK 处理策略                                     |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------ |
| 400         | `M_BAD_JSON`, `M_MISSING_PARAM`, `M_INVALID_PARAM`, 等          | 解析响应 body 中的 `errcode`，构建 `MatrixError` |
| 401         | `M_UNKNOWN_TOKEN`, `M_MISSING_TOKEN`, `M_UNAUTHORIZED`          | 触发 `Session.logged_out` 事件                   |
| 403         | `M_FORBIDDEN`, `M_USER_DEACTIVATED`, `M_GUEST_ACCESS_FORBIDDEN` | 抛出 `MatrixError`，UI 提示用户无权限            |
| 404         | `M_NOT_FOUND`, `M_UNRECOGNIZED`                                 | 资源不存在或端点未实现                           |
| 408         | `M_REQUEST_TIMEOUT`                                             | **新增**: 自动重试（最多 3 次，指数退避）        |
| 409         | `M_USER_IN_USE`, `M_ROOM_IN_USE`, 等                            | 冲突错误，UI 提示                                |
| 413         | `M_TOO_LARGE`                                                   | 上传文件过大                                     |
| 429         | `M_LIMIT_EXCEEDED`                                              | 已有 `getRetryAfterMs()` 处理 ✅                 |
| 500         | `M_UNKNOWN`                                                     | 内部错误，记录日志                               |
| 502         | `M_SERVER_NOT_TRUSTED`                                          | **新增**: 联邦相关，提示服务器不可信             |

---

## 七、文档更新计划

### 7.1 需创建的文档

| 文档             | 路径                                                | 内容                         |
| ---------------- | --------------------------------------------------- | ---------------------------- |
| SDK 优化方案     | `docs/sdk-optimization/SDK_OPTIMIZATION_PLAN.md`    | 本文档                       |
| API 差异对比表   | `docs/sdk-optimization/API_DIFF_TABLE.md`           | 详细端到端差异表（见附录 A） |
| 错误码迁移指南   | `docs/sdk-optimization/ERROR_CODE_MIGRATION.md`     | 旧 SDK 错误码 → 新错误码对照 |
| 测试验证报告模板 | `docs/sdk-optimization/TEST_VERIFICATION_REPORT.md` | Phase 3 测试结果记录         |

### 7.2 需更新的文档

| 文档           | 路径                              | 更新内容                          |
| -------------- | --------------------------------- | --------------------------------- |
| API 契约文档   | `docs/api-contract/auth.md`       | 补充 C-6 JWT 旧 token 拒绝说明    |
| API 契约文档   | `docs/api-contract/e2ee.md`       | 更新 vodozemac Phase 3 互操作说明 |
| API 契约文档   | `docs/api-contract/push.md`       | device_id 必填标注                |
| API 契约文档   | `docs/api-contract/federation.md` | X-Matrix-Timestamp 精确性要求     |
| API 契约文档   | `docs/api-contract/media.md`      | URL 签名处理说明                  |
| API 契约文档   | `docs/api-contract/presence.md`   | 标注当前实现不完整                |
| SDK 覆盖率报告 | `docs/SDK_COVERAGE_REPORT.md`     | 更新覆盖率数据                    |
| CHANGELOG      | `CHANGELOG.md`                    | 记录 v41.0.0 API 变更             |

---

## 八、实施时间表

| 里程碑           | 日期      | 交付物                                        |
| ---------------- | --------- | --------------------------------------------- |
| M1: Phase 1 完成 | 第 2 周末 | SDK-1～6 完成，真实后端测试通过               |
| M2: Phase 2 完成 | 第 4 周末 | SDK-7～12 完成，P1 差异全消除                 |
| M3: Phase 3 完成 | 第 6 周末 | SDK-13～18 完成，契约文档对齐，自动化工具就位 |
| M4: 验收发布     | 第 7 周   | 完整测试验证报告，v41.0.0 发布                |

---

## 附录 A: API 差异快速对照表

详见 [API_DIFF_TABLE.md](./API_DIFF_TABLE.md)（本文档第二部分 2.2 的展开表格）

## 附录 B: 自动化校验脚本清单

| 脚本               | 路径                             | 功能                                   |
| ------------------ | -------------------------------- | -------------------------------------- |
| contract-diff      | `scripts/api-contract-diff.mjs`  | 已有 ✅，需更新对比基线                |
| type-check         | TypeScript 编译                  | 已有 ✅ `pnpm lint:types`              |
| real-backend-batch | `spec/integ/real-backend/`       | 已有 ✅，需新增 api-consistency 子目录 |
| openapi-fetch      | 新增 `scripts/fetch-openapi.mjs` | 获取后端 OpenAPI 规范                  |

---

## 附录 C: 风险登记

| 风险                                           | 影响 | 概率 | 缓解措施                                           |
| ---------------------------------------------- | ---- | ---- | -------------------------------------------------- |
| vodozemac Phase 4 尚未完成，SDK 互操作可能变更 | 中   | 中   | 与后端 C-5 进度同步，SDK 适配跟随 Phase 4          |
| SDK 用户依赖旧版 Token 刷新行为                | 高   | 低   | 通过 Session.logged_out 事件兼容，提供迁移文档     |
| Federation 签名变更导致第三方联邦节点连接失败  | 中   | 低   | C-1/C-2 仅影响服务器端，SDK 作为客户端不直接受影响 |
| 真实后端测试环境不稳定                         | 低   | 中   | 已有成熟测试基础设施，维护成本低                   |

---

> **版本**: 1.0  
> **作者**: SDK 优化工作组  
> **审核状态**: 待审批
