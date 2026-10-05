# 01 · 登录 + 收发消息 + sync 循环

最小可用的接入路径。给了两条路线：**30 秒跑通**（`HuLaClient`）与**完整控制**（`MatrixClient`）。两者可以混用——`HuLaClient` 只是 `MatrixClient` 的薄封装。

---

## 路线 A：`HuLaClient`（30 秒）

本 fork 内置了一个 3 行集成的门面类，专为"我只想登录、收消息、发消息"的场景准备。

```typescript title="01a-messaging-hula.ts"
/**
 * 01a-messaging-hula.ts —— 最短接入路径
 *
 * 运行：
 *   MATRIX_HOMESERVER=https://matrix.test \
 *   MATRIX_USER=alice MATRIX_PASSWORD=alice-secret \
 *   MATRIX_ROOM_ID='!demo:matrix.test' \
 *   npx tsx 01a-messaging-hula.ts
 *
 * 进程会持续保持连接（Ctrl+C 退出），期间对端发来的消息会实时打印。
 */
import { HuLaClient } from "@langkebo/matrix-js-sdk";

const HOMESERVER = process.env.MATRIX_HOMESERVER ?? "https://matrix.test";
const USER = process.env.MATRIX_USER ?? "alice";
const PASSWORD = process.env.MATRIX_PASSWORD ?? "alice-secret";
const ROOM_ID = process.env.MATRIX_ROOM_ID ?? "";

async function main(): Promise<void> {
    const hula = new HuLaClient(HOMESERVER);

    // 1) 登录：内部走 getAccountManager().login()，会就地写入 accessToken / userId，
    //    因此之后可以直接 start() / sendText()。
    await hula.login(USER, PASSWORD);
    console.log(`[login] ok as ${USER}`);

    // 2) 订阅消息：removed 与历史回填已被门面过滤，这里只会收到新到达的事件。
    hula.onMessage((roomId, event) => {
        if (event.getType() !== "m.room.message") return;
        const sender = event.getSender() ?? "?";
        const body = event.getContent().body ?? "";
        console.log(`[message] ${roomId} ${sender}: ${body}`);
    });

    // 3) 启动 sync 循环。Resolve 时首个 /sync 已完成，后续消息通过回调送达。
    await hula.start();
    console.log("[sync] started");

    // 4) 发一条消息
    if (ROOM_ID) {
        const eventId = await hula.sendText(ROOM_ID, `hello from quickstart @ ${new Date().toISOString()}`);
        console.log(`[send] event_id=${eventId}`);
    }
}

process.on("SIGINT", () => {
    console.log("\n[shutdown]");
    process.exit(0);
});

main().catch((err: unknown) => {
    console.error("[fatal]", err);
    process.exit(1);
});
```

### 预期输出

```text
[login] ok as alice
[sync] started
[send] event_id=$AbCdEf123456
[message] !demo:matrix.test @bob:matrix.test: hi alice
```

`event_id` 每次不同；`[message]` 行只在对端真的发了消息时出现。

### `HuLaClient` 的边界

它刻意只暴露 5 个方法：`login` / `onMessage` / `sendText` / `start` / `stop`。**没有** E2EE 初始化、空间、好友、直聊、管理能力。需要这些时走路线 B。

---

## 路线 B：`MatrixClient`（完整控制）

需要以下任一能力时用这条路线：自定义 sync 参数、按房间/线程过滤、处理本地回声与历史回填、精致化的错误处理、E2EE。

```typescript title="01b-messaging.ts"
/**
 * 01b-messaging.ts —— 完整控制的登录 / 收发 / sync 循环
 *
 * 运行：
 *   MATRIX_HOMESERVER=https://matrix.test \
 *   MATRIX_USER=alice MATRIX_PASSWORD=alice-secret \
 *   MATRIX_ROOM_ID='!demo:matrix.test' \
 *   npx tsx 01b-messaging.ts
 *
 * 已有会话时可直接复用（免登录）：
 *   MATRIX_ACCESS_TOKEN=syt_xxx MATRIX_USER_ID=@alice:matrix.test MATRIX_DEVICE_ID=ABCDEFGH tsx 01b-messaging.ts
 */
import {
    ClientEvent,
    createClient,
    type MatrixClient,
    type MatrixEvent,
    MsgType,
    RoomEvent,
    SdkError,
    SyncState,
} from "@langkebo/matrix-js-sdk";

const HOMESERVER = process.env.MATRIX_HOMESERVER ?? "https://matrix.test";
const USER = process.env.MATRIX_USER ?? "alice";
const PASSWORD = process.env.MATRIX_PASSWORD ?? "alice-secret";
const ROOM_ID = process.env.MATRIX_ROOM_ID ?? "";

/**
 * 1) 建立连接。
 *
 * 优先复用环境里的会话三元组（accessToken + userId + deviceId）——这是生产环境的常态；
 * 三者缺一才走密码登录。
 */
async function connect(): Promise<MatrixClient> {
    const token = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    const deviceId = process.env.MATRIX_DEVICE_ID;

    if (token && userId && deviceId) {
        console.log(`[login] 复用已有会话 ${userId} / ${deviceId}`);
        return createClient({ baseUrl: HOMESERVER, accessToken: token, userId, deviceId });
    }

    // 密码登录需要两个 client：一个只用来换 token（未认证），一个持有 token 干活。
    // 原因：loginRequest() 只返回响应，不会改写 client 的凭据。
    const bootstrap = createClient({ baseUrl: HOMESERVER });
    const res = await bootstrap.loginRequest({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: USER },
        password: PASSWORD,
        initial_device_display_name: "quickstart-01-messaging",
    });
    console.log(`[login] ${res.user_id} device=${res.device_id}`);

    return createClient({
        baseUrl: HOMESERVER,
        accessToken: res.access_token,
        userId: res.user_id,
        deviceId: res.device_id,
    });
}

/** 2) 订阅 sync 状态与房间时间线。 */
function subscribe(client: MatrixClient): void {
    client.on(ClientEvent.Sync, (state, prevState) => {
        console.log(`[sync] ${prevState ?? "-"} -> ${state}`);

        if (state === SyncState.Prepared) {
            // 首次同步完成：此时房间列表与时间线已可用。
            console.log(`[sync] 首次同步完成，已加入 ${client.getRooms().length} 个房间`);
        }
        if (state === SyncState.Error) {
            // SDK 自身会退避重试；这里只做可观测性上报。
            console.error("[sync] 同步失败，SDK 将自动退避重试");
        }
    });

    // RoomEvent.Timeline 的 4 个参数依次是：
    //   event, room, toStartOfTimeline(是否历史回填), removed(是否为本地回声被移除)
    client.on(RoomEvent.Timeline, (event: MatrixEvent, room, toStartOfTimeline, removed) => {
        if (removed || toStartOfTimeline) return;
        if (event.getType() !== MsgType.Text) return;

        const roomId = room?.roomId ?? event.getRoomId() ?? "";
        const sender = event.getSender() ?? "?";
        const body = event.getContent().body ?? "";
        console.log(`[message] ${roomId} ${sender}: ${body}`);
    });
}

/** 3) 启动 sync 循环并发送一条消息。 */
async function main(): Promise<void> {
    const client = await connect();
    subscribe(client);

    // initialSyncLimit 限制首个 /sync 带回的历史消息条数，避免冷启动拉全量。
    await client.startClient({ initialSyncLimit: 20 });

    if (ROOM_ID) {
        const res = await client.sendTextMessage(ROOM_ID, `hello from quickstart @ ${new Date().toISOString()}`);
        console.log(`[send] event_id=${res.event_id}`);
    } else {
        console.log("[send] 未设置 MATRIX_ROOM_ID，跳过发送");
    }

    const shutdown = (): void => {
        console.log("\n[shutdown] stopClient()");
        client.stopClient();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
    if (err instanceof SdkError) {
        console.error(
            `[fatal] ${err.name} code=${err.errorCode} status=${err.statusCode} ` +
                `trace=${err.traceId ?? "-"} retryable=${err.isRetryable} msg=${err.message}`,
        );
    } else {
        console.error("[fatal]", err);
    }
    process.exit(1);
});
```

### 预期输出

首轮（冷启动，无会话）：

```text
[login] @alice:matrix.test device=QWERTYUIOP
[sync] null -> PREPARED
[sync] 首次同步完成，已加入 3 个房间
[send] event_id=$XyZ789abc
[sync] PREPARED -> SYNCING
[message] !demo:matrix.test @bob:matrix.test: hi alice
```

第二轮（复用会话，`sync` 状态可能直接从缓存命中）：

```text
[login] 复用已有会话 @alice:matrix.test / QWERTYUIOP
[sync] null -> PREPARED
[sync] 首次同步完成，已加入 3 个房间
```

`Ctrl+C` 时输出：

```text
[shutdown] stopClient()
```

### 失败时的输出

token 过期（`401` / `M_UNKNOWN_TOKEN`）会归一化成 `AuthError`：

```text
[fatal] AuthError code=M_UNKNOWN_TOKEN status=401 trace=- retryable=false msg=Invalid access token
```

服务端不可达（网络层）会归一化成 `RetryableError`，此时进程退出码为 `1`：

```text
[fatal] RetryableError code=undefined status=undefined trace=- retryable=true msg=fetch failed
```

---

## 逐段说明

### `loginRequest` vs `login` vs 复用 token

| 场景                              | 用什么                                            | 是否就地写入 client 凭据              |
| :-------------------------------- | :------------------------------------------------ | :------------------------------------ |
| 应用启动，已有持久化 token        | `createClient({ accessToken, userId, deviceId })` | 是（构造即生效）                      |
| 交互式登录，之后要用同一个 client | `client.getAccountManager().login(type, params)`  | **是**                                |
| 交互式登录，只要响应数据          | `client.loginRequest(data)`                       | **否**（必须自己拿返回值新建 client） |

`loginRequest` 返回 `{ access_token, user_id, device_id }`，其中 `expires_in` 已被本 fork 归一化为 `expires_in_ms`（毫秒），可直接与 `Date.now()` 比较。

### sync 状态机

```text
null ──► PREPARED ──► SYNCING ⇄ SYNCING
                │        │
                │        └──► ERROR ──► SYNCING（SDK 自动退避重试）
                └──► STOPPED（调用 stopClient() 后）
```

- **`PREPARED`**：首个 `/sync` 完成，房间与时间线可读。**这是业务代码可以开始渲染的时机。**
- **`SYNCING`**：每次 `/sync` 请求完成后触发，可能很频繁（默认长轮询 30s，有事件时立即返回），**不要在里面做重活**。
- **`ERROR`**：连续失败超阈值或遇到硬错误（如 token 失效）。SDK 会自行重试，但 token 失效需要业务层重新登录。
- **`STOPPED`**：`stopClient()` 之后。

### 为什么要过滤 `removed` 与 `toStartOfTimeline`

- `toStartOfTimeline === true` 表示这是**历史回填**（向上翻页拉回来的旧事件），不是新消息。不过滤会导致界面在翻页时重复插入旧消息。
- `removed === true` 表示这条事件是被**移除**的（例如本地回声被服务器事件替换、或消息被撤回），此时 `event` 参数实际承载的是被移除的事件。不过滤会导致 UI 出现"幽灵消息"。

### 优雅退出

`stopClient()` 会同步停止 sync 轮询并清理定时器。**不调用它而直接退出进程**，在长驻服务里会留下未完成的请求与定时器（本仓库有 `quality:timer-pairing` 门禁专门防范 SDK 内部的这类泄漏）。

---

## 常见陷阱

1. **`loginRequest()` 之后 `client` 仍是未认证状态。** 见上文表格。症状是后续所有请求返回 `401 M_MISSING_TOKEN`。
2. **在 `PREPARED` 之前读 `client.getRooms()` 得到空数组。** 房间数据由首个 `/sync` 填充。
3. **`sendMessage(roomId, content)` 能跑但不是显式写法。** 第二个参数真实语义是 `threadId`；只传内容依赖的是对象重载。想发顶层消息请用 `sendTextMessage(roomId, text)` 或显式传 `null`。
4. **`on(RoomEvent.Timeline)` 忘了过滤 `toStartOfTimeline`。** 翻页会重复插入历史消息。
5. **`baseUrl` 用 `http://` 且没传 `allowInsecureHttp: true`。** `createClient` 会直接拒绝（安全默认值）。

---

下一步：[02 · 端到端加密初始化](02-e2ee.md) →
