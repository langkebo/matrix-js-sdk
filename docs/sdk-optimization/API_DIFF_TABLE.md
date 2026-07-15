# API 差异对照表

**基于**: synapse-rust COMPREHENSIVE_AUDIT_REPORT v5.0 (2026-06-09)  
**对比范围**: SDK 当前封装 vs 后端优化后 API

---

## 一、端点级别差异（按模块）

### 1. Auth 模块

| 后端路由      | HTTP | 后端参数                            | SDK 方法     | 参数差异 | 返回差异                              | 影响 |
| ------------- | ---- | ----------------------------------- | ------------ | -------- | ------------------------------------- | ---- |
| `/v3/login`   | POST | `{type, identifier, password, ...}` | `login()`    | ✅ 一致  | 错误新增 `M_UNKNOWN_TOKEN`（401）处理 | P0   |
| `/v3/refresh` | POST | `{refresh_token}`                   | TokenRefresh | ✅ 一致  | 旧 token 默认拒绝，需区分过期/撤销    | P0   |

### 2. Device 模块

| 后端路由           | HTTP   | 后端参数          | SDK 方法                                     | 参数差异 | 返回差异                               | 影响 |
| ------------------ | ------ | ----------------- | -------------------------------------------- | -------- | -------------------------------------- | ---- |
| `/v3/devices`      | GET    | —                 | `getDevices()`                               | ✅ 一致  | ✅ 一致                                | —    |
| `/v3/devices/{id}` | PUT    | `{display_name?}` | `setDeviceDetails()`                         | 无差异   | 设备名 >100 字符返回 `M_INVALID_PARAM` | P1   |
| `/v3/devices/{id}` | DELETE | —                 | `deleteDevice()` / `deleteMultipleDevices()` | ✅ 一致  | ✅ 一致                                | —    |

### 3. E2EE 模块

| 后端路由                        | HTTP | 后端参数                                         | SDK 方法                              | 参数差异              | 返回差异                      | 影响 |
| ------------------------------- | ---- | ------------------------------------------------ | ------------------------------------- | --------------------- | ----------------------------- | ---- |
| `/v3/keys/upload`               | POST | `{device_keys?, one_time_keys?, fallback_keys?}` | `uploadKeys()`                        | ✅ 一致               | vodozemac 兼容                | —    |
| `/v3/keys/claim`                | POST | `{one_time_keys: {userId: {deviceId: alg}}}`     | `claimKeys()`                         | ✅ 一致               | vodozemac 兼容                | P1   |
| `/v3/keys/query`                | POST | `{device_keys: {userId: []}}`                    | `downloadKeys()` / `getUserDevices()` | ✅ 一致               | ✅ 一致                       | —    |
| `/v3/sendToDevice/{type}/{txn}` | PUT  | `{messages: {userId: {deviceId: body}}}`         | `sendToDevice()`                      | ✅ 一致               | ✅ 一致                       | —    |
| Megolm session 导入             | —    | vodozemac 双路径                                 | `importRoomKeys()`                    | vodozemac pickle 格式 | 需支持 vodozemac session 格式 | P0   |

### 4. Push 模块

| 后端路由          | HTTP | 后端参数                                                                          | SDK 方法         | 参数差异                   | 返回差异                 | 影响 |
| ----------------- | ---- | --------------------------------------------------------------------------------- | ---------------- | -------------------------- | ------------------------ | ---- |
| `/v3/pushers`     | GET  | —                                                                                 | `getPushers()`   | device_id 需在 auth 中传递 | 未认证返回 `M_FORBIDDEN` | P1   |
| `/v3/pushers/set` | POST | `{pushkey, kind, app_id, app_display_name, device_display_name, lang, data, ...}` | `setPusher()`    | **device_id 需显式传递**   | —                        | P1   |
| `/v3/pushrules/`  | GET  | —                                                                                 | `getPushRules()` | ✅ 一致                    | ✅ 一致                  | —    |

### 5. Sync 模块

| 后端路由             | HTTP | 后端参数                                                  | SDK 方法        | 参数差异 | 返回差异             | 影响    |
| -------------------- | ---- | --------------------------------------------------------- | --------------- | -------- | -------------------- | ------- |
| `/v3/sync`           | GET  | `{filter?, since?, timeout?, full_state?, set_presence?}` | `sync()`        | ✅ 一致  | since token 格式兼容 | ✅ 兼容 |
| `/v3/sync` (Sliding) | POST | `{conn_id, lists?, ...}`                                  | `slidingSync()` | ✅ 一致  | ✅ 一致              | —       |

### 6. Media 模块

| 后端路由                            | HTTP | 后端参数                   | SDK 方法                                | 参数差异       | 返回差异                | 影响 |
| ----------------------------------- | ---- | -------------------------- | --------------------------------------- | -------------- | ----------------------- | ---- |
| `/v3/media/upload`                  | POST | file content               | `uploadContent()`                       | ✅ 一致        | ✅ 一致                 | —    |
| `/v1/media/download/{server}/{id}`  | GET  | —                          | `downloadContent()` -> `mxcUrlToHttp()` | 需处理签名 URL | URL 含 HMAC-SHA256 签名 | P1   |
| `/v1/media/thumbnail/{server}/{id}` | GET  | `{width, height, method?}` | `getThumbnail()` -> `mxcUrlToHttp()`    | 同上           | 同上                    | P1   |

### 7. Presence 模块

| 后端路由                       | HTTP | 后端参数                  | SDK 方法        | 参数差异  | 返回差异                     | 影响 |
| ------------------------------ | ---- | ------------------------- | --------------- | --------- | ---------------------------- | ---- |
| `/v3/presence/{userId}/status` | GET  | —                         | `getPresence()` | ✅ 一致   | ✅ 一致                      | ✅   |
| `/v3/presence/{userId}/status` | PUT  | `{presence, status_msg?}` | `setPresence()` | ⚠️ 不完整 | 非支持状态返回 `M_BAD_STATE` | P1   |

### 8. Admin 模块

| 后端路由                        | HTTP   | 后端参数            | SDK 方法             | 参数差异 | 返回差异                   | 影响 |
| ------------------------------- | ------ | ------------------- | -------------------- | -------- | -------------------------- | ---- |
| `/admin/purge_history/{roomId}` | POST   | `{purge_up_to_ts?}` | `purgeRoomHistory()` | ✅ 一致  | 新增 `audit_id` 字段（P2） | P2   |
| `/admin/users/{userId}`         | GET    | —                   | `getUserInfo()`      | ✅ 一致  | ✅ 一致                    | —    |
| `/admin/rooms/{roomId}`         | DELETE | —                   | `deleteRoom()`       | ✅ 一致  | ✅ 一致                    | —    |

### 9. Federation 模块

| 后端路由           | HTTP | 后端参数        | SDK 方法            | 参数差异                                        | 返回差异                      | 影响 |
| ------------------ | ---- | --------------- | ------------------- | ----------------------------------------------- | ----------------------------- | ---- |
| `/v1/version`      | GET  | —               | federation 客户端   | 需携带 `X-Matrix-Origin` + `X-Matrix-Timestamp` | 缺时间戳返回 `M_UNAUTHORIZED` | P0   |
| `/v1/send/{txnId}` | PUT  | PDU list + EDUs | federation 客户端   | 同上                                            | 同上                          | P0   |
| `/key/v2/server`   | GET  | —               | federation 签名验证 | Canonical JSON 差异（U+2028/2029）              | 签名不匹配                    | P1   |

### 10. Health 模块

| 后端路由       | HTTP | 后端参数 | SDK 方法        | 参数差异 | 返回差异            | 影响 |
| -------------- | ---- | -------- | --------------- | -------- | ------------------- | ---- |
| `/_health`     | GET  | —        | 无直接封装      | —        | 新增 Redis 检查字段 | P2   |
| `/v3/versions` | GET  | —        | `getVersions()` | ✅ 一致  | ✅ 一致             | —    |

---

## 二、错误码映射对照

| 后端 errcode                        | HTTP 状态码 | SDK 当前处理                                               | 需修改   |
| ----------------------------------- | ----------- | ---------------------------------------------------------- | -------- |
| `M_FORBIDDEN`                       | 403         | ✅ MatrixError                                             | —        |
| `M_UNKNOWN_TOKEN`                   | 401         | ✅ 触发 Session.logged_out                                 | —        |
| `M_MISSING_TOKEN`                   | 401         | ✅ 触发 Session.logged_out                                 | —        |
| `M_BAD_JSON`                        | 400         | ✅ MatrixError                                             | —        |
| `M_NOT_JSON`                        | 400         | ✅ MatrixError                                             | —        |
| `M_NOT_FOUND`                       | 404         | ✅ MatrixError                                             | —        |
| `M_LIMIT_EXCEEDED`                  | 429         | ✅ `getRetryAfterMs()` + rate-limit 处理                   | —        |
| `M_UNKNOWN`                         | 500         | ✅ MatrixError                                             | —        |
| `M_UNRECOGNIZED`                    | **404**     | ✅ `MatrixError.isUnrecognizedError()` + HTTP 404 映射     | ✅ (v10) |
| `M_UNAUTHORIZED`                    | 401         | ✅ 触发 Session.logged_out                                 | —        |
| `M_USER_DEACTIVATED`                | 403         | ✅ MatrixError                                             | —        |
| `M_USER_IN_USE`                     | 409         | ✅ MatrixError                                             | —        |
| `M_INVALID_USERNAME`                | 400         | ✅ MatrixError                                             | —        |
| `M_ROOM_IN_USE`                     | 409         | ✅ MatrixError                                             | —        |
| `M_INVALID_ROOM_STATE`              | 400         | ✅ MatrixError                                             | —        |
| `M_THREEPID_IN_USE`                 | 409         | ✅ MatrixError                                             | —        |
| `M_THREEPID_NOT_FOUND`              | 400         | ✅ MatrixError                                             | —        |
| `M_THREEPID_AUTH_FAILED`            | 403         | ✅ MatrixError                                             | —        |
| `M_THREEPID_DENIED`                 | 403         | ✅ MatrixError                                             | —        |
| `M_SERVER_NOT_TRUSTED`              | 502         | ✅ `MatrixError.isServerNotTrustedError()` + HTTP 502 映射 | ✅ (v10) |
| `M_UNSUPPORTED_ROOM_VERSION`        | 400         | ✅ MatrixError                                             | —        |
| `M_INCOMPATIBLE_ROOM_VERSION`       | 400         | ✅ MatrixError                                             | —        |
| `M_BAD_STATE`                       | 400         | ✅ MatrixError                                             | —        |
| `M_GUEST_ACCESS_FORBIDDEN`          | 403         | ✅ MatrixError                                             | —        |
| `M_CAPTCHA_NEEDED`                  | 400         | ✅ MatrixError                                             | —        |
| `M_CAPTCHA_INVALID`                 | 400         | ✅ MatrixError                                             | —        |
| `M_MISSING_PARAM`                   | 400         | ✅ MatrixError                                             | —        |
| `M_INVALID_PARAM`                   | 400         | ✅ MatrixError                                             | —        |
| `M_TOO_LARGE`                       | 413         | ✅ MatrixError                                             | —        |
| `M_EXCLUSIVE`                       | 409         | ✅ MatrixError                                             | —        |
| `M_RESOURCE_LIMIT_EXCEEDED`         | 403         | ✅ MatrixError                                             | —        |
| `M_CANNOT_LEAVE_SERVER_NOTICE_ROOM` | 403         | ✅ `@types/errors.ts` 常量 + HTTP 403 映射                 | ✅ (v10) |
| `M_REQUEST_TIMEOUT`                 | 408         | ✅ `@types/errors.ts` 常量 + HTTP 408 映射                 | ✅ (v10) |

---

## 三、类型定义差异

| 后端结构体 (Rust)   | SDK 接口 (TypeScript)                                      | 差异字段                               | 需修改   |
| ------------------- | ---------------------------------------------------------- | -------------------------------------- | -------- |
| `ApiResponse<T>`    | Matrix SDK 响应格式                                        | `retry_after_ms` 新增字段              | P2       |
| `HealthStatus`      | `IHealthCheckResult`（`@types/synapse.ts`）                | Redis 检查项 `redis: { ok, message? }` | ✅ (v10) |
| `CheckResult`       | 无直接类型                                                 | check_name, status, message            | P2       |
| 时间戳字段 (BIGINT) | `number` (毫秒)                                            | ✅ 一致 (C-8 修复后)                   | —        |
| `PushDevice`        | Push SDK 类型                                              | `is_enabled` 前缀（后端内部）          | —        |
| Audit 响应          | `ISynapseAdminPurgeHistoryResponse`（`@types/synapse.ts`） | `audit_id?: string` 字段               | ✅ (v10) |

---

## 四、SDK 己具备的兼容能力

以下后端优化成果不需要 SDK 修改：

| 后端优化                         | SDK 兼容状态 | 原因                                             |
| -------------------------------- | ------------ | ------------------------------------------------ |
| C-3 Sync since token 单次解析    | ✅ 兼容      | SDK sync token 存储/传递逻辑不变                 |
| C-7 TOTP 恒时比较                | ✅ 无影响    | 算法层面的内部优化                               |
| C-8 DateTime→i64 BIGINT          | ✅ 兼容      | JS number 可表示 53-bit 整数，毫秒时间戳在范围内 |
| M-3 sqlx 宏迁移                  | ✅ 无影响    | 后端内部实现变更，API 协议不变                   |
| M-7 Typing/Presence CacheManager | ✅ 兼容      | 多 worker 一致对客户端透明                       |
| OpenAPI Swagger UI               | ✅ 无影响    | 新增开发工具，不影响 SDK 正常运行                |

---

> **更新时间**: 2026-06-09 | **数据基线**: synapse-rust v10 Schema | **SDK 版本**: matrix-js-sdk (HuLa fork)
