# SDK 全面测试与集成验证方案

> 本方案旨在验证 matrix-js-sdk 项目对后端功能封装的正确性与完整性，依托 `fullstack-redo-batch-b` 测试套件开展端到端验证。
> **范围声明**：本方案仅聚焦于测试方法论与实施路径，不涉及任何实际代码修改操作。

---

## 0. 方案总览

| 维度             | 说明                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| **测试代码位置** | `/Users/ljf/Desktop/hu_ts/docs/superpowers/plans/fullstack-redo-batch-b/`                            |
| **测试套件规模** | 24 个 Shell 脚本，覆盖 60+ 后端功能模块，约 700+ 测试用例                                            |
| **测试类型**     | 真实后端集成测试（Real Backend Integration）                                                         |
| **后端环境**     | synapse-rust 运行于 `https://matrix.test`，PostgreSQL 数据库                                         |
| **SDK 验证目标** | 每个 SDK Manager 方法正确封装对应后端路由，响应格式、数据准确性、异常处理符合契约                    |
| **执行入口**     | `run_all.sh`（批量） / 单脚本独立执行 / SDK 集成后通过 tsx 执行                                      |
| **结果产物**     | `results.csv`（机器可读） + `*_results.txt`（控制台日志） + `logs/*_fail_response.txt`（失败响应体） |

### 0.1 五大阶段关系图

```
[阶段1 测试代码分析] → 输出：测试覆盖矩阵
        │
        ▼
[阶段2 SDK 验证策略] → 输出：SDK↔后端映射表 + 判定标准
        │
        ▼
[阶段3 集成测试框架] → 输出：环境配置 + 执行顺序 + 依赖图
        │
        ▼
[阶段4 测试执行与验证] → 输出：执行结果 + 关联追溯
        │
        ▼
[阶段5 验证报告输出] → 输出：验收报告 + 差异清单
```

---

## 1. 测试代码分析阶段

### 1.1 测试框架结构分析

#### 1.1.1 整体目录结构

```
fullstack-redo-batch-b/
├── run_all.sh                    # 全量测试批量运行器
├── setup_accounts.sh             # 测试账号创建脚本（admin/user1/user2/guest）
├── test_helpers.sh               # 通用测试函数库（断言、HTTP、报告）
├── tokens.env                    # 动态生成的访问令牌（不入版本库）
├── 01_auth_compat.sh             # 24 个分模块测试脚本
├── 02_room.sh
├── ...
├── 24_rendezvous_guest_thirdparty.sh
├── results.csv                   # 全量测试结果（CSV 格式，机器可读）
├── *_results.txt                 # 各脚本控制台输出日志
└── logs/
    └── *_fail_response.txt       # 失败用例的完整响应体
```

#### 1.1.2 通用测试函数库（test_helpers.sh）核心能力

| 函数名                         | 用途                                       | 输出格式                                         |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------ |
| `assert_http_status`           | 断言 HTTP 状态码                           | `module,test_id,desc,PASS/FAIL,expected,actual,` |
| `assert_json_field`            | 用 jq 提取字段并精确比较                   | 同上                                             |
| `assert_json_contains`         | 字段包含子串断言                           | 同上                                             |
| `assert_response_time`         | 响应时间阈值断言                           | 同上                                             |
| `skip_test`                    | 跳过用例（前置失败时）                     | `...,SKIP,,reason,`                              |
| `http_request`                 | 标准 `/v3` 前缀请求 + 429 重试             | `<status>\n<body>`                               |
| `http_request_raw`             | 完整 URL 请求（用于 `/_synapse/admin` 等） | 同上                                             |
| `timed_request`                | 计时请求                                   | `<status>\n<duration>\n<body>`                   |
| `begin_module` / `begin_suite` | 模块/套件分隔符                            | 控制台彩色输出                                   |
| `print_summary`                | 单脚本汇总                                 | `PASS=X FAIL=Y SKIP=Z TOTAL=T 通过率=N%`         |

**关键工程特性**：

- 请求间节流：`REQUEST_MIN_INTERVAL=0.1s` 避免 nginx 限流；
- 429 自动重试：指数退避（1s → 2s → 4s），最多 3 次；
- 跨脚本间隔：`run_all.sh` 中脚本间 `sleep 2s`；
- CSV 统一格式：便于后续聚合分析与 SDK 关联。

#### 1.1.3 测试账号体系（setup_accounts.sh）

| 账号                        | 用途                                | 权限                                                  |
| --------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `@batchb-admin:matrix.test` | 管理员接口测试                      | `is_admin=true, user_type=super_admin`（DB 手动提升） |
| `@batchb-user1:matrix.test` | 主测试用户                          | 普通用户                                              |
| `@batchb-user2:matrix.test` | 副测试用户（shadow_ban / 房间成员） | 普通用户                                              |
| `@guest:matrix.test`        | 访客权限边界测试                    | Guest                                                 |

**鉴权流注意事项**：

- admin shared_secret 注册端点（P-075）未实现，需通过 PostgreSQL 直接更新 `users` 表提升管理员权限；
- 部分脚本（如 `12_friend_room.sh`）会动态注册额外测试账号（`batchb-friend-*` / `batchb-group-*`）。

### 1.2 测试用例梳理

#### 1.2.1 模块覆盖矩阵（24 脚本 → 60+ 功能模块）

| 脚本                                     | 模块名                                                                                                                                          | 覆盖后端功能范围                                                                                   | 测试 ID 前缀                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `01_auth_compat.sh`                      | auth_compat                                                                                                                                     | 注册/登录/登出/刷新/可用性/r0+v3 兼容                                                              | AUTH-001 ~ AUTH-054                                                                      |
| `02_room.sh`                             | room                                                                                                                                            | 创建房间/状态/成员/消息/邀请/离开/踢出/可见性                                                      | ROOM-\*                                                                                  |
| `03_media.sh`                            | media                                                                                                                                           | 媒体配置/上传/下载/缩略图/预览 URL/大文件边界                                                      | MEDIA-\*                                                                                 |
| `04_sync.sh`                             | sync                                                                                                                                            | 初始同步/增量同步/过滤器/滑动同步                                                                  | SYNC-\*                                                                                  |
| `05_e2ee.sh`                             | e2ee                                                                                                                                            | 密钥上传/查询/认领 + 设备 + room_keys + 签名 + 能力                                                | E2EE-\*                                                                                  |
| `06_presence_typing.sh`                  | presence+typing                                                                                                                                 | 在线状态 + 输入指示器                                                                              | PRES-_ / TYP-_                                                                           |
| `07_push.sh`                             | push+push_rules+notifications                                                                                                                   | 推送器 + 推送规则 + 通知                                                                           | PUSH-\*                                                                                  |
| `08_device.sh`                           | device                                                                                                                                          | 设备管理（~6 端点）                                                                                | DEV-\*                                                                                   |
| `09_relations_reactions_receipts.sh`     | relations+reactions+receipts                                                                                                                    | 关系/反应/已读回执                                                                                 | REL-_ / REACT-_ / RCPT-\*                                                                |
| `10_account_data.sh`                     | account_data                                                                                                                                    | 账户数据（~13 端点）                                                                               | AD-\*                                                                                    |
| `11_widget.sh`                           | widget                                                                                                                                          | 小部件（~18 端点）                                                                                 | WIDGET-\*                                                                                |
| `12_friend_room.sh`                      | friend_room                                                                                                                                     | 好友 + 好友房间（~70 端点）                                                                        | FR-001 ~ FR-077                                                                          |
| `13_burn_after_read.sh`                  | burn_after_read                                                                                                                                 | 阅后即焚（v1+v3 共 14 端点）                                                                       | BAR-\*                                                                                   |
| `14_voip_voice.sh`                       | voip_voice                                                                                                                                      | VoIP + Voice（~38 路由）                                                                           | VOIP-_ / VOICE-_                                                                         |
| `15_t3_standard.sh`                      | tags/directory/pinned/sticky_event/ephemeral/context/event_report/room_summary                                                                  | T3 标准模块集合                                                                                    | TAG-_ / DIR-_ / PIN-_ / STK-_ / EPH-_ / CTX-_ / ER-_ / RS-_                              |
| `16_t4_edge.sh`                          | t4_edge                                                                                                                                         | T4 边缘模块集合                                                                                    | 多前缀                                                                                   |
| `17_t3_remaining.sh`                     | delayed_events/moderation/sliding_sync/space/rtc_transports/dehydrated_device/extended_profile/thread/search/hierarchy/invite_blocklist/captcha | T3 剩余模块集合                                                                                    | DE-_ / MOD-_ / SS-_ / SP-_ / RTC-_ / DD-_ / EP-_ / THR-_ / SRCH-_ / HIE-_ / IB-_ / CAP-_ |
| `18_t4_remaining.sh`                     | dm/key_rotation/ai_connection/openclaw/rendezvous/app_service/external_service/background_update/module                                         | T4 剩余模块集合                                                                                    | DM-_ / KR-_ / AIC-_ / OC-_ / RV-_ / AS-_ / ES-_ / BU-_ / MOD-\*                          |
| `19_turn_special.sh`                     | turn_special                                                                                                                                    | TURN 服务器特殊场景                                                                                | TURN-\*                                                                                  |
| `20_account_compat.sh`                   | account_compat                                                                                                                                  | whoami/profile/3pid/threepid/well-known                                                            | ACC-\*                                                                                   |
| `21_admin.sh`                            | admin                                                                                                                                           | /\_synapse/admin 全套（info/users/rooms/media/tokens/audit/reports/security/federation/retention） | ADM-001 ~ ADM-051                                                                        |
| `22_captcha_feature_telemetry.sh`        | captcha/feature_flags/telemetry/worker                                                                                                          | 验证码 + 功能开关 + 遥测 + 工作节点                                                                | CAP-_ / FF-_ / TL-_ / WRK-_                                                              |
| `23_key_backup_rotation_verification.sh` | key_backup/key_rotation/verification_routes                                                                                                     | 密钥备份 + 轮换 + 验证                                                                             | KB-_ / KR-_ / VF-\*                                                                      |
| `24_rendezvous_guest_thirdparty.sh`      | rendezvous/msc4108_rendezvous/guest/thirdparty/push_notification                                                                                | Rendezvous + 访客 + 第三方协议 + 推送通知                                                          | RDV-_ / MSC-_ / GST-_ / TP-_ / PN-\*                                                     |

#### 1.2.2 测试用例分类维度

按断言类型分类：

| 类型                                         | 占比（估算） | 验证目的                                    |
| -------------------------------------------- | ------------ | ------------------------------------------- |
| **HTTP 状态码断言**（`assert_http_status`）  | ~70%         | 路由可达性 + 鉴权 + 请求格式合规            |
| **JSON 字段精确匹配**（`assert_json_field`） | ~15%         | 响应体数据准确性                            |
| **JSON 字段包含**（`assert_json_contains`）  | ~10%         | 响应体结构合规                              |
| **响应时间断言**（`assert_response_time`）   | ~3%          | 性能基准（P95 < 100ms ~ 200ms）             |
| **复合条件断言**（脚本内 `if` 判断）         | ~2%          | 多状态码容错（如 `200\|404\|409` 幂等场景） |

按测试场景类型分类：

| 场景                            | 涵盖用例 | 验证重点                                              |
| ------------------------------- | -------- | ----------------------------------------------------- |
| **正向用例**（Happy Path）      | ~50%     | 标准请求返回 200 + 正确响应体                         |
| **异常用例**（Error Path）      | ~30%     | 缺参/无效参数/鉴权失败 → 4xx + 正确 errcode           |
| **边界用例**（Boundary）        | ~12%     | 长字符串/limit 边界/重复操作幂等性                    |
| **权限用例**（Authorization）   | ~6%      | 普通用户访问 admin → 403、无 token → 401、guest → 403 |
| **兼容性用例**（Compatibility） | ~2%      | r0/v3 双版本路由等价性                                |

### 1.3 核心测试场景识别

#### 1.3.1 鉴权场景

- **登录流验证**：`m.login.password` / `m.login.token` / 缺 type 推断 / 错误密码 / 不存在用户；
- **Token 生命周期**：登录获取 token → whoami 验证 → logout 失效 → 再次 whoami 返回 401；
- **Refresh Token**：刷新机制 + 无效/缺失 refresh_token 异常处理；
- **r0/v3 双版本**：所有核心端点的版本路径兼容性。

#### 1.3.2 数据一致性场景

- **好友关系全生命周期**：发送请求 → 对方接受 → 验证 is_friend=true → 删除 → 验证 is_friend=false；
- **房间创建与成员同步**：createRoom → invite → join → leave → 验证成员状态；
- **好友分组管理**：创建 → 重命名 → 添加成员 → 移除成员 → 删除 → 重复操作幂等性。

#### 1.3.3 错误处理场景

- **缺失必填字段**：返回 400 + 正确错误码（如 `M_BAD_JSON`）；
- **无效 ID 格式**：返回 400；
- **重复资源操作**：返回 400/409/200（幂等场景）；
- **越权访问**：普通用户访问 admin → 403，无 token → 401，guest → 403。

#### 1.3.4 性能基准场景

- 关键端点 P95 响应时间：whoami < 100ms、login < 200ms、register/available < 100ms；
- 用于回归检测性能退化。

### 1.4 测试覆盖范围文档化

#### 1.4.1 已识别的覆盖盲区

| 盲区                   | 说明                                                                   | 影响评估                                            |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| **OIDC 流程**          | OIDC 端点在测试环境中返回 404/M_UNRECOGNIZED，部分用例需 graceful skip | 中：与项目 memory 中"OIDC 未启用时优雅处理"约束一致 |
| **SAML/CAS 实际登录**  | 仅验证 flow 列表返回，未走完整 SSO 重定向                              | 低：SSO 流程由前端处理                              |
| **WebRTC 媒体流**      | 仅验证 calling 协议端点，未实际建立媒体连接                            | 低：媒体连接验证需专门工具                          |
| **大文件上传分片**     | 仅验证大小边界，未验证分片续传                                         | 中：分片续传建议补充单元测试                        |
| **跨设备 E2EE 完整性** | 仅验证密钥上传/查询，未跨设备实际加解密消息                            | 中：跨设备加解密建议在 SDK 单元测试覆盖             |

#### 1.4.2 测试套件覆盖的后端功能范围（输出文档）

测试套件覆盖以下 60+ 后端功能模块，按重要性分级：

- **T1 核心模块**（必须 100% 通过）：auth_compat、room、sync、e2ee、admin
- **T2 重要模块**（通过率应 ≥ 95%）：friend_room、device、push、media、account_data、widget、relations+reactions+receipts、presence+typing、burn_after_read、voip_voice
- **T3 标准模块**（通过率应 ≥ 90%）：tags、directory、pinned、sticky_event、ephemeral、context、event_report、room_summary、delayed_events、moderation、sliding_sync、space、rtc_transports、dehydrated_device、extended_profile、thread、search、hierarchy、invite_blocklist、captcha
- **T4 边缘模块**（通过率应 ≥ 85%）：dm、key_rotation、ai_connection、openclaw、rendezvous、app_service、external_service、background_update、module、key_backup、verification_routes、rendezvous_msc4108、guest、thirdparty、push_notification、turn_special、account_compat、captcha_admin、feature_flags、telemetry、worker

---

## 2. SDK 验证策略

### 2.1 SDK 方法 ↔ 后端接口映射关系建立

#### 2.1.1 映射表结构

每个映射条目包含以下字段：

| 字段                   | 说明                                               |
| ---------------------- | -------------------------------------------------- |
| `sdk_module`           | SDK 模块路径（如 `src/friend/`）                   |
| `sdk_manager`          | Manager 类名（如 `FriendManager`）                 |
| `sdk_method`           | SDK 公开方法名（如 `sendFriendRequest`）           |
| `backend_route`        | 后端路由（method + path，如 `POST /v3/friends`）   |
| `test_script`          | 对应测试脚本（如 `12_friend_room.sh`）             |
| `test_ids`             | 对应测试用例 ID 列表（如 `FR-007,FR-008,FR-009`）  |
| `contract_route_table` | SDK 中 `__generated__/route-table.ts` 中的路由常量 |
| `validation_level`     | 验证级别（FULL / PARTIAL / SKIP）                  |

#### 2.1.2 模块映射总览（SDK 模块 ↔ 测试脚本）

| SDK 模块路径                                                                                                                                                                            | SDK Manager                         | 对应测试脚本                             | 验证级别 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- | -------- |
| `src/auth/`                                                                                                                                                                             | `AuthManager`                       | `01_auth_compat.sh`                      | FULL     |
| `src/room/`                                                                                                                                                                             | `RoomManager`                       | `02_room.sh`                             | FULL     |
| `src/media/`                                                                                                                                                                            | `MediaManager`                      | `03_media.sh`                            | FULL     |
| `src/sync/` + `src/sliding-sync/`                                                                                                                                                       | (内置 sync)                         | `04_sync.sh`                             | FULL     |
| `src/e2ee/` + `src/crypto-keys/`                                                                                                                                                        | (crypto)                            | `05_e2ee.sh`                             | FULL     |
| `src/presence/` + `src/typing/`                                                                                                                                                         | `PresenceManager` + `TypingManager` | `06_presence_typing.sh`                  | FULL     |
| `src/push/` + `src/push-rules/` + `src/notifications/`                                                                                                                                  | `PushManager`                       | `07_push.sh`                             | FULL     |
| `src/device/` + `src/device-keys/`                                                                                                                                                      | `DeviceManager`                     | `08_device.sh`                           | FULL     |
| `src/relations/` + `src/reactions/` + `src/read-receipts/`                                                                                                                              | (内置)                              | `09_relations_reactions_receipts.sh`     | FULL     |
| `src/account-data/`                                                                                                                                                                     | `AccountDataManager`                | `10_account_data.sh`                     | FULL     |
| `src/widget/`（如有）                                                                                                                                                                   | (内置)                              | `11_widget.sh`                           | PARTIAL  |
| `src/friend/`                                                                                                                                                                           | `FriendManager` + 3 子 Manager      | `12_friend_room.sh`                      | FULL     |
| `src/burn-after-read/`                                                                                                                                                                  | `BurnAfterReadManager`              | `13_burn_after_read.sh`                  | FULL     |
| `src/web-rtc/` + `src/voice/`                                                                                                                                                           | (内置 VoIP)                         | `14_voip_voice.sh`                       | PARTIAL  |
| `src/tags/` + `src/directory/` + `src/pinned-messages/` + `src/ephemeral/` + `src/event-report/` + `src/room-summary/`                                                                  | 各对应 Manager                      | `15_t3_standard.sh`                      | FULL     |
| `src/room-creation/` + `src/room-alias/` 等                                                                                                                                             | (T4 边缘集合)                       | `16_t4_edge.sh`                          | PARTIAL  |
| `src/space/` + `src/sliding-sync/` + `src/moderation/` + `src/dehydrated-device/` + `src/thread/` + `src/search/` + `src/invite-blocklist/` + `src/captcha/`                            | 各对应 Manager                      | `17_t3_remaining.sh`                     | FULL     |
| `src/dm/` + `src/key-rotation/` + `src/ai-connection/` + `src/open-claw/` + `src/rendezvous/` + `src/app-service/` + `src/external-service/` + `src/background-update/` + `src/module/` | 各对应 Manager                      | `18_t4_remaining.sh`                     | FULL     |
| `src/turn-server/`                                                                                                                                                                      | `TurnServerManager`                 | `19_turn_special.sh`                     | FULL     |
| `src/account/` + `src/profile/` + `src/three-pids/`                                                                                                                                     | `AccountManager` + `ProfileManager` | `20_account_compat.sh`                   | FULL     |
| `src/admin/` + 6 子 Manager                                                                                                                                                             | `AdminManager`                      | `21_admin.sh`                            | FULL     |
| `src/captcha/` + `src/feature-flags/` + `src/telemetry/`                                                                                                                                | 各对应 Manager                      | `22_captcha_feature_telemetry.sh`        | FULL     |
| `src/key-backup/` + `src/key-rotation/` + `src/verification/`                                                                                                                           | 各对应 Manager                      | `23_key_backup_rotation_verification.sh` | FULL     |
| `src/rendezvous/` + `src/guest/` + `src/third-party/` + `src/push-notifications/`                                                                                                       | 各对应 Manager                      | `24_rendezvous_guest_thirdparty.sh`      | FULL     |

#### 2.1.3 详细映射表示例（friend 模块片段）

| SDK 方法                               | 后端路由                                       | 测试 ID                 | 验证点                                                                               |
| -------------------------------------- | ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `FriendManager.listFriends()`          | `GET /v3/friends`                              | FR-001 ~ FR-006         | 200 + friends 字段 + 401 + limit clamp + offset 弃用                                 |
| `FriendManager.sendFriendRequest()`    | `POST /v3/friends`                             | FR-007 ~ FR-012         | 200 + request_id + status=pending + 重复 400/409 + 自加 400 + 缺参 422 + 无效 ID 400 |
| `FriendManager.listIncomingRequests()` | `GET /v3/friends/requests/incoming`            | FR-013 ~ FR-015         | 200 + requests 数组 + 包含 USER1                                                     |
| `FriendManager.listOutgoingRequests()` | `GET /v3/friends/requests/outgoing`            | FR-016 ~ FR-017         | 200 + 包含 FRIEND                                                                    |
| `FriendManager.acceptRequest()`        | `POST /v1/friends/request/{uid}/accept`        | FR-018 ~ FR-020         | 200 + room_id + status=accepted + 重复 400/404/409                                   |
| `FriendManager.checkFriendship()`      | `GET /v3/friends/check/{uid}`                  | FR-021 ~ FR-023, FR-076 | 200 + is_friend=true/false                                                           |
| `FriendManager.updateNote()`           | `PUT /v1/friends/{uid}/note`                   | FR-024 ~ FR-027         | 200 + note 字段 + 超长 400 + 非好友 404                                              |
| `FriendManager.updateStatus()`         | `PUT /v1/friends/{uid}/status`                 | FR-028 ~ FR-031         | 200 + status 字段 + 无效值 400 + GET 200                                             |
| `FriendManager.getFriendInfo()`        | `GET /v1/friends/{uid}/info`                   | FR-032 ~ FR-033         | 200 + 非好友 404                                                                     |
| `FriendManager.updateDisplayName()`    | `PUT /v1/friends/{uid}/displayname`            | FR-034 ~ FR-037         | 200 + displayname + 空 400 + 超长 400                                                |
| `FriendManager.getSuggestions()`       | `GET /v1/friends/suggestions`                  | FR-038 ~ FR-040         | 200 + suggestions + limit                                                            |
| `FriendGroupManager.createGroup()`     | `POST /v1/friends/groups`                      | FR-041 ~ FR-045         | 200 + group_id + 空 400 + 超长 400 + GET 列表                                        |
| `FriendGroupManager.renameGroup()`     | `PUT /v1/friends/groups/{gid}/name`            | FR-046                  | 200                                                                                  |
| `FriendGroupManager.addMember()`       | `POST /v1/friends/groups/{gid}/add/{uid}`      | FR-047 ~ FR-048         | 200 + 重复 200/409                                                                   |
| `FriendGroupManager.listMembers()`     | `GET /v1/friends/groups/{gid}/friends`         | FR-049 ~ FR-050         | 200 + friends                                                                        |
| `FriendManager.getUserGroups()`        | `GET /v1/friends/{uid}/groups`                 | FR-051 ~ FR-052         | 200 + groups                                                                         |
| `FriendGroupManager.removeMember()`    | `DELETE /v1/friends/groups/{gid}/remove/{uid}` | FR-053                  | 200                                                                                  |
| `FriendGroupManager.deleteGroup()`     | `DELETE /v1/friends/groups/{gid}`              | FR-054 ~ FR-055         | 200 + 重复 404/200                                                                   |
| `DirectMessageManager.getOrCreateDm()` | `GET/POST /v1/friends/dm/{uid}`                | FR-056 ~ FR-059         | 200 + room_id + created                                                              |
| `FriendManager.searchFriends()`        | `POST/GET /v3/friends/search`                  | FR-060 ~ FR-063         | 200 + results + 空 400 + GET 支持                                                    |
| `FriendManager.rejectRequest()`        | `POST /v1/friends/request/{uid}/reject`        | FR-068 ~ FR-069         | 200 + status=rejected                                                                |
| `FriendManager.cancelRequest()`        | `POST /v1/friends/request/{uid}/cancel`        | FR-071 ~ FR-072         | 200 + status=cancelled                                                               |
| `FriendManager.deleteFriend()`         | `DELETE /v1/friends/{uid}`                     | FR-074 ~ FR-077         | 200 + removed=true + 删除后 is_friend=false + 重复幂等                               |

> 完整映射表按上述格式逐模块填充，作为阶段 5 验证报告附录 A。

### 2.2 验证流程设计

#### 2.2.1 单 SDK 方法验证流程（逐方法确认）

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: 路由常量校验                                          │
│   - 确认 SDK __generated__/route-table.ts 中存在该路由常量    │
│   - 确认 method + path 与后端 Ledger 一致                    │
│   - 执行：pnpm contract:codegen:check                       │
├─────────────────────────────────────────────────────────────┤
│ Step 2: 测试用例关联                                          │
│   - 在映射表中找到该 SDK 方法对应的 test_id 列表               │
│   - 确认覆盖：正向 + 异常 + 边界（最少 3 类场景）              │
├─────────────────────────────────────────────────────────────┤
│ Step 3: 执行测试用例                                          │
│   - 通过 run_all.sh 或单脚本执行                              │
│   - 收集 results.csv 中该 test_id 的执行结果                  │
├─────────────────────────────────────────────────────────────┤
│ Step 4: SDK 调用对比（可选）                                   │
│   - 编写 SDK 调用脚本（tsx）调用同一 SDK 方法                  │
│   - 对比 SDK 返回与 HTTP 直接请求的响应是否一致                │
├─────────────────────────────────────────────────────────────┤
│ Step 5: 异常路径验证                                          │
│   - 确认 SDK 在后端返回 4xx/5xx 时抛出正确类型异常             │
│   - 确认 SDK 不会吞掉异常（参考 quality:swallow-fallbacks）   │
├─────────────────────────────────────────────────────────────┤
│ Step 6: 标记验证结果                                          │
│   - FULL：所有相关 test_id 通过 + SDK 调用一致                │
│   - PARTIAL：部分通过或仅 HTTP 验证未做 SDK 调用对比           │
│   - SKIP：测试套件未覆盖或后端不可用                           │
└─────────────────────────────────────────────────────────────┘
```

#### 2.2.2 批量验证流程（按模块批量确认）

1. **契约同步检查**：`pnpm contract:sync && pnpm contract:codegen:check`，确保 SDK 路由表与后端 Ledger 一致；
2. **执行模块测试脚本**：如 `bash 12_friend_room.sh`，收集 `results.csv` 中 `module=friend_room` 的所有用例；
3. **聚合通过率**：计算该模块 PASS/FAIL/SKIP 比例；
4. **SDK 方法抽样**：从映射表中随机抽取 20% 的 SDK 方法，编写 tsx 调用脚本对比响应；
5. **差异记录**：任何 SDK 返回与 HTTP 直接响应不一致的项记入差异清单。

### 2.3 正确性与完整性判定标准

#### 2.3.1 正确性维度

| 子维度             | 判定标准                                                                                                                     | 验证方法                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **响应格式合规性** | SDK 返回的 JSON 结构与后端响应字段一致（字段名、类型、可空性）                                                               | jq 提取后端响应字段 → 对比 SDK TypeScript 接口定义 |
| **数据准确性**     | SDK 解析后的值与后端原始响应值相等（含数值类型、字符串、布尔）                                                               | 同一字段在后端响应和 SDK 返回对象中比对            |
| **异常处理有效性** | 后端返回 4xx/5xx 时，SDK 抛出对应类型异常（`MatrixError` / `ConnectionError` / `HTTPError`），且 `errcode`、`error` 字段保留 | 触发异常场景，捕获 SDK 异常并检查 `errcode` 属性   |
| **状态码语义对齐** | SDK 不应将 4xx 当成成功；429 应触发 `ConnectionError` 重试逻辑                                                               | 检查 SDK 内部 http-api 错误处理路径                |
| **错误码契约**     | 后端返回的 `errcode`（如 `M_FORBIDDEN`、`M_USER_IN_USE`、`M_MISSING_TOKEN`）应在 SDK 错误对象中保留                          | 检查 `MatrixError.errcode` 字段                    |

**正确性合格门槛**：

- 所有 T1 核心模块 SDK 方法：100% 通过；
- T2 重要模块：≥ 95% 通过；
- T3/T4 模块：≥ 85% 通过；
- 任何模块的异常路径必须有 SDK 异常类型匹配，不得出现 `unknown` 错误。

#### 2.3.2 完整性维度

| 子维度             | 判定标准                                                    | 验证方法                                                            |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| **功能覆盖度**     | SDK Manager 暴露的公开方法数 ≥ 后端 Ledger 中该模块的路由数 | 对比 `__generated__/route-table.ts` 中的路由数与 Manager 公开方法数 |
| **路由覆盖度**     | SDK 路由表 100% 覆盖后端 Ledger 中的路由                    | `pnpm contract:codegen:check` 通过                                  |
| **边缘场景适配性** | 测试套件中该模块的边界用例（超长/空值/重复/幂等）100% 通过  | 从 `results.csv` 筛选该模块所有用例，统计边界用例通过率             |
| **版本兼容性**     | r0/v3 双版本路由在 SDK 中都有对应方法或显式 deprecated 标记 | 检查 SDK 方法的 `@deprecated` 注解 + r0 路由表覆盖                  |
| **参数完整性**     | SDK 方法签名包含后端路由的所有必填查询参数和请求体字段      | 对比 SDK 方法参数类型与 `__generated__/dto.ts` 中的请求 DTO         |

**完整性合格门槛**：

- SDK 路由覆盖率 = 100%（与后端 Ledger 完全对齐，参考项目硬约束）；
- T1/T2 模块的边缘场景用例通过率 = 100%；
- T3 模块边缘场景通过率 ≥ 90%；
- T4 模块边缘场景通过率 ≥ 80%。

---

## 3. 集成测试框架

### 3.1 分步操作流程

#### 3.1.1 测试环境搭建流程

```
┌─ Step 1: 后端环境准备 ─────────────────────────────────────┐
│  1.1 启动 synapse-rust：https://matrix.test                 │
│  1.2 启动 PostgreSQL（容器名：synapse-test-postgres）        │
│  1.3 验证 /_matrix/client/versions 返回 200 + 版本列表       │
│  1.4 验证 nginx 限流配置（测试期间建议临时放宽 burst）        │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ Step 2: CA 证书信任 ──────────────────────────────────────┐
│  2.1 设置 NODE_EXTRA_CA_CERTS 指向自签名 CA                 │
│   或                                                          │
│  2.2 设置 MATRIX_REAL_BACKEND_CA_CERT 指向后端证书           │
│   或                                                          │
│  2.3 使用 mkcert 生成本地信任的根 CA                          │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ Step 3: SDK 构建准备 ─────────────────────────────────────┐
│  3.1 cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk              │
│  3.2 pnpm install                                            │
│  3.3 pnpm build  （clean + compile + types）                 │
│  3.4 验证 lib/ 目录已生成                                    │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ Step 4: 测试账号初始化 ───────────────────────────────────┐
│  4.1 cd /Users/ljf/Desktop/hu_ts/docs/superpowers/plans/   │
│      fullstack-redo-batch-b/                                │
│  4.2 bash setup_accounts.sh                                 │
│      - 创建 admin / user1 / user2 / guest 四个账号          │
│      - DB 提升管理员权限                                     │
│      - 生成 tokens.env                                       │
│  4.3 验证 tokens.env 中 4 个 token 都非空                   │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ Step 5: 单脚本冒烟测试 ───────────────────────────────────┐
│  5.1 bash 01_auth_compat.sh                                 │
│  5.2 检查 01_auth_compat_results.txt 通过率 ≥ 95%           │
│  5.3 失败则排查环境问题（token / 网络 / 证书 / 限流）        │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ Step 6: 契约同步检查 ─────────────────────────────────────┐
│  6.1 cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk              │
│  6.2 pnpm contract:check                                    │
│  6.3 pnpm contract:codegen:check                            │
│  6.4 确认 SDK 路由表与后端 Ledger 完全对齐                  │
└────────────────────────────────────────────────────────────┘
```

#### 3.1.2 测试执行顺序与依赖关系

```
[setup_accounts.sh] ← 所有脚本的隐式前置
        │
        ├─► [01_auth_compat.sh]    ← 基础鉴权，无依赖
        ├─► [02_room.sh]           ← 创建测试房间，被 21_admin.sh 依赖
        ├─► [03_media.sh]          ← 独立
        ├─► [04_sync.sh]           ← 依赖 02 创建的房间数据
        ├─► [05_e2ee.sh]           ← 依赖 01 的登录 token
        ├─► [06_presence_typing.sh]← 依赖 02 的房间
        ├─► [07_push.sh]           ← 独立
        ├─► [08_device.sh]         ← 独立
        ├─► [09_relations_reactions_receipts.sh] ← 依赖 02 的房间 + 消息
        ├─► [10_account_data.sh]   ← 独立
        ├─► [11_widget.sh]         ← 依赖 02 的房间
        ├─► [12_friend_room.sh]    ← 内部自注册测试账号，独立
        ├─► [13_burn_after_read.sh]← 依赖 02 的房间 + 消息
        ├─► [14_voip_voice.sh]     ← 依赖 02 的房间
        ├─► [15_t3_standard.sh]    ← 依赖 02 的房间
        ├─► [16_t4_edge.sh]        ← 依赖 02 的房间
        ├─► [17_t3_remaining.sh]   ← 多模块集合，部分依赖 02
        ├─► [18_t4_remaining.sh]   ← 多模块集合
        ├─► [19_turn_special.sh]   ← 独立
        ├─► [20_account_compat.sh] ← 独立
        ├─► [21_admin.sh]          ← 内部创建测试房间，依赖 admin token
        ├─► [22_captcha_feature_telemetry.sh] ← 依赖 admin token
        ├─► [23_key_backup_rotation_verification.sh] ← 依赖 05 的密钥
        └─► [24_rendezvous_guest_thirdparty.sh] ← 独立
```

**强依赖关系**（必须按序执行）：

1. `setup_accounts.sh` → 所有脚本；
2. `01_auth_compat.sh` → 任何依赖有效 token 的脚本；
3. `02_room.sh` → `04_sync.sh`、`06_*.sh`、`09_*.sh`、`13_*.sh`、`14_*.sh`、`15_*.sh`、`16_*.sh`、`17_*.sh`、`21_admin.sh`（部分用例）。

**弱依赖关系**（建议按序，但失败不影响后续）：

- `05_e2ee.sh` → `23_key_backup_rotation_verification.sh`（密钥体系延续）。

**可并行执行组**（在资源充足时）：

- 组 A：`07_push.sh`、`08_device.sh`、`10_account_data.sh`、`19_turn_special.sh`、`20_account_compat.sh`；
- 组 B：`12_friend_room.sh`、`24_rendezvous_guest_thirdparty.sh`（均自管理测试账号）。

### 3.2 测试环境配置方案（与生产对齐）

#### 3.2.1 环境变量配置

| 环境变量                      | 值 / 来源                                   | 用途                                 |
| ----------------------------- | ------------------------------------------- | ------------------------------------ |
| `BASE_URL`                    | `https://matrix.test`                       | 后端基地址                           |
| `SERVER_NAME`                 | `matrix.test`                               | 服务器域名                           |
| `ADMIN_SECRET`                | `dev_admin_secret_dev_admin_secret_dev_01`  | 管理员 shared_secret（测试环境固定） |
| `REGISTRATION_SECRET`         | `dev_registration_secret_dev_reg_secret_01` | 注册 shared_secret                   |
| `TEST_PASSWORD`               | `BatchB@Test2026`                           | 测试账号统一密码                     |
| `NODE_EXTRA_CA_CERTS`         | `/path/to/ca-cert.pem`                      | Node.js 信任自签名证书               |
| `MATRIX_REAL_BACKEND_CA_CERT` | `/path/to/leaf-cert.pem`                    | SDK 真实后端测试 CA                  |
| `REQUEST_MIN_INTERVAL`        | `0.1`（默认）                               | 请求间最小间隔（秒）                 |
| `LOG_DIR`                     | `./logs`                                    | 失败响应日志目录                     |
| `RESULTS_FILE`                | `./results.csv`                             | 结果 CSV 路径                        |

#### 3.2.2 后端服务对齐检查清单

| 检查项                   | 期望状态                                 | 验证命令                                                                    |
| ------------------------ | ---------------------------------------- | --------------------------------------------------------------------------- |
| synapse-rust 进程运行    | active (running)                         | `curl -sk https://matrix.test/_matrix/client/versions` 返回 200             |
| PostgreSQL 容器运行      | Up                                       | `docker ps \| grep synapse-test-postgres`                                   |
| nginx 限流 burst         | ≥ 100（测试期）                          | 检查 nginx.conf `limit_req zone burst=100`                                  |
| admin shared_secret 端点 | 未实现（P-075）                          | `GET /_synapse/admin/v1/register/nonce` 返回 404                            |
| OIDC 端点                | 未启用                                   | `GET /_matrix/client/v3/account/userId` OIDC 流程返回 404                   |
| 测试账号已创建           | 4 个账号均存在                           | 查询 `users` 表 `WHERE user_id LIKE '@batchb-%'`                            |
| admin 权限提升           | `is_admin=true, user_type='super_admin'` | 查询 `users` 表                                                             |
| 后端 Ledger 导出         | 最新                                     | `declared_route_manifest_for()` 输出已同步到 `docs/api-contract/generated/` |

#### 3.2.3 SDK 构建配置对齐

| 配置项          | 期望值                | 验证命令                         |
| --------------- | --------------------- | -------------------------------- |
| TypeScript 编译 | 0 errors              | `pnpm lint:types`                |
| ESLint 检查     | 0 errors / 0 warnings | `pnpm lint:js`                   |
| 契约同步        | 通过                  | `pnpm contract:check`            |
| 契约代码生成    | 通过                  | `pnpm contract:codegen:check`    |
| 类型覆盖率      | 无新增 `any`          | `pnpm quality:type-coverage`     |
| 吞异常检查      | 无空 catch            | `pnpm quality:swallow-fallbacks` |
| SDK 构建        | lib/ 已生成           | `pnpm build`                     |

---

## 4. 测试执行与验证流程

### 4.1 测试执行操作步骤

#### 4.1.1 全量测试执行

```bash
# 步骤 1: 切换到测试目录
cd /Users/ljf/Desktop/hu_ts/docs/superpowers/plans/fullstack-redo-batch-b/

# 步骤 2: （可选）清理旧结果
rm -f results.csv logs/*_fail_response.txt *_results.txt

# 步骤 3: 重新生成测试账号（如 tokens.env 过期或缺失）
bash setup_accounts.sh

# 步骤 4: 执行全量测试
bash run_all.sh 2>&1 | tee full_run.log

# 步骤 5: 查看汇总
# run_all.sh 末尾会自动输出按模块聚合的 PASS/FAIL/SKIP 统计
```

#### 4.1.2 单模块测试执行

```bash
cd /Users/ljf/Desktop/hu_ts/docs/superpowers/plans/fullstack-redo-batch-b/

# 执行单个模块（保留旧的 results.csv，追加结果）
MODULE_NAME="friend_room" bash 12_friend_room.sh 2>&1 | tee 12_friend_room_results.txt

# 仅查看该模块结果
grep "^friend_room," results.csv
```

#### 4.1.3 SDK 集成验证执行（tsx 调用对比）

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk/

# 步骤 1: 确认 SDK 已构建
pnpm build

# 步骤 2: 执行 SDK 真实后端测试（按模块）
pnpm test:real-backend:setup                              # 确保测试账号存在
pnpm run test:real-backend:tsx -- spec/integ/real-backend/<module>.test.ts

# 步骤 3: 批量执行
pnpm test:real-backend:batch
```

#### 4.1.4 失败用例复现与诊断

```bash
cd /Users/ljf/Desktop/hu_ts/docs/superpowers/plans/fullstack-redo-batch-b/

# 步骤 1: 查看失败用例列表
awk -F',' 'NR>1 && $4=="FAIL" {print $1","$2","$3}' results.csv

# 步骤 2: 查看具体失败响应
cat logs/<TEST_ID>_fail_response.txt

# 步骤 3: 手动复现失败请求（参考脚本中对应 TEST_ID 的 curl 命令）
source tokens.env
curl -sk -X <METHOD> "https://matrix.test/_matrix/client<PATH>" \
  -H "Authorization: Bearer $USER1_TOKEN" \
  -H "Content-Type: application/json" \
  -d '<BODY>'

# 步骤 4: 对比 SDK 调用结果（如有差异）
# 编写最小 tsx 脚本调用 SDK 对应方法，对比响应
```

### 4.2 测试结果采集与分析方法

#### 4.2.1 结果数据源

| 数据源                     | 格式                                                                 | 用途               |
| -------------------------- | -------------------------------------------------------------------- | ------------------ |
| `results.csv`              | CSV: `module,test_id,description,status,expected,actual,duration_ms` | 机器聚合分析       |
| `*_results.txt`            | 纯文本（带 ANSI 颜色）                                               | 控制台输出审计     |
| `logs/*_fail_response.txt` | JSON / HTML                                                          | 失败用例响应体诊断 |
| SDK 测试输出               | Vitest 标准输出                                                      | SDK 调用层结果     |

#### 4.2.2 聚合分析维度

**按模块聚合**：

```bash
awk -F',' 'NR>1 {
  pass[$1] += ($4 == "PASS") ? 1 : 0
  fail[$1] += ($4 == "FAIL") ? 1 : 0
  skip[$1] += ($4 == "SKIP") ? 1 : 0
  total[$1] += 1
}
END {
  for (m in total) {
    rate = (pass[m]*100.0)/total[m]
    printf "%-30s PASS=%-4d FAIL=%-4d SKIP=%-4d TOTAL=%-4d 通过率=%.1f%%\n", \
      m, pass[m], fail[m], skip[m], total[m], rate
  }
}' results.csv | sort -k4 -rn
```

**按测试场景类型聚合**：

| 场景类型 | test_id 模式                                      | 期望通过率 |
| -------- | ------------------------------------------------- | ---------- |
| 正向用例 | 不以 `_fail` / `_err` / `_invalid` 结尾           | ≥ 98%      |
| 异常用例 | 含 `err` / `invalid` / `wrong` / `missing`        | ≥ 95%      |
| 边界用例 | 含 `long` / `empty` / `boundary` / `limit`        | ≥ 90%      |
| 权限用例 | 含 `guest` / `no_token` / `user_token` 访问 admin | 100%       |
| 性能用例 | `assert_response_time`                            | ≥ 95%      |

#### 4.2.3 成功/失败指标统计规则

| 指标                    | 计算公式                                    | 合格阈值                                  |
| ----------------------- | ------------------------------------------- | ----------------------------------------- |
| **模块通过率**          | `PASS / TOTAL` × 100%                       | T1: 100% / T2: ≥95% / T3: ≥90% / T4: ≥85% |
| **场景覆盖率**          | 已覆盖场景数 / 计划场景数 × 100%            | 100%                                      |
| **SDK 方法验证率**      | 已验证 SDK 方法数 / SDK 公开方法总数 × 100% | ≥ 95%                                     |
| **异常路径验证率**      | 已验证异常路径数 / 计划异常路径数 × 100%    | 100%                                      |
| **失败用例复现率**      | 已复现失败用例 / 全部失败用例 × 100%        | 100%（用于根因分析）                      |
| **SDK↔HTTP 响应一致率** | 一致的 SDK 方法数 / 抽样方法数 × 100%       | 100%                                      |

**失败分级**：

| 等级        | 定义                                                        | 处置要求                    |
| ----------- | ----------------------------------------------------------- | --------------------------- |
| **P0 阻塞** | T1 核心模块正向用例失败                                     | 必须立即修复，阻塞 SDK 发布 |
| **P1 严重** | T2 重要模块正向用例失败 / 任何模块异常路径失败导致 SDK 崩溃 | 必须在本次迭代修复          |
| **P2 一般** | T3/T4 模块用例失败 / 边界用例失败                           | 下次迭代修复                |
| **P3 提示** | 性能用例不达标 / 兼容性用例失败                             | 评估后决定是否修复          |

### 4.3 测试结果与 SDK 功能关联追溯机制

#### 4.3.1 追溯链路

```
results.csv 中的一条记录
        │
        │ 通过 (module, test_id)
        ▼
映射表条目（阶段 2 输出）
        │
        │ 通过 (sdk_method, backend_route)
        ▼
SDK __generated__/route-table.ts 中的路由常量
        │
        │ 通过 Manager 类引用
        ▼
SDK Manager 公开方法（src/<module>/index.ts）
        │
        │ 通过 @example 注解
        ▼
SDK 用户文档（TypeDoc 生成）
```

#### 4.3.2 追溯查询示例

**场景**：`results.csv` 显示 `FR-008` 失败（响应不包含 `request_id`）。

**追溯步骤**：

1. 从映射表查 `FR-008` → SDK 方法 `FriendManager.sendFriendRequest()` → 后端路由 `POST /v3/friends`；
2. 检查 SDK `src/friend/__generated__/route-table.ts` 是否有 `POST /v3/friends` 常量；
3. 检查 SDK `src/friend/sub-managers/friend-request-manager.ts` 中 `sendFriendRequest()` 方法的响应解析逻辑；
4. 检查 `__generated__/dto.ts` 中响应 DTO 是否包含 `request_id` 字段；
5. 若 SDK DTO 缺少该字段 → 标记为 SDK 完整性缺陷；若 SDK DTO 有但解析未提取 → 标记为 SDK 正确性缺陷；若后端响应实际缺少 → 标记为后端缺陷。

#### 4.3.3 追溯表结构（自动化生成）

| test_id | module      | sdk_method              | backend_route                                | sdk_route_table_entry         | sdk_dto_field | status | diff_type       |
| ------- | ----------- | ----------------------- | -------------------------------------------- | ----------------------------- | ------------- | ------ | --------------- |
| FR-008  | friend_room | sendFriendRequest       | POST /v3/friends                             | FRIEND_ROUTES.SEND_REQUEST    | request_id    | PASS   | -               |
| ADM-028 | admin       | createRegistrationToken | POST /\_synapse/admin/v1/registration_tokens | ADMIN_ROUTES.CREATE_REG_TOKEN | token         | FAIL   | sdk_dto_missing |
| ...     | ...         | ...                     | ...                                          | ...                           | ...           | ...    | ...             |

`diff_type` 枚举：

- `none`：无差异
- `sdk_dto_missing`：SDK DTO 缺少后端返回的字段
- `sdk_method_missing`：SDK 未实现该方法
- `sdk_route_missing`：SDK 路由表缺少该路由
- `response_mismatch`：SDK 返回与后端响应不一致
- `exception_type_mismatch`：SDK 抛出的异常类型与后端错误码不匹配
- `backend_bug`：后端缺陷导致测试失败

---

## 5. 验证报告输出

### 5.1 验证报告格式与内容要求

#### 5.1.1 报告结构

```
# SDK 全面测试与集成验证报告

## 1. 执行摘要
   - 测试时间窗口
   - 整体通过率
   - 阻塞项数量（P0/P1）
   - 验收结论（通过 / 有条件通过 / 不通过）

## 2. 测试环境信息
   - 后端版本（synapse-rust commit hash）
   - SDK 版本（package.json version + commit hash）
   - 测试账号数量
   - 环境对齐检查结果

## 3. 覆盖率指标
   3.1 模块覆盖率
   3.2 路由覆盖率（SDK vs 后端 Ledger）
   3.3 SDK 方法验证率
   3.4 场景覆盖率（正向/异常/边界/权限/性能）

## 4. 功能验证状态
   4.1 T1 核心模块状态表
   4.2 T2 重要模块状态表
   4.3 T3 标准模块状态表
   4.4 T4 边缘模块状态表
   （每表包含：模块名 / 总用例数 / PASS / FAIL / SKIP / 通过率 / 是否达标）

## 5. 失败用例详情
   5.1 P0 阻塞项清单
   5.2 P1 严重项清单
   5.3 P2 一般项清单
   5.4 P3 提示项清单
   （每项包含：test_id / 模块 / 描述 / 预期 / 实际 / 响应体 / 根因 / 追溯的 SDK 方法）

## 6. SDK 与后端差异清单
   6.1 DTO 字段缺失
   6.2 方法未实现
   6.3 异常类型不匹配
   6.4 响应解析不一致

## 7. 性能基准结果
   7.1 P95 响应时间表
   7.2 性能退化项（与基线对比）

## 8. 验收结论与建议
   8.1 整体结论
   8.2 修复优先级建议
   8.3 后续跟踪项

## 附录 A: SDK↔后端完整映射表
## 附录 B: 全量测试结果（results.csv 镜像）
## 附录 C: 失败响应体汇总（logs/*_fail_response.txt 镜像）
## 附录 D: 追溯表（test_id → SDK method → route）
```

#### 5.1.2 报告必备指标

| 指标                 | 报告位置  | 数据来源                           |
| -------------------- | --------- | ---------------------------------- |
| 整体通过率           | 执行摘要  | `results.csv` 聚合                 |
| 模块通过率           | 第 4 节   | 按 `module` 字段聚合               |
| 路由覆盖率           | 第 3.2 节 | `pnpm contract:codegen:check` 输出 |
| SDK 方法验证率       | 第 3.3 节 | 映射表统计                         |
| 场景覆盖率           | 第 3.4 节 | 测试用例分类统计                   |
| 失败用例数（按等级） | 第 5 节   | `results.csv` + 人工分级           |
| SDK 差异数           | 第 6 节   | 追溯表 `diff_type != none` 的条目  |
| P95 响应时间         | 第 7 节   | `assert_response_time` 用例        |

### 5.2 验收标准

#### 5.2.1 SDK 整体验收标准

| 验收项              | 合格标准                              | 不合格后果                     |
| ------------------- | ------------------------------------- | ------------------------------ |
| **契约对齐**        | `pnpm contract:codegen:check` 通过    | 一票否决：SDK 不得发布         |
| **类型安全**        | `pnpm lint:types` 0 errors            | 一票否决                       |
| **代码质量**        | `pnpm lint:js` 0 errors / 0 warnings  | 一票否决                       |
| **吞异常检查**      | `pnpm quality:swallow-fallbacks` 通过 | 一票否决                       |
| **T1 核心模块**     | 通过率 = 100%                         | 一票否决                       |
| **T2 重要模块**     | 通过率 ≥ 95%                          | 阻塞发布，需评估豁免           |
| **T3 标准模块**     | 通过率 ≥ 90%                          | 不阻塞发布，但需在下个迭代修复 |
| **T4 边缘模块**     | 通过率 ≥ 85%                          | 不阻塞发布，记入技术债务       |
| **SDK 方法验证率**  | ≥ 95%                                 | 阻塞发布                       |
| **异常路径验证**    | 100% 覆盖                             | 阻塞发布                       |
| **SDK↔HTTP 一致率** | 100%（抽样）                          | 阻塞发布                       |

#### 5.2.2 验收结论判定规则

| 结论           | 判定条件                                                                              |
| -------------- | ------------------------------------------------------------------------------------- |
| **通过**       | 所有一票否决项达标 + T1=100% + T2≥95% + 无 P0/P1 失败                                 |
| **有条件通过** | 一票否决项达标 + T1=100% + T2≥90% + P1 失败 ≤ 3 项且不影响核心功能 + 已有明确修复计划 |
| **不通过**     | 任何一票否决项不达标 / T1<100% / P0 失败 ≥ 1 项 / T2<90%                              |

### 5.3 SDK 预期行为与实际表现差异记录规范

#### 5.3.1 差异项记录模板

每条差异项必须包含以下字段：

```markdown
### 差异项 #<序号>

| 字段         | 值                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| **test_id**  | FR-008                                                                                                            |
| **模块**     | friend_room                                                                                                       |
| **SDK 方法** | FriendManager.sendFriendRequest()                                                                                 |
| **后端路由** | POST /v3/friends                                                                                                  |
| **预期行为** | 响应包含 request_id（非空）+ status=pending                                                                       |
| **实际行为** | 响应仅包含 status=pending，缺少 request_id 字段                                                                   |
| **差异类型** | sdk_dto_missing                                                                                                   |
| **影响等级** | P1                                                                                                                |
| **根因分析** | SDK `src/friend/__generated__/dto.ts` 中 `SendFriendRequestResponse` 接口未声明 `request_id` 字段，codegen 时遗漏 |
| **影响范围** | 调用方无法获取 request_id 进行后续取消操作                                                                        |
| **修复建议** | 1. 检查后端 Ledger 中该路由的响应 DTO 定义；2. 更新契约 manifest；3. 重新执行 `pnpm contract:codegen`             |
| **追溯证据** | logs/FR-008_fail_response.txt（实际响应体）                                                                       |
```

#### 5.3.2 差异类型枚举与处置

| 差异类型                  | 描述                                    | 处置策略                                      |
| ------------------------- | --------------------------------------- | --------------------------------------------- |
| `sdk_dto_missing`         | SDK DTO 缺少后端返回的字段              | 更新契约 manifest → 重新 codegen              |
| `sdk_method_missing`      | SDK 未实现后端已有的路由                | 在对应 Manager 中新增方法                     |
| `sdk_route_missing`       | SDK 路由表缺少该路由                    | `pnpm contract:sync && pnpm contract:codegen` |
| `response_mismatch`       | SDK 解析后的值与后端响应不一致          | 检查 SDK 解析逻辑                             |
| `exception_type_mismatch` | SDK 异常类型与后端错误码不匹配          | 调整 SDK 异常映射                             |
| `parameter_missing`       | SDK 方法签名缺少后端要求的参数          | 补全方法参数                                  |
| `deprecated_not_marked`   | 后端已弃用路由但 SDK 未标 `@deprecated` | 添加 `@deprecated` 注解                       |
| `backend_bug`             | 后端缺陷导致测试失败                    | 提交后端 issue，SDK 临时 graceful 处理        |
| `test_env_limitation`     | 测试环境限制（如 OIDC 未启用）          | 标记 SKIP，记录原因                           |

#### 5.3.3 差异清单汇总表格式

| #   | test_id | 模块                | SDK 方法                | 差异类型                | 影响等级 | 根因                                | 状态   |
| --- | ------- | ------------------- | ----------------------- | ----------------------- | -------- | ----------------------------------- | ------ |
| 1   | FR-008  | friend_room         | sendFriendRequest       | sdk_dto_missing         | P1       | codegen 遗漏字段                    | 待修复 |
| 2   | ADM-028 | admin               | createRegistrationToken | response_mismatch       | P2       | SDK 解析 token 字段路径错误         | 待修复 |
| 3   | VF-005  | verification_routes | verifyDeviceSigning     | exception_type_mismatch | P1       | SDK 抛出通用 Error 而非 MatrixError | 待修复 |
| ... | ...     | ...                 | ...                     | ...                     | ...      | ...                                 | ...    |

---

## 附录 A: 测试执行检查清单

执行测试前请逐项确认：

- [ ] synapse-rust 后端运行于 `https://matrix.test`，`/_matrix/client/versions` 返回 200
- [ ] PostgreSQL 容器 `synapse-test-postgres` 运行中
- [ ] 自签名 CA 证书已通过 `NODE_EXTRA_CA_CERTS` 或 `MATRIX_REAL_BACKEND_CA_CERT` 信任
- [ ] nginx 限流 burst 已临时放宽（≥ 100）
- [ ] `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm install && pnpm build` 成功
- [ ] `pnpm lint:types` 0 errors
- [ ] `pnpm lint:js` 0 errors / 0 warnings
- [ ] `pnpm contract:check && pnpm contract:codegen:check` 通过
- [ ] `pnpm quality:swallow-fallbacks` 通过
- [ ] 后端 Ledger 已同步到 `docs/api-contract/generated/`
- [ ] `bash setup_accounts.sh` 执行成功，`tokens.env` 中 4 个 token 均非空
- [ ] admin 账号已通过 DB 提升为 `is_admin=true, user_type=super_admin`
- [ ] `bash 01_auth_compat.sh` 冒烟测试通过率 ≥ 95%
- [ ] 磁盘空间充足（≥ 1GB，用于日志和结果文件）

## 附录 B: 已知测试环境约束

| 约束                                                                       | 影响                                                   | 缓解措施                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| OIDC 端点未启用                                                            | `20_account_compat.sh` 部分 OIDC 用例返回 404          | 测试脚本 graceful 处理 404/M_UNRECOGNIZED           |
| admin shared_secret 注册端点未实现（P-075）                                | `21_admin.sh` 中 ADM-031 ~ ADM-033 用例容错 3 个状态码 | DB 手动提升 admin 权限                              |
| 注册限速                                                                   | `01_auth_compat.sh` 中注册用例间需 `sleep 1`           | 测试脚本已内置 sleep                                |
| nginx burst 限流                                                           | 高频请求触发 429                                       | `test_helpers.sh` 中 429 自动重试 + 请求间节流      |
| macOS `date` 不支持 `%3N`                                                  | 时间戳精度问题                                         | `test_helpers.sh` 统一使用 `python3` 获取毫秒时间戳 |
| 后端 `M_UNAUTHORIZED` vs 标准 `M_MISSING_TOKEN`/`M_UNKNOWN_TOKEN`（P-035） | AUTH-039 / AUTH-041 用例容错                           | 已修复，测试用例验证标准错误码                      |
| `sendFriendRequest` 后端返回 stringified i64                               | SDK 类型声明为 number 可能出错                         | SDK 解析时需注意字符串数值                          |
| 后端 `offset` 参数已弃用                                                   | FR-006 期望返回 400                                    | 测试用例已记录该约束                                |

## 附录 C: 报告生成自动化建议

> 本方案不涉及代码实现，仅提供自动化建议供后续执行参考。

1. **结果聚合脚本**：编写脚本读取 `results.csv` + 映射表 YAML，自动生成报告第 3-5 节；
2. **追溯表生成**：基于 `__generated__/route-table.ts` + Manager 源码扫描，自动生成附录 D 追溯表；
3. **差异检测**：对比 `results.csv` 中实际响应字段（从 `logs/*_fail_response.txt` 提取）与 SDK DTO，自动标记 `diff_type`；
4. **报告模板**：使用 Markdown 模板 + Mustache/Handlebars 填充，输出 `docs/reports/SDK验证报告_<日期>.md`。
