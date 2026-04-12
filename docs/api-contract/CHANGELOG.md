# API 契约变更日志

## 2026-04-11

### TypeScript 类型安全修复 — `any` 类型消除

本轮对 SDK 源码中可消除的 `any` 类型进行了系统性替换，提升类型安全性。以下是影响公共 API 的变更：

#### 新增公共方法

- **`BaseManager.setRetryOptions(options: RetryOptions): void`**
    - 新增公共方法，替代直接访问 `protected retryOptions` 属性
    - 原先通过 `(manager as any).retryOptions = options` 的用法改为 `manager.setRetryOptions(options)`
    - 影响模块：`event/EventManager`、所有 `BaseManager` 子类

#### 返回类型收紧 (`Record<string, any>` → `Record<string, unknown>`)

以下公共 API 的返回类型或参数类型从 `Record<string, any>` 收紧为 `Record<string, unknown>`：

| 方法/属性                                    | 文件                                 | 变更                                                                              |
| -------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `MatrixClient.getStateEvent()` 返回类型      | `client.ts`                          | `Promise<Record<string, any>>` → `Promise<Record<string, unknown>>`               |
| `MatrixClient.sendReceipt()` body 参数       | `client.ts`                          | `Record<string, any>` → `Record<string, unknown>`                                 |
| `ISecureBackupInfo.auth_data`                | `client-api-types.ts`                | `Record<string, any>` → `Record<string, unknown>`                                 |
| `InteractiveAuth.getStageParams()` 返回类型  | `interactive-auth.ts`                | `Record<string, any>` → `Record<string, unknown>`                                 |
| `UrlPreviewManager.getUrlPreview()` 返回类型 | `url-preview/index.ts`               | `Promise<Record<string, any>>` → `Promise<Record<string, unknown>>`               |
| `getStateEventRequest()` 返回类型            | `client-room-management-requests.ts` | `Promise<Record<string, any>>` → `Promise<Record<string, unknown>>`               |
| `IDeviceKeys.unsigned`                       | `crypto/store/base.ts`               | `Record<string, any>` → `Record<string, unknown>`                                 |
| `Room.tags`                                  | `models/room.ts`                     | `Record<string, Record<string, any>>` → `Record<string, Record<string, unknown>>` |
| `ThirdpartyManager.parseMatrixUri()` fields  | `thirdparty/index.ts`                | `Record<string, any>` → `Record<string, unknown>`                                 |

#### 返回类型收紧 (其他)

| 方法/属性                                     | 文件                   | 变更                                                                                                                               |
| --------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `MatrixCall.getCurrentCallStats()`            | `webrtc/call.ts`       | `Promise<any[] \| undefined>` → `Promise<RTCStats[] \| undefined>`                                                                 |
| `DiscoveryManager.searchUserDirectory()` body | `discovery/index.ts`   | `Record<string, any>` → `Record<string, string \| number>`                                                                         |
| `ThreadLike.lastReply`                        | `client-send-event.ts` | `(predicate: (event: any) => boolean) => any` → `(predicate: (event: MatrixEvent) => boolean) => MatrixEvent \| null \| undefined` |

#### 新增响应接口 (external-service)

| 接口                              | 用途                                   |
| --------------------------------- | -------------------------------------- |
| `IListServicesResponseItem`       | `listServices()` 的 API 响应类型       |
| `IGetAllHealthStatusResponseItem` | `getAllHealthStatus()` 的 API 响应类型 |

#### 保留 `any` 的合理场景

以下 `any` 类型经评估后保留，因为修改会导致大量级联类型错误或破坏 API 兼容性：

- `Body = Record<string, any> | BodyInit` — HTTP 请求体类型，TypeScript 接口无隐式索引签名
- `IContent` / `IUnsigned` 的 `[key: string]: any` — Matrix 协议可扩展内容对象
- `AnyListener = (...args: any) => any` — 事件系统基础类型
- `BaseManager` 的 `Record<Events, any>` — 子类事件映射使用对象类型，与 `ListenerMap` 不兼容
- `ToDevicePayload = Record<string, any>` — 接口不能赋值给 `Record<string, unknown>`
- `SendToDeviceContentMap` — 同上
- `logger.ts` 的 `...msg: any[]` — 日志方法需接受任意参数
- `IStore.on` / `IndexedDBStore.on` 的 `(...args: any[]) => void` — 事件处理器参数类型动态

## 2026-04-04

### Presence 模块审计完成

- 完成 `presence.md` 契约与 SDK/后端交叉验证
- 发现 3 个问题：
    - ⚠️ P1: 契约文档缺少 `GET /presence/list/{user_id}` 端点记录
    - ⚠️ P1: SDK 缺少 `getPresenceList()` 方法
    - 📝 P2: SDK 错误处理不完善
- 更新 `presence.md` 添加 SDK Manager 对应关系和审计状态
- 创建 `PRESENCE_API_AUDIT.md` 审计报告
- 封装覆盖率: 80% (4/5)

### Key Backup 模块审计完成

- 完成 `key-backup.md` 契约与 SDK/后端交叉验证
- 发现 5 个问题：
    - 🔴 P0: SDK 使用间接封装而非直接 HTTP 调用
    - 🔴 P0: 缺少恢复与校验功能 (6 个端点)
    - 🔴 P0: 缺少导入导出功能 (4 个端点)
    - ⚠️ P1: 缺少 Secure Backup 封装 (6 个端点)
    - ⚠️ P1: 缺少批量密钥上传
- 更新 `key-backup.md` 添加 SDK Manager 对应关系和审计状态
- 创建 `KEY_BACKUP_API_AUDIT.md` 审计报告
- 封装覆盖率: 0% 直接 HTTP 封装，75% 未封装

### E2EE 契约文档补齐

- 新增 `e2ee.md`，拆分 `e2ee_routes.rs` 中的核心密钥、to-device、设备信任与安全摘要接口
- 新增 `key-backup.md`，拆分 `key_backup.rs` 的版本管理、密钥备份、恢复、导入导出，以及 `e2ee_routes.rs` 中的 secure backup 接口
- 新增 `verification.md`，拆分 `verification_routes.rs` 的 SAS 与二维码设备校验接口
- 更新 `README.md` 索引，纳入新增文档
- 更新 `backend-route-inventory.md`，将 E2EE / Key Backup / Verification 从总表补录改为独立文档引用
- 更新 `VERIFICATION_REPORT.md`，记录本轮补齐范围
- 审查基线保持为 `synapse-rust` 当前磁盘代码，不把未挂载的 `key_rotation.rs` 计入可达契约

### Media 模块修复完成

- **SDK 修复**:
    - Voice 端点路径: `ClientPrefix.V3` → `VOICE_R0_PREFIX` (`/_matrix/client/r0`)
    - Voice transcription: `/voice/transcribe` → `/voice/transcription`, prefix → `VOICE_V1_PREFIX`
    - Voice getWaveform: 改为本地生成波形（后端无此端点）
    - 添加 `MediaManager.deleteMedia()` 方法
    - 添加 `MediaManager.previewUrl()` 方法
    - 添加 `MediaManager.uploadContentWithId()` 方法
    - 添加 `MediaQuotaManager.getQuotaAlerts()` 方法
- **文档更新**:
    - 更新 `media.md` 契约状态为"已完成并修复"
    - 更新 `MEDIA_API_AUDIT.md` 审计报告
- **验证结果**: 封装覆盖率 78% (18/23)

### Media 模块审计完成

- 完成 `media.md` 契约与 SDK/后端交叉验证
- 发现 6 个问题：
    - 🔴 P0: Voice 端点路径错误 (SDK 使用 V3，后端实际是 r0)
    - 🔴 P0: 缺少 `deleteMedia()` 方法
    - ⚠️ P1: 缺少 `previewUrl()` 方法
    - ⚠️ P1: 缺少 `getQuotaAlerts()` 方法
    - 📝 P2: 缺少 `uploadContentWithId()` 方法
    - 📝 P2: voice 端点应在独立契约文档
- 更新 `media.md` 添加 SDK Manager 对应关系和审计状态
- 创建 `MEDIA_API_AUDIT.md` 审计报告

### Friend 模块修复完成

- **后端修复**: 添加 `PUT /friends/{user_id}/displayname` 路由和 `update_friend_displayname` 服务方法
- **SDK 修复**:
    - `sendFriendRequest` 字段 `reason` → `message` 与后端对齐
    - `getFriendInfo` 改为调用专用端点而非遍历好友列表
- **文档更新**:
    - 更新 `friend.md` 契约状态为"已完成并修复"
    - 更新 `FRIEND_API_AUDIT.md` 审计报告
- **验证结果**: 封装覆盖率 100% (25/25)

## 2026-04-03

### Friend 模块审计完成

- 完成 `friend.md` 契约与 SDK/后端交叉验证
- 发现 5 个问题：
    - 🔴 P0: 后端缺失 `PUT /friends/{user_id}/displayname` 路由
    - ⚠️ P1: `sendFriendRequest` 请求体字段不一致 (`reason` vs `message`)
    - ⚠️ P1: `getFriendInfo` 实现错误（未调用专用端点）
    - ⚠️ P2: `ensureFriendListRoom` 语义不清
    - 📝 P3: 契约文档与实现不一致
- 更新 `friend.md` 添加审计状态列和问题详情

### 契约文档重审

- 以 `synapse-rust` 当前磁盘代码为准，重审 `docs/api-contract` 目录
- 重写 `README.md`，改为后端真实挂载路由索引
- 重写 `auth.md`，补齐 auth/account/directory/discovery 端点
- 重写 `admin.md`，按 admin 子模块分组列出真实端点
- 重写 `room.md`，按 `r0/v1/v3` 真实挂载拆分
- 重写 `sync.md`，区分 GET Sync 与 POST Sliding Sync
- 重写 `push.md`、`space.md`、`dm.md`、`friend.md`
- 新增 `account-data.md`、`device.md`、`media.md`、`presence.md`、`room-summary.md`、`federation.md`
- 新增 `backend-route-inventory.md`，补充其余已挂载模块的后端路由总表
- 重写 `VERIFICATION_REPORT.md`，记录本轮交叉验证方法与排除项

## 变更原则

- 文档结论以已挂载路由为准
- 版本前缀必须与代码一致
- 未挂载文件不写入可达 API 契约
- 复杂响应仅承诺代码中稳定可见字段
