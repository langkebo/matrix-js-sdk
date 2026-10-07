# MSC 编号 — SDK 映射关系

> **维护规则**：
>
> 1. 新增 MSC 相关 API 时必须同步更新本表
> 2. 每条记录必须包含：MSC 编号、状态（Stable/Unstable/Draft）、后端实现情况、SDK 影响面
> 3. 定期（每季度）复核后端对齐状态

## 统计概览

| 类别                  | 数量 | 说明                                                    |
| --------------------- | ---- | ------------------------------------------------------- |
| 总 MSC 编号           | 66   | 在 SDK 中有引用                                         |
| 已标准化（Stable）    | ~18  | 进入 Matrix 规范正式版本                                |
| Unstable（实验性）    | ~33  | 使用 `ClientPrefix.Unstable` 或 `ServerPrefix.Unstable` |
| Draft（草案）         | ~15  | 仅在注释中提及，未实现或仅部分实现                      |
| 后端未实现（P3 豁免） | 6    | 见 `path-contract-waivers.json`                         |

---

## 详细对照表

### 核心功能类

| MSC 编号    | 状态     | 前端文件                                                        | 后端实现   | SDK 影响面                   | 备注                           |
| ----------- | -------- | --------------------------------------------------------------- | ---------- | ---------------------------- | ------------------------------ |
| **MSC1772** | Stable   | `src/models/room.ts`                                            | ✅         | Space hierarchy              | 已标准化为 `m.space.child`     |
| **MSC2666** | Unstable | `src/server-capabilities/index.ts`                              | ⚠️ Partial | Mutual rooms query           | `uk.half-shot.msc2666` 前缀    |
| **MSC2716** | Unstable | `src/models/room-state.ts`, `src/models/room.ts`                | ✅         | Historical message import    | `/batch_send`, `m.room.marker` |
| **MSC3089** | Unstable | `src/models/MSC3089TreeSpace.ts`, `src/models/MSC3089Branch.ts` | ✅         | File tree in space-room      | `org.matrix.msc3089.*`         |
| **MSC3266** | Unstable | `src/room-summary/index.ts`                                     | ✅         | Room summary batch           | `/summary/batch`               |
| **MSC3575** | Stable   | `src/sliding-sync.ts`, `src/sliding-sync-sdk.ts`                | ✅         | Sliding Sync                 | 已进入 v1 规范                 |
| **MSC3967** | Stable   | (无专属封装)                                                    | ✅         | Sync incremental state token | 正常消费 `/sync`               |
| **MSC4186** | Stable   | `src/sliding-sync.ts`, `src/models/room.ts`                     | ✅         | Simplified Sliding Sync      | `heroes`, `joined_count`       |

### 加密与安全类

| MSC 编号    | 状态     | 前端文件                                                               | 后端实现 | SDK 影响面              | 备注                     |
| ----------- | -------- | ---------------------------------------------------------------------- | -------- | ----------------------- | ------------------------ |
| **MSC2965** | Unstable | `src/client-auth.ts`, `src/oidc/validate.ts`                           | ✅       | OIDC PKCE auth          | fallback to v2           |
| **MSC3814** | Unstable | `src/dehydrated-device/index.ts`, `src/crypto-api/index.ts`            | ✅       | Dehydrated devices      | `org.matrix.msc3814.v1`  |
| **MSC4268** | Draft    | `src/common-crypto/CryptoBackend.ts`, `src/rust-crypto/rust-crypto.ts` | ⚠️ Draft | Room key bundle sharing | 类型定义完整，后端未实现 |
| **MSC4362** | Draft    | `src/rust-crypto/rust-crypto.ts`, `src/models/event.ts`                | ⚠️ Draft | Encrypted state events  | 类型定义，未启用         |

### 会议与 RTC 类

| MSC 编号    | 状态     | 前端文件                                                                    | 后端实现 | SDK 影响面                  | 备注                                            |
| ----------- | -------- | --------------------------------------------------------------------------- | -------- | --------------------------- | ----------------------------------------------- |
| **MSC3245** | Draft    | `src/voice/index.ts`                                                        | ❌       | Voice message transcoding   | 客户端完成转码，后端无端点                      |
| **MSC4143** | Unstable | `src/matrix-rtc/`, `src/server-capabilities/index.ts`, `src/voice/index.ts` | ❌       | RTC membership & transports | **P3 豁免项**，需后端补齐 `GET /rtc/transports` |
| **MSC4310** | Unstable | `src/matrix-rtc/types.ts`, `src/matrix-rtc/CallMembership.ts`               | ❌       | RTC decline event           | 依赖 MSC4143                                    |

### 身份验证与账号类

| MSC 编号    | 状态     | 前端文件                                        | 后端实现 | SDK 影响面                 | 备注                                                     |
| ----------- | -------- | ----------------------------------------------- | -------- | -------------------------- | -------------------------------------------------------- |
| **MSC3720** | Unstable | `src/account/index.ts`, `src/security/index.ts` | ❌       | Account status bulk query  | **P3 豁免项**，后端仅实现 v3 `/account/status/{user_id}` |
| **MSC4133** | Unstable | `src/profile/index.ts`                          | ✅       | Extended user profiles     | `/profile/{userId}/extended`                             |
| **MSC4191** | Stable   | `src/oidc/validate.ts`                          | ✅       | Account management claims  | RFC8628 fields                                           |
| **MSC4341** | Draft    | `src/oidc/register.ts`, `src/oidc/validate.ts`  | ❌       | OIDC registration endpoint | **P3 豁免项**                                            |

### 房间与社交类

| MSC 编号    | 状态     | 前端文件                  | 后端实现 | SDK 影响面             | 备注                                       |
| ----------- | -------- | ------------------------- | -------- | ---------------------- | ------------------------------------------ |
| **MSC2403** | Stable   | `src/client-api-types.ts` | ✅       | Knock rooms            | `m.knock` join rule                        |
| **MSC3417** | Stable   | `src/models/room.ts`      | ✅       | Call rooms             | `m.call` room type                         |
| **MSC4267** | Stable   | `src/room/RoomManager.ts` | ✅       | Atomic leave + forget  | `POST /rooms/{roomId}/leave {forget:true}` |
| **MSC4497** | Unstable | `src/room-state/index.ts` | ✅       | State events filtering | `?type=` query param                       |

### 推送与通知类

| MSC 编号    | 状态     | 前端文件               | 后端实现 | SDK 影响面           | 备注                  |
| ----------- | -------- | ---------------------- | -------- | -------------------- | --------------------- |
| **MSC2153** | Unstable | `src/pushprocessor.ts` | ✅       | Push context         | `device_display_name` |
| **MSC3401** | Unstable | `src/pushprocessor.ts` | ✅       | VoIP push handling   | 客户端处理            |
| **MSC3786** | Unstable | `src/pushprocessor.ts` | ✅       | Related push rules   | `m.related_to`        |
| **MSC3914** | Unstable | `src/pushprocessor.ts` | ✅       | Bundle push contexts | Contextual push data  |

### 事件与消息类

| MSC 编号    | 状态     | 前端文件                                                     | 后端实现 | SDK 影响面                            | 备注                                              |
| ----------- | -------- | ------------------------------------------------------------ | -------- | ------------------------------------- | ------------------------------------------------- |
| **MSC1767** | Stable   | `src/@types/extensible_events.ts`                            | ✅       | Extensible events                     | m.text, m.image etc.                              |
| **MSC2674** | Stable   | `src/@types/beacon.ts`                                       | ✅       | Relation support                      | `m.reference`                                     |
| **MSC2676** | Stable   | `src/models/event.ts`                                        | ✅       | Redaction of state events restriction | 禁止通过 relation 替换 state event                |
| **MSC3267** | Stable   | `src/@types/beacon.ts`                                       | ✅       | Reference relation                    | `m.reference` rel_type，配合 MSC2674              |
| **MSC3389** | Unstable | `src/models/event.ts`, `src/models/room.ts`                  | ❌       | Redacted event replacement            | 未标准化                                          |
| **MSC3531** | Unstable | `src/models/event.ts`                                        | ✅       | Visibility change                     | `m.hide/show`                                     |
| **MSC3765** | Stable   | `src/@types/topic.ts`                                        | ✅       | Extensible topic event                | `m.topic` with extensible events                  |
| **MSC3846** | Stable   | `src/embedded.ts`                                            | ✅       | TURN servers via widget API           | `widgetApi.requestCapability(MSC3846TurnServers)` |
| **MSC3912** | Unstable | `src/@types/event.ts`, `src/client.ts`                       | ✅       | Relation-based redactions             | `_relation_based_redaction` UnstableValue         |
| **MSC3925** | Stable   | `src/event-mapper.ts`                                        | ✅       | Event sanitization                    | 已标准化                                          |
| **MSC3946** | Stable   | `src/models/room.ts`                                         | ✅       | Predecessor state event               | `m.predecessor`                                   |
| **MSC4033** | Draft    | `src/models/compare-event-ordering.ts`, `src/models/room.ts` | ⚠️ Draft | Event ordering logic                  | 类型定义，未实现                                  |

### 多媒体与内容类

| MSC 编号    | 状态     | 前端文件                                         | 后端实现   | SDK 影响面           | 备注                    |
| ----------- | -------- | ------------------------------------------------ | ---------- | -------------------- | ----------------------- |
| **MSC3488** | Stable   | `src/@types/location.ts`, `src/@types/beacon.ts` | ✅         | Location events      | `m.location`            |
| **MSC3672** | Stable   | `src/beacon/index.ts`                            | ✅         | Beacon events        | `m.beacon`              |
| **MSC3852** | Unstable | `src/client-api-types.ts`                        | ⚠️ Partial | Last seen user agent | 仅类型定义              |
| **MSC3916** | Stable   | `src/content-repo.ts`                            | ✅         | Media repo redirects | 移除了 `allow_redirect` |

### 线程与同步类

| MSC 编号    | 状态     | 前端文件                                               | 后端实现 | SDK 影响面                   | 备注                                                   |
| ----------- | -------- | ------------------------------------------------------ | -------- | ---------------------------- | ------------------------------------------------------ |
| **MSC3771** | Stable   | `src/models/thread.ts`                                 | ✅       | Thread root detection        | 标准化                                                 |
| **MSC3981** | Unstable | `src/models/thread.ts`, `src/@types/requests.ts`       | ✅       | Relations recursion          | `recurse` param                                        |
| **MSC4155** | Unstable | `src/invite-blocklist/index.ts`, `src/@types/event.ts` | ❌       | Invite filtering             | **Draft**, 后端不消费 `m.invite_permission_config`     |
| **MSC4157** | Unstable | `src/embedded.ts`                                      | ✅       | Delayed events (send/update) | `org.matrix.msc4157.*`                                 |
| **MSC4204** | Unstable | `src/models/invites-ignorer-types.ts`                  | ✅       | Password logout devices      | 后端借用号段，`PolicyRecommendation.Takedown` 为 Draft |

### 委托与认证类

| MSC 编号    | 状态     | 前端文件                                                                                   | 后端实现 | SDK 影响面                  | 备注                             |
| ----------- | -------- | ------------------------------------------------------------------------------------------ | -------- | --------------------------- | -------------------------------- |
| **MSC4108** | Unstable | `src/rendezvous/MSC4108SignInWithQR.ts`, `src/rendezvous/channels/MSC4108SecureChannel.ts` | ✅       | QR code signin              | 完整实现，依赖 `rendezvous` 端点 |
| **MSC4341** | Draft    | `src/oidc/register.ts`                                                                     | ❌       | OIDC registration           | **P3 豁免项**                    |
| **MSC4380** | Draft    | `src/invite-blocklist/index.ts`                                                            | ❌       | Invite blocklist management | **P3 豁免项** (同 MSC4155)       |

### 策略与治理类

| MSC 编号    | 状态     | 前端文件                                                               | 后端实现 | SDK 影响面         | 备注                        |
| ----------- | -------- | ---------------------------------------------------------------------- | -------- | ------------------ | --------------------------- |
| **MSC4284** | Unstable | `src/admin/sub-managers/admin-policy-manager.ts`, `src/admin/index.ts` | ✅       | Policy servers     | `m.policy.rule.*`           |
| **MSC4387** | Draft    | `src/http-api/errors.ts`                                               | ⚠️ Draft | Safety error codes | `ORG.MATRIX.MSC4387_SAFETY` |

### 其他实验性功能

| MSC 编号    | 状态     | 前端文件                                          | 后端实现 | SDK 影响面                  | 备注                                        |
| ----------- | -------- | ------------------------------------------------- | -------- | --------------------------- | ------------------------------------------- |
| **MSC2746** | Draft    | `src/web-rtc/call.ts`                             | ❌       | Legacy call init            | 废弃，用 MSC4143 替代                       |
| **MSC2762** | Unstable | `src/embedded.ts`                                 | ✅       | Widget state updates        | `M_STICKY`                                  |
| **MSC2966** | Stable   | `src/oidc/register.ts`                            | ✅       | OIDC client registration    | RFC8628 base URL                            |
| **MSC3088** | Stable   | `src/client-room-access.ts`, `src/models/room.ts` | ✅       | Space-room enabled flag     | `m.enabled`                                 |
| **MSC3230** | Stable   | `src/@types/event.ts`                             | ✅       | Space order                 | `space_order`                               |
| **MSC3391** | Stable   | `src/store/memory.ts`                             | ✅       | Deleted events              | Empty content = deleted                     |
| **MSC3827** | Stable   | `src/client-api-types.ts`                         | ✅       | Room type field             | `room_type` in join info                    |
| **MSC3874** | Draft    | `src/client-receipts.ts`                          | ❌       | Receipt threading           | 注释提及，未实现                            |
| **MSC3881** | Draft    | `src/push-notifications/index.ts`                 | ❌       | Remotely toggling push      | 注释提及；`enabled` 读写由 PushManager 覆盖 |
| **MSC4023** | Draft    | `src/client-receipts.ts`                          | ❌       | Homeless events fix         | 注释提及                                    |
| **MSC4115** | Unstable | `src/models/event.ts`                             | ✅       | Event relations aggregation | 已实现                                      |
| **MSC4140** | Unstable | `src/delayed-events/index.ts`, `src/embedded.ts`  | ✅       | Delayed events              | `org.matrix.msc4140`                        |
| **MSC4312** | Draft    | (未定位)                                          | ❌       | Unknown                     | 仅出现在注释                                |
| **MSC4354** | Unstable | `src/matrix-rtc/MatrixRTCSession.ts`              | ✅       | New membership event        | `m.rtc.member`                              |
| **MSC4407** | Unstable | `src/embedded.ts`                                 | ✅       | Sticky events               | 已实现                                      |
| **MSC4446** | Draft    | (未定位)                                          | ❌       | Unknown                     | 仅出现在注释                                |

### 临时回退路径

| MSC 编号             | 状态     | 前端文件                    | 后端实现 | SDK 影响面       | 备注                                     |
| -------------------- | -------- | --------------------------- | -------- | ---------------- | ---------------------------------------- |
| **im.nheko.summary** | Unstable | `src/room-summary/index.ts` | ❌       | Fallback summary | **P3 豁免项**，仅用于主摘要 404 时的降级 |

---

## P3 豁免项清单

以下路径 SDK 有封装但后端未实现，已在 `path-contract-waivers.json` 登记：

| SDK 调用                                           | 文件                        | 原因                                | Expires    | 消除条件                   |
| -------------------------------------------------- | --------------------------- | ----------------------------------- | ---------- | -------------------------- |
| `GET /v1/login/get_token`                          | `src/account/index.ts`      | 第三方登录 token 交换，后端无此端点 | 2026-12-31 | 删除封装或后端实现         |
| `GET /v3/register/captcha`                         | `src/auth/index.ts`         | 注册 captcha 校验，后端未实现       | 2026-12-31 | 后端引入 captcha 强制校验  |
| `POST /unstable/org.matrix.msc3720/account_status` | `src/account/index.ts`      | MSC3720 账户状态查询，后端仅 v3     | 2026-12-31 | 后端实现 unstable 前缀     |
| `POST /v3/oidc/register`                           | `src/oidc/manager.ts`       | OIDC registration 端点未实现        | 2026-12-31 | 后端实现 OIDC registration |
| `GET /unstable/im.nheko.summary/summary/{X}`       | `src/room-summary/index.ts` | 不稳定摘要回退路径                  | 2026-12-31 | 后端实现或移除回退逻辑     |
| `DELETE /v3/voice/{X}`                             | `src/voice/index.ts`        | 语音消息删除，后端无 DELETE 端点    | 2026-12-31 | 后端实现或 SDK 删除封装    |

**特殊豁免**（未计入 path-contract）：

- **MSC4143 (rtc/transports)**: 前端已实现 `GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports` 但后端未提供，需在 synapse-rust 中添加端点
- **MSC4155 (invite_permission_config)**: Draft 状态，后端不消费
- **MSC4380 (invite-blocklist)**: 同 MSC4155，Draft 状态
- **MSC4268 (room key bundle)**: Draft 状态，类型定义完整但后端未实现

---

## 维护命令

```bash
# 重新生成 MSC 映射表
node scripts/quality/generate-msc-mapping.js

# 检测 MSC 编号变更（对比后端 ledger）
node scripts/quality/check-msc-changes.mjs

# 检查 P3 豁免项过期
node scripts/quality/check-waiver-expiry.mjs
```

---

## 更新日志

| 日期       | 变更                       | 作者           |
| ---------- | -------------------------- | -------------- |
| 2026-10-01 | 初始版本，60+ MSC 编号映射 | SDK Audit Team |
| 2026-10-01 | 补充 P3 豁免项清单         | SDK Audit Team |

---

_本表依据 `synapse-rust` backend ledger (commit 7cb39946, 1149 entries) 与 SDK 源码交叉生成，最后更新于 2026-10-01_
