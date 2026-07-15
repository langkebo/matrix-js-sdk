---
module: media
generated_from: docs/api-contract/generated/modules/media.json
generated_hash: sha256-f318a10a08718ddd404ed6f0f595450b7e197b432facaeb3917b941a30bf778a
ledger_schema: 1
last_reviewed: 2026-05-11
---

# Media 模块契约

> 审查来源: `synapse-rust/src/web/routes/media.rs`、`synapse-rust/src/web/routes/assembly.rs`

## 挂载版本

| 前缀                | 路由特点                                 |
| ------------------- | ---------------------------------------- |
| `/_matrix/media/v1` | 传统上传、配置、预览、删除、下载、配额   |
| `/_matrix/media/v3` | 现代上传、配置、预览、删除、下载、缩略图 |
| `/_matrix/media/r0` | 仅现代上传与配置                         |
| `/_matrix/media/r1` | 仅传统下载                               |

## 路由清单

| 方法 | 路径                                                             | 说明                                                           | 认证              |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------------------- | ----------------- |
| POST | `/_matrix/media/v1/upload`                                       | 传统上传                                                       | 用户              |
| GET  | `/_matrix/media/{v1,r0,v3}/config`                               | 上传配置                                                       | 公开              |
| GET  | `/_matrix/client/v1/media/config`                                | authenticated media 配置                                       | 用户              |
| GET  | `/_matrix/media/v1/preview_url`                                  | URL 预览                                                       | 公开              |
| POST | `/_matrix/media/v1/delete/{server_name}/{media_id}`              | 删除媒体                                                       | 用户              |
| GET  | `/_matrix/media/v3/preview_url`                                  | URL 预览                                                       | 公开              |
| POST | `/_matrix/media/v3/delete/{server_name}/{media_id}`              | 删除媒体                                                       | 用户              |
| GET  | `/_matrix/media/v1/download/{server_name}/{media_id}`            | 传统下载                                                       | 公开/按处理器逻辑 |
| GET  | `/_matrix/media/v1/download/{server_name}/{media_id}/{filename}` | 带文件名下载                                                   | 同上              |
| GET  | `/_matrix/media/v1/quota/check`                                  | 配额检查                                                       | 用户              |
| GET  | `/_matrix/media/v1/quota/stats`                                  | 配额统计                                                       | 用户              |
| GET  | `/_matrix/media/v1/quota/alerts`                                 | 配额告警                                                       | 用户              |
| POST | `/_matrix/media/v3/upload`                                       | 现代上传                                                       | 用户              |
| PUT  | `/_matrix/media/v3/upload/{server_name}/{media_id}`              | 具名上传；要求本机 `server_name`，并按路径中的 `media_id` 落盘 | 用户              |
| GET  | `/_matrix/media/v3/download/{server_name}/{media_id}`            | 下载                                                           | 公开/按处理器逻辑 |
| GET  | `/_matrix/media/v3/download/{server_name}/{media_id}/{filename}` | 带文件名下载                                                   | 同上              |
| GET  | `/_matrix/media/v3/thumbnail/{server_name}/{media_id}`           | 缩略图                                                         | 公开/按处理器逻辑 |
| POST | `/_matrix/media/r0/upload`                                       | 兼容上传                                                       | 用户              |
| GET  | `/_matrix/media/r1/download/{server_name}/{media_id}`            | 兼容下载                                                       | 公开/按处理器逻辑 |
| GET  | `/_matrix/media/r1/download/{server_name}/{media_id}/{filename}` | 兼容带文件名下载                                               | 同上              |

## 代码中可见稳定响应

| 路径                | 响应要点                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- |
| `GET /config`       | `{ "m.upload.size": 52428800 }`                                                         |
| `GET /quota/check`  | `limit` `used` `remaining` `rule`                                                       |
| `GET /quota/stats`  | `user_id` `storage_bytes` `media_count` `limit_bytes` `statistics`                      |
| `GET /quota/alerts` | `{ "alerts": [...] }`，告警项含 `alert_id` `alert_type` `threshold_percent` 等          |
| 上传接口            | service 返回上传结果对象；具名上传会保留路径中的 `media_id`，重复 ID 返回冲突           |
| `GET /preview_url`  | 成功时返回 preview 对象；抓取失败时仍返回 JSON 对象，字段退化为 `url/title/description` |
| `POST /delete/...`  | 返回 `{ "deleted": true, "media_id": string }`                                          |
| 下载接口            | 成功时返回二进制响应；失败时返回 JSON 错误体并携带匹配的 HTTP 状态码                    |

## 请求体与请求参数

- 上传接口使用原始文件二进制 body
- 上传时可通过查询参数提供 `filename`
- 删除与下载通过路径参数 `server_name`、`media_id`
- `GET /preview_url` 要求查询参数 `url`，可选 `ts`

## 常见状态码

| 状态码 | 说明                     |
| ------ | ------------------------ |
| `200`  | 请求成功                 |
| `400`  | 上传 body 为空等参数错误 |
| `401`  | 需用户认证的接口未登录   |
| `409`  | 具名上传使用了已存在 ID  |
| `404`  | 媒体不存在               |

## 本轮复核发现

- `MediaManager` 已补齐高层下载/缩略图 URL helper，不再只依赖底层 `content-repo.ts` 工具函数。
- `MediaQuotaManager` 已补齐 `checkQuota()`、`getQuotaStats()` 与 authenticated media config 参数透传，`quota/*` 不再只是“部分封装”。
- 当前未见新的 Media 高优先级契约偏差；具名上传、authenticated media config、配额读取与传统下载错误状态码均已收敛。

## 代码定位

- 路由与处理器: `synapse-rust/src/web/routes/media.rs`
- authenticated media 配置挂载: `synapse-rust/src/web/routes/assembly.rs`

---

## SDK Manager 对应关系

> 更新日期: 2026-05-11
> 审计状态: ✅ Media 路由、下载/缩略图 helper、quota/config 封装已对齐

### 媒体上传下载

| 端点                                                              | SDK Manager    | 方法                    | 状态      |
| ----------------------------------------------------------------- | -------------- | ----------------------- | --------- |
| `POST /_matrix/media/{v1,v3,r0}/upload`                           | `MediaManager` | `uploadContent()`       | ✅ 已封装 |
| `PUT /_matrix/media/v3/upload/{server_name}/{media_id}`           | `MediaManager` | `uploadContentWithId()` | ✅ 已封装 |
| `GET /_matrix/media/{v1,v3,r1}/download/{server_name}/{media_id}` | `MediaManager` | `getDownloadUrl()`      | ✅ 已封装 |
| `GET /_matrix/media/v3/thumbnail/{server_name}/{media_id}`        | `MediaManager` | `getThumbnailUrl()`     | ✅ 已封装 |

### 媒体管理

| 端点                                                     | SDK Manager         | 方法                    | 状态      |
| -------------------------------------------------------- | ------------------- | ----------------------- | --------- |
| `GET /_matrix/media/{v1,r0,v3}/config`                   | `MediaQuotaManager` | `getMediaConfig(false)` | ✅ 已封装 |
| `GET /_matrix/client/v1/media/config`                    | `MediaQuotaManager` | `getMediaConfig(true)`  | ✅ 已封装 |
| `GET /_matrix/media/v1/preview_url`                      | `MediaManager`      | `previewUrl()`          | ✅ 已封装 |
| `POST /_matrix/media/v1/delete/{server_name}/{media_id}` | `MediaManager`      | `deleteMedia()`         | ✅ 已封装 |

### 配额管理

| 端点                                 | SDK Manager         | 方法                                        | 状态      |
| ------------------------------------ | ------------------- | ------------------------------------------- | --------- |
| `GET /_matrix/media/v1/quota/check`  | `MediaQuotaManager` | `checkQuota()` / `hasStorageSpace()`        | ✅ 已封装 |
| `GET /_matrix/media/v1/quota/stats`  | `MediaQuotaManager` | `getQuotaStats()` / `getUserStorageUsage()` | ✅ 已封装 |
| `GET /_matrix/media/v1/quota/alerts` | `MediaQuotaManager` | `getQuotaAlerts()`                          | ✅ 已封装 |

## 人工 Review 对齐

- `src/media/index.ts` 已引入生成的 `MediaPathPattern`，并将 `uploadContentWithId()`、`deleteMedia()`、`previewUrl()` 绑定到 media 路由模板。
- `MediaManager.getDownloadUrl()` 新增显式高层 helper，覆盖:
    - `/_matrix/media/v3/download/{server_name}/{media_id}`
    - `/_matrix/media/v1/download/{server_name}/{media_id}`
    - `/_matrix/media/r1/download/{server_name}/{media_id}`
    - `filename` 变体路径
- `MediaManager.getThumbnailUrl()` 新增显式高层 helper，覆盖:
    - `/_matrix/media/v3/thumbnail/{server_name}/{media_id}`
    - `/_matrix/client/v1/media/thumbnail/{server_name}/{media_id}` authenticated media 变体
- `MediaQuotaManager.getMediaConfig(useAuthenticatedMedia)` 现显式透传 `false/true`，分别对应:
    - `/_matrix/media/v3/config`
    - `/_matrix/client/v1/media/config`
- `MediaQuotaManager` 现新增 `checkQuota()` 与 `getQuotaStats()`，其余 `hasStorageSpace()`、`getUserStorageUsage()`、`getStorageQuota()`、`getStorageUsagePercent()` 都基于这两个真实端点复用。
- `spec/unit/media-manager.spec.ts` 与 `spec/unit/media-quota.spec.ts` 已补 URL helper、authenticated media、quota/config 的专用断言。

## 当前对齐结论

- 语音相关路由已从本文件拆分到 `voice.md`，避免继续混写 Media 与 Voice 两组契约。
- `getWaveform()` 已收敛为本地计算能力，不再暗示后端存在独立波形接口。
- `PUT /_matrix/media/v3/upload/{server_name}/{media_id}` 现已真正使用路径参数，非本机 `server_name` 返回 `400`，重复 `media_id` 返回 `409`。
- `/_matrix/media/{v1,r1}/download/...` 失败时现已返回匹配的 `404` 等错误状态码，不再出现 `200 + JSON 错误体`。
- `/_matrix/client/v1/media/config` authenticated media 配置入口已通过 `MediaQuotaManager.getMediaConfig(true)` 显式暴露。
- `quota/check` 与 `quota/stats` 已有端点级 wrapper，不再只是派生 helper。
- **v10 对齐 (2026-06-09)**: `getDownloadUrl()` / `getThumbnailUrl()` 支持 `signature`/`timestamp` 参数（m-30 HMAC-SHA256 签名 URL），传递时将 `signature` 和 `ts` 添加到 URL query string。

---

## 封装覆盖率

- **后端路由总数**: 22 个端点 (media.rs + assembly.rs 中 authenticated media config)
- **SDK 主链路覆盖**: 22/22
- **已绑定生成路由模板**: 8/8 个相对 media 路径调用点
- **契约覆盖率**: 100%

## DTO Definitions

> Source: `src/media/__generated__/dto.ts`

```typescript
export interface UploadRequest {
    name?: string;
    type?: string;
}
export interface UploadResponse {
    content_uri: string;
}
export interface MediaConfig {
    "m.upload.size"?: number;
}
export interface UrlPreview {
    url?: string;
    title?: string;
    description?: string;
    image_url?: string;
    image?: string;
    og_image?: string;
    "matrix:image"?: string;
}
export interface MediaDownloadUrlOptions {
    filename?: string;
    allowDirectLinks?: boolean;
    allowRedirects?: boolean;
    useAuthentication?: boolean;
    version?: "v1" | "v3" | "r1";
    signature?: string;
    timestamp?: number; // m-30: HMAC-SHA256 签名 URL 参数
}
export interface MediaThumbnailUrlOptions {
    width?: number;
    height?: number;
    method?: "crop" | "scale";
    allowDirectLinks?: boolean;
    allowRedirects?: boolean;
    useAuthentication?: boolean;
    animated?: boolean;
    signature?: string;
    timestamp?: number; // m-30: HMAC-SHA256 签名 URL 参数
}
```
