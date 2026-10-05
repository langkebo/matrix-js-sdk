# Quickstart 索引

三份**可直接复制执行**的示例，覆盖接入本 SDK 的全部起点。每份都包含完整代码、预期输出与错误处理，而不是片段。

| #                             | 场景                        | 入口                          | 涉及能力                                                                      |
| :---------------------------- | :-------------------------- | :---------------------------- | :---------------------------------------------------------------------------- |
| [01](01-messaging.md)         | 登录 + 收发消息 + sync 循环 | `HuLaClient` / `MatrixClient` | `loginRequest`、`startClient`、`sendMessage`、`RoomEvent.Timeline`            |
| [02](02-e2ee.md)              | 端到端加密初始化            | `MatrixClient`                | `initRustCrypto`、`bootstrapCrossSigning`、`bootstrapSecretStorage`、密钥备份 |
| [03](03-spaces-friends-dm.md) | 空间层级 + 好友 + 直聊      | `MatrixClient` + 三个 Manager | `getSpaceManager`、`getFriendManager`、`getDirectMessageManager`              |

相关文档：

- [SDK 错误处理与重试指南](./04-error-handling.md) —— `SdkError` 体系、`errorCode` / `retryAfter` / `isRetryable` 的用法
- [MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md) —— 从 upstream matrix-js-sdk 迁移
- [MSC_SEMANTICS.md](../MSC_SEMANTICS.md) —— 本 fork 相对 MSC 的语义约定

---

## 前置条件

| 项       | 要求                                                                                     |
| :------- | :--------------------------------------------------------------------------------------- |
| Node.js  | 20 或更高（示例用原生 `fetch`）                                                          |
| 包管理器 | pnpm（仓库约定，勿混用 npm）                                                             |
| 服务端   | 任一 Matrix homeserver；本仓库的 real-backend 测试以 `https://matrix.test` 为例          |
| 传输     | **必须 HTTPS**。`http://` 会被拒绝，除非显式传 `allowInsecureHttp: true`（见下方陷阱 5） |

```bash
pnpm add @langkebo/matrix-js-sdk
```

> 若从源码仓库运行示例，仓库内 `tsconfig.json` 只编译 `src` 与 `spec`；本节示例以独立的 `.ts` 文件形式给出，可直接放入你自己的项目。

---

## 心智模型

### 1. 三条入口，按需要选择

```text
需要「登录→收消息→发消息」           →  HuLaClient（30 秒路径，见 01）
需要 E2EE / 空间 / 好友 / 直聊 / 管理  →  createClient() + getXxxManager()（见 02、03）
需要细粒度 HTTP 或自建封装             →  matrix-sdk-js/http-api、/errors 等子路径入口
```

### 2. Manager 的两种挂载时机（最容易踩的坑）

`createClient()` 之后并不是所有 manager 都立刻可用，它们分两批：

| 批次         | 触发时机                          | 举例                                                                                                                                                                | 调用方式                                       |
| :----------- | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------- |
| **同步核心** | `createClient()` 返回时**已挂载** | `AccountManager`、`RoomManager`、`EventManager`、`ProfileManager`、`DeviceManager`、`PresenceManager`、`AuthManager`、`AccountDataManager`、`IdentityServerManager` | 直接 `client.getAccountManager()`              |
| **异步扩展** | 动态 `import()` 完成后才挂载      | `SpaceManager`、`FriendManager`、`DirectMessageManager`、`AdminManager`、`PushManager`、`RoomSummaryManager` …                                                      | 先 `await client.whenManagerExtensionsReady()` |

```typescript
import { createClient } from "@langkebo/matrix-js-sdk";

const client = createClient({ baseUrl: "https://matrix.test", accessToken, userId, deviceId });

// 同步核心：立刻可用
client.getAccountManager();

// 异步扩展：必须先等待，否则 getFriendManager 是 undefined
await client.whenManagerExtensionsReady();
client.getFriendManager();
```

若宿主环境完全不需要这些扩展 manager（例如纯消息客户端），可在 `createClient` 时传 `disableDynamicExtensions: true` 省掉这次动态加载。

### 3. 错误是一棵树，不是裸 Error

所有 SDK 错误继承 `SdkError`，并携带可直接驱动 UI 与重试策略的元数据：

| 字段          | 类型      | 用途                                                                           |
| :------------ | :-------- | :----------------------------------------------------------------------------- |
| `errorCode`   | `string`  | Matrix 错误码，如 `M_FORBIDDEN`（可用 `MatrixErrorCode.M_FORBIDDEN` 常量比较） |
| `statusCode`  | `number`  | HTTP 状态码                                                                    |
| `traceId`     | `string?` | 后端追踪 ID，排障时对齐日志用                                                  |
| `userTip`     | `string?` | 后端给的用户可读提示，可直接展示                                               |
| `retryAfter`  | `number?` | 建议重试延迟（毫秒）                                                           |
| `isRetryable` | `boolean` | 归一化后的重试建议                                                             |

归一化规则：`401`/`M_UNKNOWN_TOKEN` → `AuthError`；`404` → `NotFoundError`；`429`/`5xx`/网络异常 → `RetryableError`；其他 → `ApiError`；客户端参数问题 → `ValidationError`。

```typescript
import { RetryableError, SdkError } from "@langkebo/matrix-js-sdk";

try {
    await client.getDirectMessageManager().creation.createDm({ userIds: ["@bob:matrix.test"] });
} catch (err) {
    if (err instanceof SdkError && err.isRetryable) {
        await new Promise((r) => setTimeout(r, err.retryAfter ?? 1000));
        // …重试
    }
}
```

---

## 五个常见陷阱（都有代码证据）

### 陷阱 1：`loginRequest()` 不会改 client 的凭据

`AccountManager.loginRequest()` 只发请求并返回响应，**不会**写入 `accessToken` / `userId`。想拿到"已登录的 client"，有两条路：

```typescript
// 路径 A（推荐）：用返回值新建 client
const bootstrap = createClient({ baseUrl });
const res = await bootstrap.loginRequest({
    type: "m.login.password",
    identifier: { type: "m.id.user", user },
    password,
});
const client = createClient({ baseUrl, accessToken: res.access_token, userId: res.user_id, deviceId: res.device_id });

// 路径 B：用 login()，它会就地写入凭据
const client2 = createClient({ baseUrl });
await client2.getAccountManager().login("m.login.password", { user, password });
// 此后 client2 可直接 startClient()
```

### 陷阱 2：`sendMessage` 的第二个参数是 `threadId`，不是内容

`sendMessage(roomId, threadId, content, txnId)`。只传内容时依赖的是对象重载，**能工作但语义模糊**；显式传 `null` 才是"不发到 thread 的顶层消息"：

```typescript
await client.sendMessage(roomId, { msgtype: MsgType.Text, body: "hi" }); // 对象重载，可用
await client.sendTextMessage(roomId, "hi"); // 更清晰，推荐
await client.sendMessage(roomId, null, { msgtype: MsgType.Text, body: "hi" }); // 显式顶层
```

### 陷阱 3：异步扩展 manager 不等待就是 `undefined`

见上文"心智模型 2"。典型症状是 `TypeError: client.getFriendManager is not a function`，且只在冷启动时出现（热启动时代码已缓存、挂载已完成）。

### 陷阱 4：E2EE 默认拒绝不加密的内存密钥库

`initRustCrypto()` 若既没给 `storageKey` / `storagePassword`，也没给 `allowInMemoryStore`，会直接抛错（防止桌面端进程明文持有密钥）。生产环境必须从系统钥匙串派生 `storageKey`。

### 陷阱 5：`baseUrl` 强制 HTTPS

`createClient()` 会校验 `baseUrl`，`http://` 仅允许显式声明：

```typescript
createClient({ baseUrl: "http://localhost:8008", allowInsecureHttp: true }); // 仅开发
```

---

## 运行示例

每份指南给出的是完整的单文件程序，按文件头的注释保存后即可运行：

```bash
# 以 01 为例（假设已安装 tsx 或 ts-node；也可编译后 node 运行）
MATRIX_HOMESERVER=https://matrix.test \
MATRIX_USER=alice \
MATRIX_PASSWORD=alice-secret \
MATRIX_ROOM_ID='!demo:matrix.test' \
npx tsx 01-messaging.ts
```

预期输出见各指南的「预期输出」小节。若你的 homeserver 用自签名证书，需让 Node 信任该 CA（本仓库 real-backend 测试通过脚本注入 CA，见 `scripts/run-real-backend-with-ca.mjs`）。
