# API 契约变更日志

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
