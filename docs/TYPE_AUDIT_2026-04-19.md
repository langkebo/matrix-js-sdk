# Matrix SDK 类型审计报告（2026-04-19）

> 范围: `matrix-js-sdk/src` 公共 API 优先  
> 关联下游: `hula`  
> 产物类型: 第一阶段审计报告（未开始全量改造）

## 1. 审计结论

- `matrix-js-sdk` 当前已经开启 `TypeScript strict`。
- `matrix-js-sdk` 当前已经开启 `noImplicitAny`。
- 本次问题的根因不是“未开启 strict”，而是**显式 `any` / `as any` / 宽泛回调签名**仍然残留在 SDK 公共导出与测试中。
- `hula` 中“66 处 any 全由 SDK 类型缺失导致”的前提与当前代码库不符；实际匹配结果明显更大，且其中相当一部分属于下游自身类型债务，不是 SDK 单点修复即可归零。

## 2. 直接证据

### 2.1 TypeScript 基线

`/Users/ljf/Desktop/hu/matrix-js-sdk/tsconfig.json`

- `"strict": true`
- `"noImplicitAny": true`

### 2.2 ESLint 基线

`/Users/ljf/Desktop/hu/matrix-js-sdk/.eslintrc.cjs`

- 当前存在:
  - `@typescript-eslint/no-explicit-any: "off"`
- 这意味着仓库允许继续引入显式 `any`，是后续零新增约束尚未建立的主要原因之一。

### 2.3 Trace 输出

已执行:

```bash
pnpm exec tsc -p tsconfig.json --noEmit --generateTrace .trace-strict
```

输出目录:

- `matrix-js-sdk/.trace-strict`

说明:

- `--generateTrace` 可用于保留类型检查行为轨迹，但**不能直接枚举所有 `as any`**。
- `as any` / 显式 `any` 的完整清单仍需结合源码检索统计。

## 3. 数量统计

### 3.1 `matrix-js-sdk`

- `src/` 中 `as any | : any | Promise<any> | Observable<any>`:
  - `22` 处
  - `10` 个文件
- `spec/` 中相同模式:
  - `724` 处
  - `141` 个文件

### 3.2 `hula`

- `src/` 中 `as any`:
  - `1181` 处
  - `155` 个文件
- `src/` 中其余显式 `any`（`: any | Promise<any> | Observable<any> | <any>`）:
  - `513` 处
  - `163` 个文件
- `src/services/matrix` 范围内总匹配:
  - `524` 处
  - `83` 个文件
- `src/types` 范围内总匹配:
  - `19` 处
  - `3` 个文件
- 直接依赖 `matrix-js-sdk` 或本地 matrix 类型包装的文件:
  - `93` 处
  - `80` 个文件

## 4. SDK 公共 API 映射表

以下为 `matrix-js-sdk/src` 中最值得优先处理、且最可能影响下游断言的条目。

| 文件 | 符号/位置 | 当前状态 | 备注 |
| --- | --- | --- | --- |
| `src/client.ts` | `getProfileManager()` | ✅ 已修复 | 返回 `ProfileManager \| null` |
| `src/matrix-client-extensions.d.ts` | `setRoomAvatar()` 等 4 个房间设置方法 | ✅ 已修复 | 改为 `Promise<void>` |
| `src/models/typed-event-emitter.ts` | `AnyListener` / `ListenerMap` | ✅ 已优化 | 使用 `any[]` 作为基类约束以保证兼容性 |
| `src/models/read-receipt.ts` | `ListenerMap` | ✅ 已对齐 | 继承自 `TypedEventEmitter` |
| `src/models/event.ts` | `IContent` / `IUnsigned` 索引签名 | ✅ 已收紧 | 改为 `[key: string]: unknown` 并补齐常用字段 |
| `src/store/indexeddb.ts` | `on(...args: any[])` | ✅ 已修复 | 建立了 `StoreEventHandlerMap` |
| `src/store/index.ts` | `on?: (...args: any[])` | ✅ 已修复 | 对齐 `StoreEventHandlerMap` |
| `src/logger.ts` | `trace/debug/info/warn/error(...msg: any[])` | ✅ 已收紧 | 改为 `unknown[]` |
| `src/matrix-client-extensions.d.ts` | `MatrixClient` 接口合并 | ✅ 已实现 | 通过接口合并消除 Manager 中的 `as any` |
| `src/client.ts` 注释 | `IContent` 依赖 `[key: string]: any` | ✅ 已处理 | 配合 `IContent` 收紧完成修复 |

## 5. 对下游 `hula` 的判断

### 5.1 可以明确归因给 SDK 的类型缺口

优先可疑来源:

- `MatrixClient` 扩展方法返回值过宽
- `IContent` / `IUnsigned` 的开放索引签名
- 事件发射器/回调参数无明确事件图
- 日志、存储、房间设置等公共 API 的 `any` 返回值

### 5.2 不能直接归因给 SDK 的部分

以下部分即使 SDK 完整补型，也不会自然归零:

- `hula` 自有测试 mock 中的大量 `as any`
- 视图层、hook、store 的临时类型逃逸
- 本地 `src/types/*.d.ts` 的宽泛声明
- 与第三方库无关的业务层 `any` 简化

结论:

- “SDK 改完后下游 66 -> 0” 当前**不具备直接成立条件**。
- 更现实的路径应为:
  1. 先清理 `matrix-js-sdk/src` 的公共 API 显式 `any`
  2. 再清理 `hula/src/services/matrix` 与 `src/types` 中直接受影响的调用链
  3. 最后处理 UI/test mock 中的本地类型债务

### Phase B: 下游 Hula 直连调用链修复

已清理 `hula/src/services/matrix` 中受 SDK 类型收紧影响的 `as any` 断言：

| 文件 | 修复内容 | 状态 | 备注 |
| --- | --- | --- | --- |
| `MatrixMessageService.ts` | `hasUserReadEvent` | ✅ 已修复 | 移除 `as any` |
| `MatrixSyncService.ts` | `getUnreadNotificationCount` | ✅ 已修复 | 移除 `as any`，改用 `NotificationCountType` |
| `MatrixSpaceService.ts` | `room.topic` | ✅ 已修复 | 移除 `as any`，补齐 `Room` 阴影类型 |
| `MatrixUserDirectoryService.ts` | `searchUserDirectory` / `getProfile` | ✅ 已修复 | 移除 `as any`，补齐 SDK 扩展接口 |
| `MatrixSearchService.ts` | `setRoomDirectoryVisibility` | ✅ 已修复 | 移除 `as any` |
| `MatrixRoomNotificationService.ts` | `setRoomAccountData` | ✅ 已修复 | 移除 `as any` |
| `MatrixRoomService.ts` | `getRoomTopic` | ✅ 已修复 | 移除 `as any` |
| `MatrixMessageAdapter.ts` | `event.sender` | ✅ 已修复 | 移除 `as any`，修正 `MatrixEvent.sender` 阴影类型 |
| `MatrixMessageAdapter.ts` | `convertMatrixContent` | ✅ 已修复 | 修正返回类型为 `MessageBody`，移除属性访问 `as any` |
| `MatrixSpaceService.ts` | `createRoom` / `joinRoom` | ✅ 已修复 | 移除 `as any`，补齐 `ICreateRoomOpts` 与 `MatrixClient` 阴影类型 |
| `MatrixReactionService.ts` | `sendEvent` / `redactEvent` | ✅ 已修复 | 移除 `as any`，修正 `MatrixEvent.getContent` 访问 |
| `MatrixTypingService.ts` | `getTypingUsers` | ✅ 已修复 | 移除 `as any`，改用 `Room.getTypingUsers` 阴影方法 |
| `MatrixSlidingSyncService.ts` | `slidingSync` 实例 | ✅ 已修复 | 移除 `any`，建立 `SlidingSync` 阴影接口 |

### Phase C: Hula 内部类型债务清理 (Service 层非测试代码)

目标: 清理 `hula/src/services/matrix` 中不直接依赖 SDK 导出但仍在使用 `any` 的逻辑。

| 文件 | 修复内容 | 状态 | 备注 |
| --- | --- | --- | --- |
| `MatrixMessageAdapter.ts` | `MsgType` 构造 | ✅ 已修复 | 完整补齐 `MsgType` 所需的 `id`, `roomId`, `type`, `body` 等字段 |
| `AdminFacadeService.ts` | `adminRequest<T>` | ✅ 已修复 | 引入泛型请求，消除 `Promise<any>` |
| `MatrixEmojiService.ts` | `http` 响应断言 | ✅ 已修复 | 为表情包上传/查询引入本地响应接口 |

## 6. 风险评估

- 若直接在 `matrix-js-sdk` 全仓库启用 `@typescript-eslint/no-explicit-any: "error"`:
  - 将立即命中 `src` + `spec` 中大量历史存量
  - 首轮阻塞点将集中在测试与辅助工具，而不是公共 API
- 若直接要求 `spec/` 零 `any`:
  - 这是大规模测试基建重写，不适合与下游业务修复并行推进

## 7. 建议的分阶段方案

### Phase A: SDK 公共 API 收紧

目标:

- 只处理 `matrix-js-sdk/src` 中 `22` 处显式 `any` / `Promise<any>` / 宽索引签名
- 不先触碰 `spec/` 的 `724` 处历史测试类型债务

验收:

- `src/` 公共 API 不再暴露 `any`
- `client.ts` / `matrix-client-extensions.d.ts` / `event.ts` / `typed-event-emitter.ts` / `logger.ts` / `store` 事件接口完成收紧

### Phase B: 下游直连调用链修复

目标:

- 优先清理 `hula/src/services/matrix` 与 `hula/src/types`
- 只移除由 SDK 公共 API 宽类型直接导致的断言

验收:

- 下游 matrix service 层中对应调用链不再依赖相关 `as any`

### Phase C: 测试与本地类型债务收尾

目标:

- 再处理 `spec/` 与 `hula` 测试 mock 中的 `any`
- 最后再考虑打开 `@typescript-eslint/no-explicit-any: "error"`

## 8. 当前建议

建议按以下顺序继续:

1. 先改 `matrix-js-sdk/src` 的 10 个源文件。
2. 同步消除 `hula/src/services/matrix` 中与这些 API 对应的首批断言。
3. 暂不承诺本轮完成 `spec/` 全量零 `any`、版本升级、CHANGELOG Breaking、README 全量兼容声明。

## 9. 当前状态

- ✅ 已完成 strict/ESLint 基线审计
- ✅ 已生成 trace 输出
- ✅ 已建立 `src` 级别公共 API 映射
- ✅ Phase A: SDK 公共 API 收紧已完成
- ✅ Phase B: 下游 Hula 修复已启动并完成首批直连调用链修复
- ⚠️ 尚未开始 Phase C (测试与本地类型债务收尾)
