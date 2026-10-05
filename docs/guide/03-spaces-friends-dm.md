# 03 · 空间层级 + 好友 + 直聊

本 fork 相对 upstream 的主要增量集中在三个 Manager 上：`SpaceManager`、`FriendManager`、`DirectMessageManager`。

> ⚠️ **这三个都是异步扩展 Manager**，`createClient()` 之后必须 `await client.whenManagerExtensionsReady()` 才能调用，否则 `getFriendManager` 等方法还不存在。

---

## 三个 Manager 的结构

它们都是**门面 + 子管理器**的组合模式：门面上的方法都是 `@deprecated` 的转发壳，**新代码应直接走子管理器**。

```text
client.getSpaceManager()             client.getFriendManager()          client.getDirectMessageManager()
  .lifecycle   CRUD + 状态             .requests  好友请求的发送/应答        .list      查询 + 缓存
  .query       公共空间/搜索/统计/缓存   .list      好友列表/搜索/分组/DM     .creation  创建 DM + 写 m.direct
  .child       子房间增删与查询          .blocks    状态与屏蔽                .operation 离开/已读/发送
  .member      成员（邀请/加入/离开）
  .hierarchy   层级（hierarchy/summary/tree path）
```

`m.direct` 是**用户级 account data**，不是房间级状态——这是直聊相关 API 行为的根源（同一用户在不同房间上的 DM 映射是全局的）。

---

## 完整示例

```typescript title="03-spaces-friends-dm.ts"
/**
 * 03-spaces-friends-dm.ts —— 空间层级 / 好友 / 直聊
 *
 * 运行：
 *   MATRIX_HOMESERVER=https://matrix.test \
 *   MATRIX_USER=alice MATRIX_PASSWORD=alice-secret \
 *   MATRIX_FRIEND_ID='@bob:matrix.test' \
 *   npx tsx 03-spaces-friends-dm.ts
 */
import {
    ClientEvent,
    createClient,
    RoomType,
    type MatrixClient,
    SdkError,
    SyncState,
    Visibility,
} from "@langkebo/matrix-js-sdk";

const HOMESERVER = process.env.MATRIX_HOMESERVER ?? "https://matrix.test";
const USER = process.env.MATRIX_USER ?? "alice";
const PASSWORD = process.env.MATRIX_PASSWORD ?? "alice-secret";
const FRIEND_ID = process.env.MATRIX_FRIEND_ID ?? "@bob:matrix.test";

/** 1) 登录（同 01，用 login() 让凭据就地生效）。 */
async function connect(): Promise<MatrixClient> {
    const token = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    const deviceId = process.env.MATRIX_DEVICE_ID;

    if (token && userId && deviceId) {
        return createClient({ baseUrl: HOMESERVER, accessToken: token, userId, deviceId });
    }

    const bootstrap = createClient({ baseUrl: HOMESERVER });
    const res = await bootstrap.loginRequest({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: USER },
        password: PASSWORD,
        initial_device_display_name: "quickstart-03",
    });
    return createClient({
        baseUrl: HOMESERVER,
        accessToken: res.access_token,
        userId: res.user_id,
        deviceId: res.device_id,
    });
}

/**
 * 2) 关键一步：等待异步扩展 manager 挂载。
 *    不等待的话，下面的 getSpaceManager() / getFriendManager() / getDirectMessageManager()
 *    在冷启动时会直接是 undefined。
 */
async function ready(client: MatrixClient): Promise<MatrixClient> {
    await client.whenManagerExtensionsReady();
    // 挂载完成后，再等首个 sync，房间与 account_data 才可读。
    await new Promise<void>((resolve) => {
        const onSync = (state: SyncState): void => {
            if (state === SyncState.Prepared) {
                client.off(ClientEvent.Sync, onSync);
                resolve();
            }
        };
        client.on(ClientEvent.Sync, onSync);
        void client.startClient({ initialSyncLimit: 20 });
    });
    return client;
}

/** 3) 空间层级：建 space 房间 → 注册为 Space → 建子房间 → 挂到 Space 下 → 读层级。 */
async function demoSpaces(client: MatrixClient): Promise<void> {
    const spaceManager = client.getSpaceManager();

    // 3.1 先创建一个 type=m.space 的房间。Space 必须基于一个真实房间。
    //     注意 visibility 在 createRoom 里是枚举 Visibility，不是字符串字面量。
    const spaceRoom = await client.createRoom({
        name: "工程团队",
        visibility: Visibility.Private,
        creation_content: { type: RoomType.Space },
    });
    console.log(`[space] 房间已创建 ${spaceRoom.room_id}`);

    // 3.2 把它注册为 Space。注意 CreateSpaceOptions.room_id 是必填。
    //     而这里的 visibility 是字符串联合 "public" | "private" —— 与上面不同。
    const space = await spaceManager.lifecycle.createSpace({
        room_id: spaceRoom.room_id,
        name: "工程团队",
        topic: "团队空间",
        visibility: "private",
    });
    console.log(`[space] space_id=${space.space_id}`);

    // 3.3 建两个普通房间作为子房间
    const general = await client.createRoom({ name: "general", visibility: Visibility.Private });
    const backend = await client.createRoom({ name: "backend", visibility: Visibility.Private });

    // 3.4 挂到 Space 下。via_servers 缺省时 SDK 自动填 []。
    await spaceManager.child.addChild(space.space_id, { room_id: general.room_id, order: "10" });
    await spaceManager.child.addChild(space.space_id, { room_id: backend.room_id, order: "20" });
    console.log("[space] 已挂载 2 个子房间");

    // 3.5 读层级：space + children + members
    const hierarchy = await spaceManager.hierarchy.getSpaceHierarchy(space.space_id);
    console.log(
        `[space] hierarchy: space=${hierarchy.space.name ?? "-"} ` +
            `children=${hierarchy.children.length} members=${hierarchy.members.length}`,
    );

    // 3.6 查询我加入的所有 Space
    const mine = await spaceManager.query.getUserSpaces();
    console.log(`[space] 我已加入 ${mine.length} 个 Space`);

    // 3.7 反向查询：某个房间属于哪些 Space
    const parents = await spaceManager.query.getRoomParentSpaces(general.room_id);
    console.log(`[space] ${general.room_id} 的父 Space: ${parents.map((s) => s.space_id).join(", ") || "无"}`);
}

/** 4) 好友：发起请求 → 处理请求 → 好友列表 → 好友专属 DM。 */
async function demoFriends(client: MatrixClient): Promise<void> {
    const friendManager = client.getFriendManager();

    // 4.1 能力探测：后端未实现好友能力时返回 false，应先判空再调用。
    if (!(await friendManager.list.isSupported())) {
        console.log("[friend] 后端未启用好友能力，跳过");
        return;
    }

    // 4.2 发起好友请求
    const sent = await friendManager.requests.sendFriendRequest(FRIEND_ID, "来自 quickstart 的问候");
    console.log(`[friend] 请求已发出 request_id=${sent.request_id ?? "-"} status=${sent.status ?? "-"}`);

    // 4.3 查看收件箱 / 发件箱
    const incoming = await friendManager.requests.getIncomingRequests();
    const outgoing = await friendManager.requests.getOutgoingRequests();
    console.log(`[friend] 待处理=${incoming.length} 已发出=${outgoing.length}`);

    // 4.4 接受来自 FRIEND_ID 的请求（如果对方也发了）
    const fromFriend = incoming.find((r) => r.user_id === FRIEND_ID);
    if (fromFriend) {
        const accepted = await friendManager.requests.acceptFriendRequest(FRIEND_ID);
        console.log(`[friend] 已接受，room_id=${accepted.room_id ?? "-"}`);
    }

    // 4.5 好友列表
    const friends = await friendManager.list.getFriends();
    console.log(`[friend] 共 ${friends.length} 位好友`);

    // 4.6 好友专属 DM 房间（不存在则创建）
    const dm = await friendManager.list.createFriendDm(FRIEND_ID);
    console.log(`[friend] 好友 DM 房间=${dm.room_id}`);
}

/** 5) 直聊：创建 DM → 发送 → 查询映射。 */
async function demoDm(client: MatrixClient): Promise<void> {
    const dmManager = client.getDirectMessageManager();

    // 5.1 创建 DM 房间并写入 m.direct。isEncrypted 让新房间默认开启加密。
    const roomId = await dmManager.creation.createDm({
        userIds: [FRIEND_ID],
        isEncrypted: true,
        name: "与 bob 的私聊",
    });
    console.log(`[dm] DM 房间已创建 ${roomId}`);

    // 5.2 发消息
    const eventId = await dmManager.operation.sendDmMessage(roomId, "hi bob，这是 quickstart 发来的私聊消息");
    console.log(`[dm] 已发送 event_id=${eventId}`);

    // 5.3 反向查询：某用户在哪个 DM 房间
    const forUser = await dmManager.list.getDmForUser(FRIEND_ID);
    console.log(`[dm] ${FRIEND_ID} 的 DM 房间=${forUser ?? "无"}`);

    // 5.4 列出全部 DM 房间
    const rooms = await dmManager.list.getDMRooms();
    console.log(`[dm] 共 ${rooms.length} 个 DM 房间`);

    // 5.5 检查某个房间是不是 DM，以及对方是谁
    console.log(`[dm] ${roomId} isDm=${await dmManager.list.checkRoomIsDm(roomId)}`);

    // 5.6 标记已读
    await dmManager.operation.markDmAsRead(roomId);
}

async function main(): Promise<void> {
    const client = await ready(await connect());
    console.log(`[ready] manager 已挂载，userId=${client.getUserId()}`);

    await demoSpaces(client);
    await demoFriends(client);
    await demoDm(client);

    client.stopClient();
}

main().catch((err: unknown) => {
    if (err instanceof SdkError) {
        console.error(`[fatal] ${err.name} code=${err.errorCode} status=${err.statusCode} msg=${err.message}`);
    } else {
        console.error("[fatal]", err);
    }
    process.exit(1);
});
```

### 预期输出

```text
[ready] manager 已挂载，userId=@alice:matrix.test
[space] 房间已创建 !aBcDeF:matrix.test
[space] space_id=sPqRsT:matrix.test
[space] 已挂载 2 个子房间
[space] hierarchy: space=工程团队 children=2 members=1
[space] 我已加入 1 个 Space
[space] !gHiJkL:matrix.test 的父 Space: sPqRsT:matrix.test
[friend] 请求已发出 request_id=req_7f3a status=pending
[friend] 待处理=1 已发出=1
[friend] 已接受，room_id=!mNoPqR:matrix.test
[friend] 共 1 位好友
[friend] 好友 DM 房间=!mNoPqR:matrix.test
[dm] DM 房间已创建 !xYzAbC:matrix.test
[dm] 已发送 event_id=$Q9wErTy
[dm] @bob:matrix.test 的 DM 房间=!xYzAbC:matrix.test
[dm] 共 1 个 DM 房间
[dm] !xYzAbC:matrix.test isDm=true
```

`space_id` 与 `room_id` 是不同标识：`CreateSpaceOptions.room_id` 是底层的 Matrix 房间，`Space.space_id` 是后端 Space 实体 ID。**`child.addChild` / `hierarchy.getSpaceHierarchy` 接收的是 `space_id`。**

### 失败时的输出

后端未实现好友能力：

```text
[friend] 后端未启用好友能力，跳过
```

权限不足（非管理员或不满足 join rule）：

```text
[fatal] ApiError code=M_FORBIDDEN status=403 msg=...
```

---

## 子管理器职责速查

### `SpaceManager`

| 子管理器    | 常用方法                                                                                                                                                                         |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lifecycle` | `createSpace(opts)`、`getSpace(id)`、`updateSpace(id, opts)`、`deleteSpace(id)`                                                                                                  |
| `query`     | `getUserSpaces(forceRefresh?)`、`getPublicSpaces(opts)`、`searchSpaces(q, limit)`、`getRoomParentSpaces(roomId)`、`isSpace(roomId)`、`getSpaceStatistics()`、`getSpaceStats(id)` |
| `child`     | `addChild(spaceId, { room_id, via_servers?, order?, suggested? })`、`removeChild(spaceId, roomId)`、`getSpaceChildren(spaceId)`、`getSpaceRooms(spaceId)`                        |
| `member`    | `getSpaceMembers(spaceId)`、`inviteToSpace(spaceId, userId)`、`joinSpace(spaceId)`、`leaveSpace(spaceId)`                                                                        |
| `hierarchy` | `getSpaceHierarchy(spaceId, forceRefresh?)`、`getSpaceHierarchyPage(spaceId, opts)`、`getSpaceSummary(spaceId)`、`getSpaceTreePath(spaceId)`                                     |

门面层另有一个不在任何子管理器里的方法：`getRoomStateEventsRaw(roomId)`（走标准 `/rooms/{roomId}/state`，返回原始 state 事件数组）。

### `FriendManager`

| 子管理器   | 常用方法                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requests` | `isSupported()`、`sendFriendRequest(userId, reason?)`、`addFriend(userId, opts?)`、`acceptFriendRequest(userId)`、`rejectFriendRequest(userId)`、`cancelFriendRequest(userId)`、`getIncomingRequests()`、`getOutgoingRequests()`                                                                                                                                                                                                                            |
| `list`     | `getFriends()`、`ensureFriendListRoom()`、`getFriendSuggestions(limit)`、`searchUsers(q, mode?, limit?)`、`searchFriendsAdvanced(query)`、`checkFriendship(userId)`、`createFriendship(userId)`、`removeFriend(userId)`、`setFriendDisplayName(userId, name)`、`updateFriendNote(userId, note)`、`getFriendGroups()` / `createFriendGroup(name)` / `addToFriendGroup(gid, uid)` / `getFriendsInGroup(gid)`、`getFriendDm(userId)`、`createFriendDm(userId)` |
| `blocks`   | `getFriendStatusInfo(userId)`、`getFriendStatus(userId)`、`updateFriendStatus(userId, status)`                                                                                                                                                                                                                                                                                                                                                              |

另有若干同步缓存读取器（不发请求）：`getCachedFriends()`、`getFriendCount()`、`hasCachedFriend(userId)`、`getFriendListRoomId()`、`getCacheStats()`、`clearCache()`。

### `DirectMessageManager`

| 子管理器    | 常用方法                                                                                                                                                                                                                                                                                |
| :---------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`      | `getDMRooms()`、`getDmForUser(userId)`、`getDmRoomInfo(roomId)`、`getDmRoomInfos()`、`checkRoomIsDm(roomId)`、`getDmPartner(roomId)`、`getDmRoomsByUserIds(userIds)`、`getRoomDm(roomId)`、`getDirectRoomsFromServer()`、`getDmPartnerFromServer(roomId)`、`isDmRoomFromServer(roomId)` |
| `creation`  | `createDm(options \| userIds[])`、`createDmRoom(userId, opts?)`、`createDmRoomDetailed(userId, opts?)`、`updateDirectRoom(roomId, userIds \| opts)`、`setDmRoom(roomId, userId)`、`removeDmRoom(roomId, userId)`                                                                        |
| `operation` | `sendDmMessage(roomId, content)`、`markDmAsRead(roomId)`、`leaveDm(roomId)`                                                                                                                                                                                                             |

同步缓存读取器：`getDirectRoomsByUserSync()`、`getCachedDmRooms()`、`getCachedDmForUser(userId)`、`getCacheStats()`。

---

## 常见陷阱

1. **`createClient()` 后立刻调 `getFriendManager()`。** 冷启动时是 `undefined`，症状是 `TypeError: client.getFriendManager is not a function`。必须先 `await client.whenManagerExtensionsReady()`。
2. **把 `space_id` 和 `room_id` 混用。** `createSpace` 收 `room_id`，`addChild` / `getSpaceHierarchy` 收 `space_id`。
3. **`CreateSpaceOptions.room_id` 是必填。** 少了它直接抛 `ValidationError: Space room_id is required`。
4. **`isSupported()` 不判空就调好友接口。** 后端未实现好友路由时所有调用都会 404。
5. **以为 `m.direct` 是房间级数据。** 它是**用户级** account data；`getDmForUser` 查的是你自己的映射，不是房间属性。
6. **`sendFriendRequest` 与 `addFriend` 混用。** `sendFriendRequest` 是单向请求（需要对方接受），`addFriend` 是直接建立好友关系（后端视作双向写入）。
7. **`visibility` 有两个不同的类型。** `client.createRoom({ visibility })` 收的是枚举 `Visibility.Private`；`spaceManager.lifecycle.createSpace({ visibility })` 收的是字符串 `"private"`。传错的那个编译期就会失败：

    ```typescript
    await client.createRoom({ visibility: Visibility.Private }); // ✅ 枚举
    await client.createRoom({ visibility: "private" }); // ❌ 类型错误：Visibility 是枚举
    await spaceManager.lifecycle.createSpace({ room_id, visibility: "private" }); // ✅ 字符串
    await spaceManager.lifecycle.createSpace({ room_id, visibility: Visibility.Private }); // ❌ 类型错误
    ```

8. **`acceptFriendRequest(userId)` 后没重新拉列表。** 各 Manager 有 LRU 缓存（`clearCache()` 可清）；收到 `FriendEvent.Accepted` 等事件后建议以事件驱动刷新，而不是轮询。
9. **忽略 `@deprecated` 的门面方法。** 门面上的 `spaceManager.getSpaceHierarchy()` 等仍然可用，但它们只是转发；新代码用 `spaceManager.hierarchy.getSpaceHierarchy()`，避免未来被移除。

---

## 收尾

- 需要错误分类与重试策略：见 [SDK 错误处理与重试指南](./04-error-handling.md)
- 需要加密：见 [02 · 端到端加密初始化](02-e2ee.md)，`createDm({ isEncrypted: true })` 只是设置房间的初始加密状态，仍需先完成 `initRustCrypto`
- 需要与后端路由契约对齐：见 `docs/api-contract/`（本 SDK 的路径/方法由契约 codegen 生成，改后端路由需重新跑 `pnpm contract:sync && pnpm contract:codegen`）
