# D.3 代码冗余清理报告

## 执行日期

2026-07-17

## 清理成果

### 已完成清理

| 类别                                   | 清理前 | 清理后 | 减少                 |
| -------------------------------------- | ------ | ------ | -------------------- |
| Unused files                           | 4      | 0      | 4                    |
| Duplicate exports                      | 2      | 0      | 2                    |
| Configuration hints                    | 4      | 0      | 4                    |
| Unused exports (非 extendMatrixClient) | 17     | 12     | 5                    |
| Unused exports (extendMatrixClient)    | ~50    | ~50    | 0 (动态 import 限制) |
| Unused exported types                  | 39     | 39     | 0 (公共 API 保留)    |

### 具体操作

1. **删除 5 个未使用文件**
    - `src/client-url-preview.ts` — URL 预览功能，无引用
    - `src/utils/deprecation.ts` — 弃用警告工具，无引用
    - `test-local-backend.js` — 临时测试脚本，无引用
    - `vitest.codegen.config.ts` — 未使用的 vitest 配置
    - `src/client-room-management-requests.ts` — 旧请求构建器，被 manager 替代

2. **删除 120 个冗余 `export default`**
    - 115 个 `export default extendMatrixClient;`（manager index 文件）
    - 5 个 `export default ClassName;`（AIModule、BurnAfterReadManager、FilterManager、InviteBlocklistManager、VoiceManager）
    - 2 个重复导出（DatabaseVerifier、TestConfig 的 spec/integ/real-backend）

3. **精简 `client-request-delegates.ts`**
    - 移除 5 个死重导出（client-room-management-requests 的全部函数）
    - 仅保留 `client.ts` 实际导入的 17 个 re-export

4. **修正 knip.ts 配置**
    - 移除 3 个不存在的 entry 路径（matrixrtc/index.ts、webrtc/groupCall.ts、webrtc/stats/media/mediaTrackStats.ts）
    - 移除 `@babel/runtime` from ignoreDependencies（knip 可自动识别）

## 剩余报告分析

### ~50 个 `extendMatrixClient` 未使用导出（已知限制）

**根因**: `src/manager-extensions/index.ts` 使用动态 import 模式加载每个 manager：

```typescript
promises.push(safeDynamicImport(import("../admin/index.js").then((m) => m?.extendMatrixClient())));
```

knip 静态分析无法追踪 `.then((m) => m?.extendMatrixClient())` 模式，导致所有 `extendMatrixClient` 命名导出被误报为未使用。

**判定**: 接受为已知限制。所有 122 个 manager 通过此模式动态注册到 MatrixClient，已在 D.2 审查中确认全部活跃。

### 12 个实际未使用 exports（公共 API 保留）

这些函数/类未被项目内部使用，但作为已发布 SDK 的导出，保留以避免破坏外部消费者：

| 导出名                                        | 文件                                   | 判定                                         |
| --------------------------------------------- | -------------------------------------- | -------------------------------------------- |
| httpStatusToErrorCode                         | @types/errors.ts                       | 错误码映射工具，可能被外部使用               |
| isEventTypeSame                               | @types/extensible_events.ts            | 事件类型比较，extensible events API          |
| ap                                            | admin/admin-base-manager.ts            | admin 管理器基类工具                         |
| AdminApiError                                 | admin/sub-managers/admin-user-types.ts | admin 错误类型                               |
| buildSearchParams                             | admin/utils.ts                         | admin 查询参数构建                           |
| uploadKeysHttpRequest 等 5 个                 | client-crypto-requests.ts              | 旧密钥上传请求构建器，被 crypto manager 替代 |
| getThreePidsRequest 等 5 个                   | client-profile-requests.ts             | 旧 3PID 请求构建器，被 profile manager 替代  |
| setGuestAccessRequest                         | client-room-access.ts                  | 旧访客访问请求构建器                         |
| getRoomHierarchyRequest                       | client-room-discovery-requests.ts      | 旧房间层级请求构建器                         |
| buildHtmlNoticePayload, buildHtmlEmotePayload | client-send-message.ts                 | HTML 消息构建工具                            |
| toErrorInfo, fromErrorInfo                    | error/index.ts                         | 错误信息转换                                 |
| setEventManagerRetryOptions (x2)              | event/EventManager.ts, event/index.ts  | 事件管理器重试配置                           |
| createOpenClawManager                         | open-claw/index.ts                     | open-claw 管理器工厂                         |
| OtherUserSpeakingError                        | web-rtc/groupCall.ts                   | WebRTC 错误类                                |

**判定**: 保留为公共 API。这些是已发布 SDK 的导出，删除会破坏外部消费者。未来可在 major 版本中标记 `@deprecated` 并逐步移除。

### 39 个未使用导出类型（类型 API 保留）

这些 interface/type/enum 虽未被项目内部引用，但作为类型导出可能被外部消费者用于类型标注。删除会破坏 `import type` 语句。

**判定**: 全部保留。类型导出是 SDK 公共 API 的重要组成部分。

## 验证

- `pnpm lint:types`（tsc --noEmit）：5 个预先存在的 `@vitest/spy` 类型推断错误（与本次改动无关）
- `pnpm lint:knip`：无 Unused files、无 Duplicate exports、无 Configuration hints
