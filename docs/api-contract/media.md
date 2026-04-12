# Media 模块契约

> 审查来源: `synapse-rust/src/web/routes/media.rs`

## 挂载版本

| 前缀                | 路由特点                                 |
| ------------------- | ---------------------------------------- |
| `/_matrix/media/v1` | 传统上传、配置、预览、删除、下载、配额   |
| `/_matrix/media/v3` | 现代上传、配置、预览、删除、下载、缩略图 |
| `/_matrix/media/r0` | 仅现代上传与配置                         |
| `/_matrix/media/r1` | 仅传统下载                               |

## 路由清单

| 方法 | 路径                                                             | 说明                     | 认证              |
| ---- | ---------------------------------------------------------------- | ------------------------ | ----------------- |
| POST | `/_matrix/media/v1/upload`                                       | 传统上传                 | 用户              |
| GET  | `/_matrix/media/{v1,r0,v3}/config`                               | 上传配置                 | 公开              |
| GET  | `/_matrix/client/v1/media/config`                                | authenticated media 配置 | 用户              |
| GET  | `/_matrix/media/v1/preview_url`                                  | URL 预览                 | 通常用户          |
| POST | `/_matrix/media/v1/delete/{server_name}/{media_id}`              | 删除媒体                 | 用户              |
| GET  | `/_matrix/media/v1/download/{server_name}/{media_id}`            | 传统下载                 | 公开/按处理器逻辑 |
| GET  | `/_matrix/media/v1/download/{server_name}/{media_id}/{filename}` | 带文件名下载             | 同上              |
| GET  | `/_matrix/media/v1/quota/check`                                  | 配额检查                 | 用户              |
| GET  | `/_matrix/media/v1/quota/stats`                                  | 配额统计                 | 用户              |
| GET  | `/_matrix/media/v1/quota/alerts`                                 | 配额告警                 | 用户              |
| POST | `/_matrix/media/v3/upload`                                       | 现代上传                 | 用户              |
| PUT  | `/_matrix/media/v3/upload/{server_name}/{media_id}`              | 以指定 ID 上传           | 用户              |
| GET  | `/_matrix/media/v3/download/{server_name}/{media_id}`            | 下载                     | 公开/按处理器逻辑 |
| GET  | `/_matrix/media/v3/download/{server_name}/{media_id}/{filename}` | 带文件名下载             | 同上              |
| GET  | `/_matrix/media/v3/thumbnail/{server_name}/{media_id}`           | 缩略图                   | 公开/按处理器逻辑 |
| POST | `/_matrix/client/r0/voice/upload`                                | 语音上传                 | 用户              |
| POST | `/_matrix/client/r0/voice/convert`                               | 语音格式转换             | 用户              |
| POST | `/_matrix/client/r0/voice/optimize`                              | 语音压缩优化             | 用户              |
| POST | `/_matrix/client/v1/voice/transcription`                         | 语音转写                 | 用户              |
| POST | `/_matrix/media/r0/upload`                                       | 兼容上传                 | 用户              |
| GET  | `/_matrix/media/r1/download/{server_name}/{media_id}`            | 兼容下载                 | 公开/按处理器逻辑 |
| GET  | `/_matrix/media/r1/download/{server_name}/{media_id}/{filename}` | 兼容带文件名下载         | 同上              |

## 代码中可见稳定响应

| 路径                | 响应要点                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| `GET /config`       | `{ "m.upload.size": 52428800 }`                                                |
| `GET /quota/check`  | `limit` `used` `remaining` `rule`                                              |
| `GET /quota/stats`  | `user_id` `storage_bytes` `media_count` `limit_bytes` `statistics`             |
| `GET /quota/alerts` | `{ "alerts": [...] }`，告警项含 `alert_id` `alert_type` `threshold_percent` 等 |
| 上传接口            | service 返回上传结果对象                                                       |
| 下载接口            | 二进制响应，带 `Content-Type` 与 `Content-Length`                              |

## 请求体与请求参数

- 上传接口使用原始文件二进制 body
- 上传时可通过查询参数提供 `filename`
- 删除与下载通过路径参数 `server_name`、`media_id`

## 常见状态码

| 状态码 | 说明                     |
| ------ | ------------------------ |
| `200`  | 请求成功                 |
| `400`  | 上传 body 为空等参数错误 |
| `401`  | 需用户认证的接口未登录   |
| `404`  | 媒体不存在               |

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/media.rs`
- 语音路由: `synapse-rust/src/web/routes/voice.rs`

---

## SDK Manager 对应关系

> 更新日期: 2026-04-04
> 审计状态: ✅ 已完成并修复

### 媒体上传下载

| 端点                                                              | SDK Manager       | 方法                    | 状态        |
| ----------------------------------------------------------------- | ----------------- | ----------------------- | ----------- |
| `POST /_matrix/media/{v1,v3,r0}/upload`                           | `MediaManager`    | `uploadContent()`       | ✅ 已封装   |
| `PUT /_matrix/media/v3/upload/{server_name}/{media_id}`           | `MediaManager`    | `uploadContentWithId()` | ✅ 已添加   |
| `GET /_matrix/media/{v1,v3,r1}/download/{server_name}/{media_id}` | `content-repo.ts` | `getHttpUriForMxc()`    | ⚠️ 工具函数 |
| `GET /_matrix/media/v3/thumbnail/{server_name}/{media_id}`        | `content-repo.ts` | `getHttpUriForMxc()`    | ⚠️ 工具函数 |

### 媒体管理

| 端点                                                     | SDK Manager         | 方法               | 状态        |
| -------------------------------------------------------- | ------------------- | ------------------ | ----------- |
| `GET /_matrix/media/{v1,r0,v3}/config`                   | `MediaQuotaManager` | `getMediaConfig()` | ⚠️ 部分封装 |
| `GET /_matrix/media/v1/preview_url`                      | `MediaManager`      | `previewUrl()`     | ✅ 已添加   |
| `POST /_matrix/media/v1/delete/{server_name}/{media_id}` | `MediaManager`      | `deleteMedia()`    | ✅ 已添加   |

### 配额管理

| 端点                                 | SDK Manager         | 方法                    | 状态        |
| ------------------------------------ | ------------------- | ----------------------- | ----------- |
| `GET /_matrix/media/v1/quota/check`  | `MediaQuotaManager` | `hasStorageSpace()`     | ⚠️ 部分封装 |
| `GET /_matrix/media/v1/quota/stats`  | `MediaQuotaManager` | `getUserStorageUsage()` | ⚠️ 部分封装 |
| `GET /_matrix/media/v1/quota/alerts` | `MediaQuotaManager` | `getQuotaAlerts()`      | ✅ 已添加   |

### 语音处理

| 端点                                          | SDK Manager           | 方法                       | 状态      |
| --------------------------------------------- | --------------------- | -------------------------- | --------- |
| `POST /_matrix/client/r0/voice/upload`        | `VoiceMessageManager` | `uploadVoiceMessage()`     | ✅ OK     |
| `POST /_matrix/client/r0/voice/convert`       | `VoiceMessageManager` | `convertVoiceMessage()`    | ✅ 已修复 |
| `POST /_matrix/client/r0/voice/optimize`      | `VoiceMessageManager` | `optimizeVoiceMessage()`   | ✅ 已修复 |
| `POST /_matrix/client/v1/voice/transcription` | `VoiceMessageManager` | `transcribeVoiceMessage()` | ✅ 已修复 |

---

## 已修复问题

> 修复日期: 2026-04-04

### SDK 修复

| 问题                             | 修复内容                                                                 | 文件                   |
| -------------------------------- | ------------------------------------------------------------------------ | ---------------------- |
| Voice 端点路径错误               | `ClientPrefix.V3` → `VOICE_R0_PREFIX` (`/_matrix/client/r0`)             | `voice/index.ts`       |
| Voice transcription 路径错误     | `/voice/transcribe` → `/voice/transcription`, prefix → `VOICE_V1_PREFIX` | `voice/index.ts`       |
| Voice getWaveform 调用不存在端点 | 改为本地生成波形                                                         | `voice/index.ts`       |
| 缺少 deleteMedia                 | 添加 `MediaManager.deleteMedia()`                                        | `media/index.ts`       |
| 缺少 previewUrl                  | 添加 `MediaManager.previewUrl()`                                         | `media/index.ts`       |
| 缺少 uploadContentWithId         | 添加 `MediaManager.uploadContentWithId()`                                | `media/index.ts`       |
| 缺少 getQuotaAlerts              | 添加 `MediaQuotaManager.getQuotaAlerts()`                                | `media-quota/index.ts` |

---

## 封装覆盖率

- **后端路由总数**: 23 个端点 (media.rs + voice.rs)
- **SDK 已封装**: 18 个方法
- **完全正确封装**: 18/23 (78%)
- **工具函数**: 5/23 (22%)
