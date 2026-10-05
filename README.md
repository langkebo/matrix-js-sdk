# `@langkebo/matrix-js-sdk`

> **这是 [`matrix-org/matrix-js-sdk`](https://github.com/matrix-org/matrix-js-sdk) 的 fork**，面向 **synapse-rust** 后端
> （TJG / langkebo 项目）扩展了好友、私聊、空间、Admin、语音等私有能力。
> 包名 `@langkebo/matrix-js-sdk`，仓库 `github.com/langkebo/matrix-js-sdk`。
>
> 上游与本 fork 的差异、契约状态与审计结论见 [`docs/sdk-encapsulation-audit.md`](./docs/sdk-encapsulation-audit.md)
> 与 [`docs/MSC_SDK_MAPPING.md`](./docs/MSC_SDK_MAPPING.md)。

本 SDK 实现了 Matrix Client-Server 协议，可在浏览器或 Node.js 中运行，端到端加密基于 Rust + WebAssembly。

- **Node.js**：v22+
- **TypeScript**：strict 模式，target ES2022
- **后端**：synapse-rust（私有端点位于 `/_matrix/vendor/v1`）

---

## 相对上游新增的能力

| 能力          | 入口点                                 | 说明                                                            |
| ------------- | -------------------------------------- | --------------------------------------------------------------- |
| 好友关系      | `@langkebo/matrix-js-sdk/friend`       | `FriendManager`：好友列表、申请、删除等                         |
| 私聊（DM）    | `@langkebo/matrix-js-sdk/dm`           | `DirectMessageManager`                                          |
| 空间层级      | `@langkebo/matrix-js-sdk/space`        | `SpaceManager`：空间树、子空间                                  |
| 服务器管理    | `@langkebo/matrix-js-sdk/admin`        | `AdminManager` 及 6 个子管理器（用户/房间/服务/联邦/媒体/配置） |
| 语音 / WebRTC | `@langkebo/matrix-js-sdk/voice`        | `VoiceManager`、WebRTC 通话                                     |
| 房间摘要      | `@langkebo/matrix-js-sdk/room-summary` | `RoomSummary*` 系列管理器                                       |

## 契约驱动架构

本 fork 的核心约束是**契约驱动**：synapse-rust 后端导出的路由清单（ledger）是唯一事实来源。

1. 后端导出的每个 `(method, path, registered_by)` 由 `scripts/contract-sync.mjs` 落到
   `docs/api-contract/generated/modules/<module>.json`；
2. `scripts/sdk-contract-codegen.mjs` 据此生成 `src/<module>/__generated__/` 下的路由表与 DTO；
3. 管理器引用生成的路由表，**路径写错是编译错误，而不是运行时 404**。

> `src/**/__generated__/` 为生成物，**禁止手改**。改动 API 后请执行
> `pnpm contract:sync && pnpm contract:codegen` 并提交生成结果。

## 质量门禁

本 fork 在 CI 中串联了类型、契约、覆盖率台账、空 catch、技术债标记等多道门禁：

```bash
pnpm lint     # 类型 + 契约 + 质量门禁全链路
pnpm test     # 单元 / 集成测试（不含 real-backend）
```

详见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 与 [`AGENTS.md`](./AGENTS.md)。

## Quickstart

> [!IMPORTANT]
> Servers may require or use authenticated endpoints for media (images, files, avatars, etc). See the
> [Authenticated Media](#authenticated-media) section for information on how to enable support for this.

Using `pnpm` instead of `npm` is recommended. Please see the pnpm [install
guide](https://pnpm.io/installation#using-corepack) if you do not have it already.

`pnpm add @langkebo/matrix-js-sdk`

```javascript
import * as sdk from "@langkebo/matrix-js-sdk";
const client = sdk.createClient({ baseUrl: "https://matrix.test" });
client.publicRooms(function (err, data) {
    console.log("Public Rooms: %s", JSON.stringify(data));
});
```

See [below](#end-to-end-encryption-support) for how to enable end-to-end-encryption.

To start the client:

```javascript
await client.startClient({ initialSyncLimit: 10 });
```

You can perform a call to `/sync` to get the current state of the client:

```javascript
client.once(ClientEvent.sync, function (state, prevState, res) {
    if (state === "PREPARED") {
        console.log("prepared");
    } else {
        console.log(state);
        process.exit(1);
    }
});
```

To send a message:

```javascript
const content = {
    body: "message text",
    msgtype: "m.text",
};
client.sendEvent("roomId", "m.room.message", content, "", (err, res) => {
    console.log(err);
});
```

To listen for message events:

```javascript
client.on(RoomEvent.Timeline, function (event, room, toStartOfTimeline) {
    if (event.getType() !== "m.room.message") {
        return; // only use messages
    }
    console.log(event.event.content.body);
});
```

By default, the `@langkebo/matrix-js-sdk` client uses the `MemoryStore` to store events as they are received. For example to iterate through the currently stored timeline for a room:

```javascript
Object.keys(client.store.rooms).forEach((roomId) => {
    client.getRoom(roomId).timeline.forEach((t) => {
        console.log(t.event);
    });
});
```

## Authenticated media

Servers supporting [MSC3916](https://github.com/matrix-org/matrix-spec-proposals/pull/3916) (Matrix 1.11) will require clients, like
yours, to include an `Authorization` header when `/download`ing or `/thumbnail`ing media. For NodeJS environments this
may be as easy as the following code snippet, though web browsers may need to use [Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
to append the header when using the endpoints in `<img />` elements and similar.

```javascript
const downloadUrl = client.mxcUrlToHttp(
    /*mxcUrl=*/ "mxc://example.org/abc123", // the MXC URI to download/thumbnail, typically from an event or profile
    /*width=*/ undefined, // part of the thumbnail API. Use as required.
    /*height=*/ undefined, // part of the thumbnail API. Use as required.
    /*resizeMethod=*/ undefined, // part of the thumbnail API. Use as required.
    /*allowDirectLinks=*/ false, // should generally be left `false`.
    /*allowRedirects=*/ true, // implied supported with authentication
    /*useAuthentication=*/ true, // the flag we're after in this example
);
const img = await fetch(downloadUrl, {
    headers: {
        Authorization: `Bearer ${client.getAccessToken()}`,
    },
});
// Do something with `img`.
```

> [!WARNING]
> In future the js-sdk will _only_ return authentication-required URLs, mandating population of the `Authorization` header.

## What does this SDK do?

This SDK provides a full object model around the Matrix Client-Server API and emits
events for incoming data and state changes. Aside from wrapping the HTTP API, it:

- Handles syncing (via `/sync`)
- Handles the generation of "friendly" room and member names.
- Handles historical `RoomMember` information (e.g. display names).
- Manages room member state across multiple events (e.g. it handles typing, power
  levels and membership changes).
- Provides **Admin API** for server management operations (user management, room management, server monitoring, etc.)

## Admin Operations

The SDK includes comprehensive Admin API support for server management. **Admin access token required**.

### Quick Example

```javascript
const adminManager = client.getAdminManager();

// Get user info
const user = await adminManager.getUser("@alice:example.com");
console.log(`User: ${user.displayname}, Admin: ${user.admin}`);

// Create user
await adminManager.createUser("@bob:example.com", {
    password: "secure123",
    displayname: "Bob Smith",
});

// Get server status
const status = await adminManager.getServerStatus();
console.log(`Server status: ${status?.status}`);

// Send server notice
await adminManager.sendServerNotice("@user:example.com", {
    msgtype: "m.text",
    body: "Important: Server maintenance tonight at 22:00",
});
```

### Admin Features

- **User Management**: Create, deactivate, reset passwords, manage devices
- **Room Management**: List, delete, block rooms, manage members
- **Server Management**: Monitor status, health, statistics
- **Federation Management**: Blacklist servers, manage connections
- **Notification Management**: Send server notices

For detailed documentation, see [Admin API Guide](./docs/ADMIN_GUIDE.md).

- Exposes high-level objects like `Rooms`, `RoomState`, `RoomMembers` and `Users`
  which can be listened to for things like name changes, new messages, membership
  changes, presence changes, and more.
- Handle "local echo" of messages sent using the SDK. This means that messages
  that have just been sent will appear in the timeline as 'sending', until it
  completes. This is beneficial because it prevents there being a gap between
  hitting the send button and having the "remote echo" arrive.
- Mark messages which failed to send as not sent.
- Automatically retry requests to send messages due to network errors.
- Automatically retry requests to send messages due to rate limiting errors.
- Handle queueing of messages.
- Handles pagination.
- Handle assigning push actions for events.
- Handles room initial sync on accepting invites.
- Handles WebRTC calling.

## Usage

### Supported platforms

`@langkebo/matrix-js-sdk` can be used in either Node.js applications (ensure you have the latest LTS version of Node.js installed),
or in browser applications, via a bundler such as Webpack or Vite.

You can also use the sdk with [Deno](https://deno.land/) (`import npm:@langkebo/matrix-js-sdk`) but its not officially supported.

### Emitted events

The SDK raises notifications to the application using
[`EventEmitter`s](https://nodejs.org/api/events.html#class-eventemitter). The `MatrixClient` itself
implements `EventEmitter`, as do many of the high-level abstractions such as `Room` and `RoomMember`.

```javascript
// Listen for low-level MatrixEvents
client.on(ClientEvent.Event, function (event) {
    console.log(event.getType());
});

// Listen for typing changes
client.on(RoomMemberEvent.Typing, function (event, member) {
    if (member.typing) {
        console.log(member.name + " is typing...");
    } else {
        console.log(member.name + " stopped typing.");
    }
});

// start the client to setup the connection to the server
client.startClient();
```

### Entry points

除主入口 `@langkebo/matrix-js-sdk` 外，`package.json#exports` 还提供了若干子入口。
按需引入子入口可减小打包体积，并避免依赖主入口的历史遗留 API：

| 入口点                                 | 说明                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| `@langkebo/matrix-js-sdk`              | 主入口：`MatrixClient`、模型、store、事件枚举等            |
| `@langkebo/matrix-js-sdk/core`         | 精简核心，仅导出常用能力                                   |
| `@langkebo/matrix-js-sdk/crypto`       | 端到端加密（Rust + WASM），`CryptoApi`                     |
| `@langkebo/matrix-js-sdk/friend`       | 好友关系（`FriendManager`）                                |
| `@langkebo/matrix-js-sdk/dm`           | 私聊（`DirectMessageManager`）                             |
| `@langkebo/matrix-js-sdk/space`        | 空间层级（`SpaceManager`）                                 |
| `@langkebo/matrix-js-sdk/voice`        | 语音 / WebRTC                                              |
| `@langkebo/matrix-js-sdk/room`         | 房间                                                       |
| `@langkebo/matrix-js-sdk/room-summary` | 房间摘要（`RoomSummary*` 系列管理器）                      |
| `@langkebo/matrix-js-sdk/admin`        | 服务器管理（`AdminManager` 及子管理器）                    |
| `@langkebo/matrix-js-sdk/http-api`     | HTTP 客户端工具（前缀、错误、请求封装）                    |
| `@langkebo/matrix-js-sdk/store`        | 存储实现（Memory / IndexedDB / 加密 store）                |
| `@langkebo/matrix-js-sdk/models/room`  | 房间相关数据模型                                           |
| `@langkebo/matrix-js-sdk/errors`       | 类型化错误（`AuthError` / `NotFoundError` / `ApiError` …） |

完整入口点清单以 [`package.json`](package.json) 的 `exports` 字段为准。

### Architecture

#### Manager pattern

The SDK is organized around the **Manager pattern**: each functional domain (push, room, media,
crypto, etc.) is encapsulated in a dedicated `Manager` class that extends [`BaseManager`](src/managers/base-manager.ts).
All 51 Managers share a unified foundation:

- **Unified request pipeline**: `BaseManager.request<T>(spec)` handles HTTP transport, automatic retry
  (for idempotent operations), error normalization, and request statistics — so individual Managers
  only declare the HTTP method/path/body and parse the response.
- **Unified error handling**: `normalizeError()` converts `MatrixError`/`HTTPError`/network errors
  into typed `SdkError` subclasses (`AuthError`, `NotFoundError`, `RetryableError`, `ValidationError`,
  `ApiError`), giving callers a consistent error model regardless of which Manager produced it.
- **Unified retry**: `withRetry(fn, label)` wraps non-idempotent operations with configurable retry
  (max retries, exponential backoff with jitter, 429 `retry_after` parsing).
- **Request statistics**: Each Manager tracks `requestStats` (total/successful/failed/retried) via
  `getRequestStats()` / `resetRequestStats()`, enabling observability without external instrumentation.

#### Manager registration

Managers are lazily instantiated and cached on the `MatrixClient` instance via `extendMatrixClient()`
functions. The auto-generated registry at [`src/manager-extensions/index.ts`](src/manager-extensions/index.ts)
loads all Manager extensions dynamically (with `safeDynamicImport` for graceful teardown handling).

```typescript
// Access a Manager from a MatrixClient instance
const pushManager = client.getPushManager();
const widgetManager = client.getWidgetManager();
```

#### Type-safe internal access

`MatrixClient` exposes a rich public interface, but Managers sometimes need to access internal
fields (e.g., `syncApi`, `turnServers`, `serverClockDiff`) that are not part of the public API.
These internal members are declared in the [`MatrixClientInternalMethods`](src/matrix-client-extensions.ts)
interface. `BaseManager` provides a single type-safe accessor:

```typescript
// Inside any Manager:
this.internalClient.serverClockDiff; // typed as number
this.internalClient.syncApi; // typed as SyncApi | SlidingSyncSdk | undefined
this.internalClient.toDeviceMessageQueue.queueBatch(batch); // fully typed
```

This consolidates what was previously 45 scattered `as unknown as` type assertions into a single
assertion point in `BaseManager.internalClient`, restoring compile-time type checking at all access sites.

#### Module organization

The SDK's 51 Manager modules are organized by domain under `src/`:

| Domain                 | Modules                                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core lifecycle         | `client`, `sync`, `sliding-sync`, `sync-management`, `server-capabilities`                                                                                                                                |
| Rooms & messaging      | `room`, `room-manager`, `room-member`, `room-summary`, `room-state`, `timeline`, `threading`, `state-send`, `sending`, `ephemeral`, `reactions`, `pinned-messages`, `burn-after-read`                     |
| Users & identity       | `user`, `profile`, `account`, `account-data`, `presence`, `typing`, `threepids`, `user-directory`, `directory`                                                                                            |
| Push & notifications   | `push`, `push-rules`, `push-notifications`, `notifications`, `tags`, `tags-management`, `read-receipts`                                                                                                   |
| Crypto & E2EE          | `e2ee`, `crypto-keys`, `key-backup`, `key-rotation`, `key-verification`, `cross-signing`, `device`, `device-keys`, `device-trust`, `verification`, `secret-storage`, `secure-backup`, `dehydrated-device` |
| Media & uploads        | `media`, `uploads`                                                                                                                                                                                        |
| VOIP                   | `turn-server`, `voice`, `web-rtc`, `matrix-rtc`                                                                                                                                                           |
| Admin & moderation     | `admin`, `moderation`, `event-report`, `reporting`                                                                                                                                                        |
| Federation & directory | `federation`, `third-party`, `identity-server`, `discovery`                                                                                                                                               |
| Auth & SSO             | `auth`, `guest`, `captcha`, `saml`, `cas`, `oidc`, `password-reset`, `interactive-auth`, `rendezvous`                                                                                                     |
| Custom extensions      | `friend`, `space`, `external-service`, `feature-flags`, `telemetry`, `module`                                                                                                                             |

#### Frontend integration

The SDK is consumed by the `hula` frontend via a three-layer architecture:

- **L1 (SDK)**: `matrix-js-sdk/src/` — provides `Manager` classes (this package)
- **L2 (Frontend domain services)**: `hula/src/services/matrix/` — wraps SDK Managers with
  UI-specific concerns (connection state machine, event routing, crypto lifecycle tracking).
  `MatrixClientService` acts as a facade delegating to `MatrixConnectionManager`,
  `MatrixEventRouter`, and `MatrixCryptoStateTracker`.
- **L3 (Frontend path constants)**: `hula/src/services/matrix/paths/` — URL constants for
  direct HTTP calls that bypass the SDK (e.g., v3 fallback paths).

### Examples

This section provides some useful code snippets which demonstrate the
core functionality of the SDK. These examples assume the SDK is set up like this:

```javascript
import * as sdk from "@langkebo/matrix-js-sdk";
const myUserId = "@example:localhost";
const myAccessToken = "QGV4YW1wbGU6bG9jYWxob3N0.qPEvLuYfNBjxikiCjP";
const matrixClient = sdk.createClient({
    baseUrl: "https://matrix.test",
    accessToken: myAccessToken,
    userId: myUserId,
});
```

#### Automatically join rooms when invited

```javascript
matrixClient.on(RoomEvent.MyMembership, function (room, membership, prevMembership) {
    if (membership === KnownMembership.Invite) {
        matrixClient.joinRoom(room.roomId).then(function () {
            console.log("Auto-joined %s", room.roomId);
        });
    }
});

matrixClient.startClient();
```

#### Print out messages for all rooms

```javascript
matrixClient.on(RoomEvent.Timeline, function (event, room, toStartOfTimeline) {
    if (toStartOfTimeline) {
        return; // don't print paginated results
    }
    if (event.getType() !== "m.room.message") {
        return; // only print messages
    }
    console.log(
        // the room name will update with m.room.name events automatically
        "(%s) %s :: %s",
        room.name,
        event.getSender(),
        event.getContent().body,
    );
});

matrixClient.startClient();
```

Output:

```
  (My Room) @megan:localhost :: Hello world
  (My Room) @megan:localhost :: how are you?
  (My Room) @example:localhost :: I am good
  (My Room) @example:localhost :: change the room name
  (My New Room) @megan:localhost :: done
```

#### Print out membership lists whenever they are changed

```javascript
matrixClient.on(RoomStateEvent.Members, function (event, state, member) {
    const room = matrixClient.getRoom(state.roomId);
    if (!room) {
        return;
    }
    const memberList = state.getMembers();
    console.log(room.name);
    console.log(Array(room.name.length + 1).join("=")); // underline
    for (var i = 0; i < memberList.length; i++) {
        console.log("(%s) %s", memberList[i].membership, memberList[i].name);
    }
});

matrixClient.startClient();
```

Output:

```
  My Room
  =======
  (join) @example:localhost
  (leave) @alice:localhost
  (join) Bob
  (invite) @charlie:localhost
```

## API Reference

This SDK uses [Typedoc](https://typedoc.org/guides/doccomments) doc comments. You can manually build and
host the API reference from the source files like this:

```
  $ pnpm gendoc
  $ cd docs
  $ python -m http.server 8005
```

Then visit `http://localhost:8005` to see the API docs.

## End-to-end encryption support

`@langkebo/matrix-js-sdk`'s end-to-end encryption support is based on the [WebAssembly bindings](https://github.com/matrix-org/matrix-rust-sdk-crypto-wasm) of the Rust [matrix-sdk-crypto](https://github.com/matrix-org/matrix-rust-sdk/tree/main/crates/matrix-sdk-crypto) library.

### Initialization

To initialize the end-to-end encryption support in the matrix client:

```javascript
// Create a new matrix client
const matrixClient = sdk.createClient({
    baseUrl: "https://matrix.test",
    accessToken: myAccessToken,
    userId: myUserId,
});

// Initialize to enable end-to-end encryption support.
await matrixClient.initRustCrypto();
```

Note that by default it will attempt to use the Indexed DB provided by the browser as a crypto store. If running outside the browser, you will need to pass [an options object](https://matrix-org.github.io/matrix-js-sdk/classes/matrix.MatrixClient.html#initrustcrypto) which includes `useIndexedDB: false`, to use an ephemeral in-memory store instead. Note that without a persistent store, you'll need to create a new device on the server side (with [`MatrixClient.loginRequest`](https://matrix-org.github.io/matrix-js-sdk/classes/matrix.MatrixClient.html#loginrequest)) each time your application starts.

After calling `initRustCrypto`, you can obtain a reference to the [`CryptoApi`](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto_api.CryptoApi.html) interface, which is the main entry point for end-to-end encryption, by calling [`MatrixClient.getCrypto`](https://matrix-org.github.io/matrix-js-sdk/classes/matrix.MatrixClient.html#getCrypto).

**WARNING**: the cryptography stack is not thread-safe. Having multiple `MatrixClient` instances connected to the same Indexed DB will cause data corruption and decryption failures. The application layer is responsible for ensuring that only one `MatrixClient` issue is instantiated at a time.

### Secret storage

You should normally set up [secret storage](https://spec.matrix.org/v1.12/client-server-api/#secret-storage) before using the end-to-end encryption. To do this, call [`CryptoApi.bootstrapSecretStorage`](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto_api.CryptoApi.html#bootstrapSecretStorage).
`bootstrapSecretStorage` can be called unconditionally: it will only set up the secret storage if it is not already set up (unless you use the `setupNewSecretStorage` parameter).

```javascript
const matrixClient = sdk.createClient({
    ...,
    cryptoCallbacks: {
        getSecretStorageKey: async (keys) => {
            // This function should prompt the user to enter their secret storage key.
            return mySecretStorageKeys;
        },
    },
});

matrixClient.getCrypto().bootstrapSecretStorage({
    // This function will be called if a new secret storage key (aka recovery key) is needed.
    // You should prompt the user to save the key somewhere, because they will need it to unlock secret storage in future.
    createSecretStorageKey: async () => {
        return mySecretStorageKey;
    },
});
```

The example above will create a new secret storage key if secret storage was not previously set up.
The secret storage data will be encrypted using the secret storage key returned in [`createSecretStorageKey`](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto_api.CreateSecretStorageOpts.html#createSecretStorageKey).

We recommend that you prompt the user to re-enter this key when [`CryptoCallbacks.getSecretStorageKey`](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto_api.CryptoCallbacks.html#getSecretStorageKey) is called (when the secret storage access is needed).

### Set up cross-signing

To set up cross-signing to verify devices and other users, call
[`CryptoApi.bootstrapCrossSigning`](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto_api.CryptoApi.html#bootstrapCrossSigning):

```javascript
matrixClient.getCrypto().bootstrapCrossSigning({
    authUploadDeviceSigningKeys: async (makeRequest) => {
        return makeRequest(authDict);
    },
});
```

The [`authUploadDeviceSigningKeys`](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto_api.BootstrapCrossSigningOpts.html#authUploadDeviceSigningKeys)
callback is required in order to upload newly-generated public cross-signing keys to the server.

### Key backup

If the user doesn't already have a [key backup](https://spec.matrix.org/v1.12/client-server-api/#server-side-key-backups) you should create one:

```javascript
// Check if we have a key backup.
// If checkKeyBackupAndEnable returns null, there is no key backup.
const hasKeyBackup = (await matrixClient.getCrypto().checkKeyBackupAndEnable()) !== null;

// Create the key backup
await matrixClient.getCrypto().resetKeyBackup();
```

### Verify a new device

Once the cross-signing is set up on one of your devices, you can verify another device with two methods:

1. Use `CryptoApi.bootstrapCrossSigning`.

    `bootstrapCrossSigning` will call the [CryptoCallbacks.getSecretStorageKey](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto_api.CryptoCallbacks.html#getSecretStorageKey) callback. The device is verified with the private cross-signing keys fetched from the secret storage.

2. Request an interactive verification against existing devices, by calling [CryptoApi.requestOwnUserVerification](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto_api.CryptoApi.html#requestOwnUserVerification).

### Migrating from the legacy crypto stack to Rust crypto

If your application previously used the legacy crypto stack, (i.e, it called `MatrixClient.initLegacyCrypto()`), you will
need to migrate existing devices to the Rust crypto stack.

This migration happens automatically when you call `initRustCrypto()` instead of `initLegacyCrypto()`,
but you need to provide the legacy [`cryptoStore`](https://matrix-org.github.io/matrix-js-sdk/interfaces/matrix.ICreateClientOpts.html#cryptoStore) and [`pickleKey`](https://matrix-org.github.io/matrix-js-sdk/interfaces/matrix.ICreateClientOpts.html#pickleKey) to [`createClient`](https://matrix-org.github.io/matrix-js-sdk/functions/matrix.createClient.html):

```javascript
// You should provide the legacy crypto store and the pickle key to the matrix client in order to migrate the data.
const matrixClient = sdk.createClient({
    cryptoStore: myCryptoStore,
    pickleKey: myPickleKey,
    baseUrl: "https://matrix.test",
    accessToken: myAccessToken,
    userId: myUserId,
});

// The migration will be done automatically when you call `initRustCrypto`.
await matrixClient.initRustCrypto();
```

To follow the migration progress, you can listen to the [`CryptoEvent.LegacyCryptoStoreMigrationProgress`](https://matrix-org.github.io/matrix-js-sdk/enums/crypto_api.CryptoEvent.html#LegacyCryptoStoreMigrationProgress) event:

```javascript
// When progress === total === -1, the migration is finished.
matrixClient.on(CryptoEvent.LegacyCryptoStoreMigrationProgress, (progress, total) => {
    ...
});
```

The Rust crypto stack is not supported in a lot of deprecated methods of [`MatrixClient`](https://matrix-org.github.io/matrix-js-sdk/classes/matrix.MatrixClient.html). If you use them, you should migrate to the [`CryptoApi`](https://matrix-org.github.io/matrix-js-sdk/interfaces/crypto_api.CryptoApi.html). Also, the legacy `MatrixClient.crypto` object is not available any more: you should use `MatrixClient.getCrypto()` instead.

## Contributing

_This section is for people who want to modify the SDK. If you just
want to use this SDK, skip this section._

First, you need to pull in the right build tools:

```
 $ pnpm install
```

### Building

To build a browser version from scratch when developing:

```
 $ pnpm build
```

To run tests:

```
 $ pnpm test
```

To run linting:

```
 $ pnpm lint
```
