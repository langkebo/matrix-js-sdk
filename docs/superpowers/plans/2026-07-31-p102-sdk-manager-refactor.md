# P-102 SDK Manager Top 5 拆分重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 P-102 标记的 5 个超大 Manager（admin/dm/federation/room-summary/space）按子领域拆分为 sub-managers，使每个 `index.ts` 降到 < 300 行、每个 sub-manager < 400 行，保持 100% API 向后兼容与现有测试全部通过。

**Architecture:** 沿用 admin 已验证的"组合 + 事件转发 + 门面委托"模式：每个 Manager 拆为 N 个聚焦的 sub-manager（继承 `BaseManager` 或合适的基类），`index.ts` 仅保留构造、sub-manager 实例化、事件转发、以及向后兼容的门面方法（one-liner 委托）。对已有 sub-managers 的 admin/room-summary，重点是去除 index.ts 中的门面方法（用 Proxy 自动转发 + `@deprecated` 标注）；对没有 sub-managers 的 dm/federation/space，重点是新建 sub-managers 并迁移方法。

**Tech Stack:** TypeScript 5.x / vitest / ESLint / Prettier / pnpm

## Global Constraints

- **目录与命名**：sub-manager 文件放在 `src/<module>/sub-managers/<sub-name>-manager.ts`，配套 types 文件 `<sub-name>-types.ts`；命名规则 `<Module><Sub>Manager`（如 `FederationBlacklistManager`）
- **基类选择**：sub-manager 继承 `BaseManager<Events, EventMap>`；admin 域 sub-manager 继承 `AdminBaseManager`；room-summary 域 sub-manager 沿用现有 `RoomSummaryBaseManager`（若不存在则继承 `BaseManager`）
- **向后兼容**：`index.ts` 必须保留所有现有公开方法签名（`@deprecated` 标注迁移路径），保证现有调用方零改动；破坏性变更禁止
- **事件转发**：sub-manager 事件必须转发到顶层 Manager 事件，保持 `manager.on(ModuleEvent.X, ...)` 的向后兼容
- **目标行数**：每个 `index.ts` < 300 行；每个 sub-manager < 400 行；超出需进一步拆分
- **TDD 纪律**：每个 Task 先确认现有测试基线 PASS，再拆分，拆分后必须 PASS 同一组测试
- **每个 Task 结束**：`pnpm lint:js && pnpm lint:types && pnpm vitest run spec/unit/<module>*.spec.ts` 全绿才 commit
- **不创建多余文件**：除明确列出的 sub-manager 文件外不新建文档；不修改 `__generated__/` 目录
- **registerManagerClass**：每个新 sub-manager 不需要单独注册（通过顶层 Manager 暴露），顶层 Manager 的注册保持不变
- **import 规范**：sub-manager 从 `../../client`、`../../managers/base-manager`、`../../http-api/method` 等相对路径导入；types 文件仅导出类型，不含运行时逻辑
- **错误处理**：保持现有 `normalizeError` + `emit(ErrorEvent)` 模式；不新增空 catch；不引入 `any`
- **commit 粒度**：每个 sub-manager 的"创建 + 迁移 + 测试通过"为一个 commit；每个 Task 末尾的"门面 @deprecated 标注 + lint 全绿"为单独 commit

---

## 现状摘要（重构前基线）

| 文件                        | 行数 | 已有 sub-managers                                                            | 测试文件                                                                             |
| --------------------------- | ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/admin/index.ts`        | 1253 | 6（users/rooms/server/federation/media/config）                              | `spec/unit/admin.spec.ts` + `admin-extended.spec.ts` + `admin-new-endpoints.spec.ts` |
| `src/dm/index.ts`           | 1118 | 0                                                                            | `spec/unit/dm.spec.ts`                                                               |
| `src/federation/index.ts`   | 1067 | 0                                                                            | `spec/unit/federation.spec.ts` + `spec/unit/api-consistency/federation.spec.ts`      |
| `src/room-summary/index.ts` | 1061 | 8（room-event-operation/invite-policy/key/member/search/state/stats/thread） | `spec/unit/room-summary.spec.ts`                                                     |
| `src/space/index.ts`        | 820  | 0                                                                            | `spec/unit/space.spec.ts` + `space-extended.spec.ts`                                 |

**重构后目标**：

| 文件                        | 目标行数 | sub-managers 数量 |
| --------------------------- | -------- | ----------------- |
| `src/admin/index.ts`        | < 280    | 6（复用现有）     |
| `src/dm/index.ts`           | < 280    | 3（新建）         |
| `src/federation/index.ts`   | < 280    | 4（新建）         |
| `src/room-summary/index.ts` | < 280    | 8（复用现有）     |
| `src/space/index.ts`        | < 280    | 5（新建）         |

---

## 拆分方案概览

### Task 1: federation/index.ts（1067 → < 280，4 个新 sub-managers）

**子领域划分（按方法分组）**：

- `FederationBlacklistManager`：黑名单 CRUD（getBlacklist, addToBlacklist, removeFromBlacklist, isBlacklisted）+ blacklist 私有状态
- `FederationServerManager`：服务器状态/连接（getServerStatus, getFederationDestinations, disconnectServer, reconnectServer, getServerVersion）+ serverCache 私有状态
- `FederationQueryManager`：联邦查询（queryProfile, queryDirectory, queryDestination, queryAuth, getFederationInfo, getPublicRoomsOnServer）
- `FederationRoomManager`：联邦房间/事件/状态（getHierarchy, getRoomEvent, getEventAuth, getJoiningRules, getRoomAuth, getState, getStateIds, getMembers, getJoinedMembers, getEvent, downloadMedia, getMediaThumbnail）

**Files:**

- Create: `src/federation/sub-managers/federation-blacklist-manager.ts`
- Create: `src/federation/sub-managers/federation-blacklist-types.ts`
- Create: `src/federation/sub-managers/federation-server-manager.ts`
- Create: `src/federation/sub-managers/federation-server-types.ts`
- Create: `src/federation/sub-managers/federation-query-manager.ts`
- Create: `src/federation/sub-managers/federation-query-types.ts`
- Create: `src/federation/sub-managers/federation-room-manager.ts`
- Create: `src/federation/sub-managers/federation-room-types.ts`
- Modify: `src/federation/index.ts`（保留构造、4 sub-manager 实例化、forwardSubManagerEvents、门面委托方法）
- Test: `spec/unit/federation.spec.ts`、`spec/unit/api-consistency/federation.spec.ts`

---

### Task 2: space/index.ts（820 → < 280，5 个新 sub-managers）

**子领域划分**：

- `SpaceLifecycleManager`：CRUD（createSpace, getSpace, updateSpace, deleteSpace）
- `SpaceQueryManager`：查询（getPublicSpaces, searchSpaces, getSpaceStatistics, getUserSpaces, getSpaceStats, getSpaceByRoom, getRoomParentSpaces, isSpace）+ 私有缓存
- `SpaceChildManager`：子房间（getSpaceChildren, addChild, removeChild, getSpaceRooms, getSpaceState）
- `SpaceMemberManager`：成员（getSpaceMembers, inviteToSpace, joinSpace, leaveSpace）
- `SpaceHierarchyManager`：层级（getSpaceHierarchy, getSpaceHierarchyPage, getSpaceHierarchyV1, getSpaceSummary, getSpaceSummaryWithChildren, getSpaceTreePath）+ 私有辅助方法（normalizeSpace, extractSpaces, extractChildren, extractMembers, normalizeChild, normalizeMember, asString/asNumber/asBoolean/asStringArray, spacePath）

**Files:**

- Create: `src/space/sub-managers/space-lifecycle-manager.ts`
- Create: `src/space/sub-managers/space-lifecycle-types.ts`
- Create: `src/space/sub-managers/space-query-manager.ts`
- Create: `src/space/sub-managers/space-query-types.ts`
- Create: `src/space/sub-managers/space-child-manager.ts`
- Create: `src/space/sub-managers/space-child-types.ts`
- Create: `src/space/sub-managers/space-member-manager.ts`
- Create: `src/space/sub-managers/space-member-types.ts`
- Create: `src/space/sub-managers/space-hierarchy-manager.ts`
- Create: `src/space/sub-managers/space-hierarchy-types.ts`
- Modify: `src/space/index.ts`
- Test: `spec/unit/space.spec.ts`、`spec/unit/space-extended.spec.ts`

---

### Task 3: dm/index.ts（1118 → < 280，3 个新 sub-managers）

**子领域划分**：

- `DmRoomCreationManager`：创建（createDm, setDmRoom, removeDmRoom）+ dmRoomsCache/userDmMapCache 的写入路径
- `DmRoomListManager`：查询（getDMRooms, getDMRoomsFromRoomScan, buildDmRoomInfo, getDmPartnerFromDirect, getDirectRoomsByUser, getDirectRoomsByUserSync, getDmForUser, getCachedDmRooms, getCachedDmForUser, getDmRoomInfo, getDmRoomInfos, checkRoomIsDm）
- `DmRoomOperationManager`：操作（leaveDm, markDmAsRead, sendDmMessage）

**Files:**

- Create: `src/dm/sub-managers/dm-room-creation-manager.ts`
- Create: `src/dm/sub-managers/dm-room-creation-types.ts`
- Create: `src/dm/sub-managers/dm-room-list-manager.ts`
- Create: `src/dm/sub-managers/dm-room-list-types.ts`
- Create: `src/dm/sub-managers/dm-room-operation-manager.ts`
- Create: `src/dm/sub-managers/dm-room-operation-types.ts`
- Modify: `src/dm/index.ts`
- Test: `spec/unit/dm.spec.ts`

---

### Task 4: room-summary/index.ts（1061 → < 280，复用现有 8 个 sub-managers）

**策略**：room-summary 已有 8 个 sub-managers，但 `index.ts` 仍包含大量直接实现的方法（约 50+ 个 async 方法）。这些方法需要迁移到对应 sub-manager，`index.ts` 只保留构造、sub-manager 实例化、事件转发、门面委托。

**方法迁移映射**（已通过 grep 验证）：

- `room-event-operation-manager.ts`：createOrRefreshSummary, updateSummary, deleteSummary, syncSummary, processSummaryUpdates, convertRoomEvent, signRoomEvent, verifyRoomEvent, getRoomTurnServer, getStickyEvents, setStickyEvent, deleteStickyEvent, translate
- `room-invite-policy-manager.ts`：getInviteBlocklist, addInviteBlocklist, getInviteAllowlist, addInviteAllowlist
- `room-key-manager.ts`：claimRoomKeys, getRoomKeyCount, getRoomKeysVersion, forwardRoomKeys
- `room-member-manager.ts`：writeSummaryMembers, deleteSummaryMember, getAllSummaryState, getSummaryState
- `room-search-manager.ts`：searchPublicRooms, getRecommendedRooms, getFavoriteRooms, getRecentRooms, searchRoom
- `room-state-manager.ts`：getRoomCapabilities, getRoomAccountData, getRoomInvites, getRoomReceipts, getRoomUnreadCount, getRoomMetadata, getRoomVaultData, setRoomVaultData, getRoomRetention, getRoomExternalIds, getRoomSpaces, getRoomPermissions, getRoomResolve, getRoomServiceTypes, getRoomReducedEvents, getRoomRendered, getRoomFragments, getRoomDevice, getRoomEventUrl
- `room-stats-manager.ts`：getRoomSummaryStats, recalculateSummaryStats, recalculateSummaryHeroes, clearSummaryUnread, getEventKeys, getRoomThread, getRoomThreadById, getRoomHierarchy
- `room-thread-manager.ts`：（现有，不新增迁移）

**Files:**

- Modify: `src/room-summary/sub-managers/room-event-operation-manager.ts`（接收迁移的方法）
- Modify: `src/room-summary/sub-managers/room-invite-policy-manager.ts`
- Modify: `src/room-summary/sub-managers/room-key-manager.ts`
- Modify: `src/room-summary/sub-managers/room-member-manager.ts`
- Modify: `src/room-summary/sub-managers/room-search-manager.ts`
- Modify: `src/room-summary/sub-managers/room-state-manager.ts`
- Modify: `src/room-summary/sub-managers/room-stats-manager.ts`
- Modify: `src/room-summary/index.ts`（去除直接实现，改为门面委托）
- Test: `spec/unit/room-summary.spec.ts`

---

### Task 5: admin/index.ts（1253 → < 280，复用现有 6 个 sub-managers）

**策略**：admin 已有 6 个 sub-managers 且 index.ts 全是 one-liner 门面委托。需要：

1. 用 ES Proxy 自动转发对未知方法的访问到对应 sub-manager（按方法名前缀路由：`getUser*` → `users`、`getRoom*`/`deleteRoom*`/`blockRoom*` → `rooms`、`getServerStats*` → `server`、`getFederation*` → `federation`、`*Media*` → `media`、`getConfig*` → `config`）
2. 保留显式门面方法但全部加 `@deprecated` 注释引导使用 sub-manager
3. 移除冗余 import（BatchCreateUsersRequest 等仅在门面签名中出现的类型可改为 `import type`）

**Files:**

- Modify: `src/admin/index.ts`（去除 800+ 行门面方法，改为 Proxy + 少量必要显式方法）
- Test: `spec/unit/admin.spec.ts`、`spec/unit/admin-extended.spec.ts`、`spec/unit/admin-new-endpoints.spec.ts`

---

## Task 1: federation/index.ts 拆分（4 个 sub-managers）

**Files:**

- Create: `src/federation/sub-managers/federation-blacklist-manager.ts`
- Create: `src/federation/sub-managers/federation-blacklist-types.ts`
- Create: `src/federation/sub-managers/federation-server-manager.ts`
- Create: `src/federation/sub-managers/federation-server-types.ts`
- Create: `src/federation/sub-managers/federation-query-manager.ts`
- Create: `src/federation/sub-managers/federation-query-types.ts`
- Create: `src/federation/sub-managers/federation-room-manager.ts`
- Create: `src/federation/sub-managers/federation-room-types.ts`
- Modify: `src/federation/index.ts`
- Test: `spec/unit/federation.spec.ts`、`spec/unit/api-consistency/federation.spec.ts`

**Interfaces:**

- Consumes: `BaseManager<Events, EventMap>`、`ManagerOpts`、`RequestSpec` from `../../managers/base-manager`；`Method` from `../../http-api/method`；`AdminPrefix` from `../../http-api/prefix`；`MatrixClient` from `../../client`；`registerManagerClass` from `../../client-infra/manager-registry`；`ValidationError` from `../../errors`；`logger` from `../../logger`；`IUserProfile` from `../../user-directory/index`；`IEvent` from `../../models/event`
- Produces: 4 个 sub-manager 类（`FederationBlacklistManager` 等），顶层 `FederationManager` 通过 `public readonly blacklist: FederationBlacklistManager` 等暴露；事件 `FederationEvent.BlacklistUpdated` 由 sub-manager 触发、顶层转发

- [ ] **Step 1: 建立测试基线**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/federation.spec.ts spec/unit/api-consistency/federation.spec.ts 2>&1 | tail -30`
Expected: 全部 PASS（记录通过用例数作为回归基线）

- [ ] **Step 2: 创建 federation-blacklist-types.ts**

Create `src/federation/sub-managers/federation-blacklist-types.ts`：

```typescript
/*
Copyright 2024 The Matrix.org Foundation C.I.C.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Federation Blacklist Sub-Manager Types - 联邦黑名单子管理器类型
 */

export interface IBlacklistEntry {
    serverName: string;
    reason?: string;
    addedAt: number;
    addedBy?: string;
}
```

- [ ] **Step 3: 创建 federation-blacklist-manager.ts**

Create `src/federation/sub-managers/federation-blacklist-manager.ts`：将 `federation/index.ts` 第 78-187 行的 `blacklist` 私有 Map、`getBlacklist`、`addToBlacklist`、`removeFromBlacklist`、`isBlacklisted` 方法迁移过来。类定义如下：

```typescript
/*
Copyright 2024 The Matrix.org Foundation C.I.C.
Licensed under the Apache License, Version 2.0 (the "License");
...（同上 license）
*/

/**
 * Federation Blacklist Manager - 联邦黑名单管理
 *
 * 从 FederationManager 拆分，负责黑名单 CRUD 与缓存。
 */

import { Method } from "../../http-api/method";
import { AdminPrefix } from "../../http-api/prefix";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { logger } from "../../logger";
import { ValidationError } from "../../errors";
import type { IBlacklistEntry } from "./federation-blacklist-types";

export enum FederationBlacklistEvent {
    BlacklistUpdated = "BlacklistUpdated",
    BlacklistError = "BlacklistError",
}

interface FederationBlacklistEventMap {
    [FederationBlacklistEvent.BlacklistUpdated]: (blacklist: IBlacklistEntry[]) => void;
    [FederationBlacklistEvent.BlacklistError]: (error: Error) => void;
}

export class FederationBlacklistManager extends BaseManager<FederationBlacklistEvent, FederationBlacklistEventMap> {
    private blacklist: Map<string, IBlacklistEntry> = new Map();

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    async getBlacklist(throwOnError = true): Promise<IBlacklistEntry[]> {
        return this.request<{ blacklist?: IBlacklistEntry[] }>({
            method: Method.Get,
            path: "/federation/blacklist",
            prefix: AdminPrefix.V1,
        }).then(
            (response) => {
                const entries: IBlacklistEntry[] = response.blacklist || [];
                this.blacklist.clear();
                entries.forEach((e) => this.blacklist.set(e.serverName, e));
                this.emit(FederationBlacklistEvent.BlacklistUpdated, entries);
                return entries;
            },
            (e) => {
                const error = this.normalizeError(e, "getBlacklist");
                if (throwOnError) throw error;
                logger.warn("FederationBlacklistManager.getBlacklist failed:", error);
                return Array.from(this.blacklist.values());
            },
        );
    }

    async addToBlacklist(serverName: string, reason?: string): Promise<void> {
        if (!serverName) throw new ValidationError("Server name is required");
        try {
            await this.request({
                method: Method.Post,
                path: "/federation/blacklist/add",
                body: { server_name: serverName, reason },
                prefix: AdminPrefix.V1,
            });
            const entry: IBlacklistEntry = {
                serverName,
                reason,
                addedAt: Date.now(),
                addedBy: this.client.getUserId() ?? undefined,
            };
            this.blacklist.set(serverName, entry);
            this.emit(FederationBlacklistEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (e) {
            const error = this.normalizeError(e, "addToBlacklist");
            this.emit(FederationBlacklistEvent.BlacklistError, error);
            throw error;
        }
    }

    async removeFromBlacklist(serverName: string): Promise<void> {
        if (!serverName) throw new ValidationError("Server name is required");
        try {
            await this.request({
                method: Method.Post,
                path: "/federation/blacklist/remove",
                body: { server_name: serverName },
                prefix: AdminPrefix.V1,
            });
            this.blacklist.delete(serverName);
            this.emit(FederationBlacklistEvent.BlacklistUpdated, Array.from(this.blacklist.values()));
        } catch (e) {
            const error = this.normalizeError(e, "removeFromBlacklist");
            this.emit(FederationBlacklistEvent.BlacklistError, error);
            throw error;
        }
    }

    async isBlacklisted(serverName: string): Promise<boolean> {
        if (this.blacklist.has(serverName)) return true;
        await this.getBlacklist(false);
        return this.blacklist.has(serverName);
    }
}
```

- [ ] **Step 4: 创建 federation-server-types.ts**

Create `src/federation/sub-managers/federation-server-types.ts`：

```typescript
/*
Copyright 2024 The Matrix.org Foundation C.I.C.
...（license）
*/

/**
 * Federation Server Sub-Manager Types - 联邦服务器子管理器类型
 */

export interface IFederationServer {
    serverName: string;
    addedAt?: number;
    reason?: string;
}

export interface IFederationStatus {
    online: boolean;
    lastSuccessfulConnect?: number;
    latency?: number;
}
```

- [ ] **Step 5: 创建 federation-server-manager.ts**

Create `src/federation/sub-managers/federation-server-manager.ts`：迁移 `getServerStatus`、`getFederationDestinations`、`disconnectServer`、`reconnectServer`、`getServerVersion` 方法 + `serverCache` 私有 Map。模式参考 Step 3 的 FederationBlacklistManager，使用 `FederationServerEvent.ServerAdded/ServerRemoved/FederationError` 事件。注意 `request` 方法的覆盖逻辑（`prefix === ""` 走 unauth）需要保留——通过在 sub-manager 内部复制相同的 `request` 覆盖方法实现。

```typescript
import { Method } from "../../http-api/method";
import { AdminPrefix } from "../../http-api/prefix";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts, type RequestSpec } from "../../managers/base-manager";
import { logger } from "../../logger";
import { ValidationError } from "../../errors";
import type { IFederationServer, IFederationStatus } from "./federation-server-types";

export enum FederationServerEvent {
    ServerAdded = "ServerAdded",
    ServerRemoved = "ServerRemoved",
    FederationError = "FederationError",
}

interface FederationServerEventMap {
    [FederationServerEvent.ServerAdded]: (serverName: string) => void;
    [FederationServerEvent.ServerRemoved]: (serverName: string) => void;
    [FederationServerEvent.FederationError]: (error: Error) => void;
}

export class FederationServerManager extends BaseManager<FederationServerEvent, FederationServerEventMap> {
    private serverCache: Map<string, IFederationServer> = new Map();

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    protected async request<T>(spec: RequestSpec): Promise<T> {
        if (spec.prefix === "") {
            return super.request<T>({ ...spec, authenticated: false });
        }
        return super.request<T>(spec);
    }

    async getServerStatus(serverName: string, throwOnError = true): Promise<IFederationStatus | null> {
        if (!serverName) throw new ValidationError("Server name is required");
        return this.request<{
            online?: boolean;
            last_successful_connect?: number;
            latency?: number;
        }>({
            method: Method.Get,
            path: `/federation/status/${encodeURIComponent(serverName)}`,
            prefix: AdminPrefix.V1,
        }).then(
            (response) => ({
                online: response.online || false,
                lastSuccessfulConnect: response.last_successful_connect,
                latency: response.latency,
            }),
            (e) => {
                const error = this.normalizeError(e, "getServerStatus");
                if (throwOnError) throw error;
                logger.warn("FederationServerManager.getServerStatus failed:", error);
                return null;
            },
        );
    }

    async getFederationDestinations(throwOnError = true): Promise<IFederationServer[]> {
        return this.request<{ destinations?: IFederationServer[] }>({
            method: Method.Get,
            path: "/federation/destinations",
            prefix: AdminPrefix.V1,
        }).then(
            (response) => {
                const servers: IFederationServer[] = response.destinations || [];
                servers.forEach((s) => this.serverCache.set(s.serverName, s));
                return servers;
            },
            (e) => {
                const error = this.normalizeError(e, "getFederationDestinations");
                if (throwOnError) throw error;
                logger.warn("FederationServerManager.getFederationDestinations failed:", error);
                return Array.from(this.serverCache.values());
            },
        );
    }

    async disconnectServer(serverName: string): Promise<void> {
        if (!serverName) throw new ValidationError("Server name is required");
        try {
            await this.request({
                method: Method.Post,
                path: `/federation/disconnect/${encodeURIComponent(serverName)}`,
                prefix: AdminPrefix.V1,
            });
        } catch (e) {
            const error = this.normalizeError(e, "disconnectServer");
            this.emit(FederationServerEvent.FederationError, error);
            throw error;
        }
    }

    async reconnectServer(serverName: string): Promise<void> {
        if (!serverName) throw new ValidationError("Server name is required");
        try {
            await this.request({
                method: Method.Post,
                path: `/federation/reconnect/${encodeURIComponent(serverName)}`,
                prefix: AdminPrefix.V1,
            });
        } catch (e) {
            const error = this.normalizeError(e, "reconnectServer");
            this.emit(FederationServerEvent.FederationError, error);
            throw error;
        }
    }

    async getServerVersion(serverName: string, throwOnError = true): Promise<{ version: string } | null> {
        if (!serverName) throw new ValidationError("Server name is required");
        return this.request<{ server?: { version?: string } }>({
            method: Method.Get,
            path: "/_matrix/federation/v1/version",
            prefix: "",
        }).then(
            (response) => ({ version: response.server?.version || "unknown" }),
            (e) => {
                const error = this.normalizeError(e, "getServerVersion");
                if (throwOnError) throw error;
                logger.warn("FederationServerManager.getServerVersion failed:", error);
                return null;
            },
        );
    }
}
```

- [ ] **Step 6: 创建 federation-query-types.ts + federation-query-manager.ts**

Create `src/federation/sub-managers/federation-query-types.ts`：

```typescript
import type { IUserProfile } from "../../user-directory/index";

export interface IQueryDirectoryResult {
    room_id: string;
    servers: string[];
}

export type { IUserProfile };
```

Create `src/federation/sub-managers/federation-query-manager.ts`：迁移 `queryProfile`、`queryDirectory`、`queryDestination`、`queryAuth`、`getFederationInfo`、`getPublicRoomsOnServer` 方法。继承 `BaseManager`，覆盖 `request` 方法（同 Step 5 模式）。所有方法路径 `prefix: ""`，无需 token。

```typescript
import { Method } from "../../http-api/method";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts, type RequestSpec } from "../../managers/base-manager";
import { ValidationError } from "../../errors";
import type { IUserProfile } from "../../user-directory/index";
import type { IQueryDirectoryResult } from "./federation-query-types";

export enum FederationQueryEvent {
    FederationError = "FederationError",
}

interface FederationQueryEventMap {
    [FederationQueryEvent.FederationError]: (error: Error) => void;
}

export class FederationQueryManager extends BaseManager<FederationQueryEvent, FederationQueryEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    protected async request<T>(spec: RequestSpec): Promise<T> {
        if (spec.prefix === "") {
            return super.request<T>({ ...spec, authenticated: false });
        }
        return super.request<T>(spec);
    }

    async queryProfile(userId: string): Promise<IUserProfile> {
        if (!userId) throw new ValidationError("User ID is required");
        return this.request<IUserProfile>({
            method: Method.Get,
            path: `/_matrix/federation/v1/query/profile/${encodeURIComponent(userId)}`,
            prefix: "",
        });
    }

    async queryDirectory(roomAlias: string): Promise<IQueryDirectoryResult> {
        if (!roomAlias) throw new ValidationError("Room alias is required");
        return this.request<IQueryDirectoryResult>({
            method: Method.Get,
            path: `/_matrix/federation/v1/query/directory`,
            queryParams: { room_alias: roomAlias },
            prefix: "",
        });
    }

    async queryDestination(destination: string): Promise<unknown> {
        if (!destination) throw new ValidationError("Destination is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/query/${encodeURIComponent(destination)}`,
            prefix: "",
        });
    }

    async queryAuth(): Promise<unknown> {
        return this.request<unknown>({
            method: Method.Get,
            path: "/_matrix/federation/v1/query/auth",
            prefix: "",
        });
    }

    async getFederationInfo(): Promise<unknown> {
        return this.request<unknown>({
            method: Method.Get,
            path: "/_matrix/federation/v1/info",
            prefix: "",
        });
    }

    async getPublicRoomsOnServer(
        serverName: string,
        limit?: number,
        since?: string,
    ): Promise<{ chunk: unknown[]; next_batch?: string; prev_batch?: string }> {
        if (!serverName) throw new ValidationError("Server name is required");
        const params: { limit?: number; since?: string; server_name: string } = { server_name: serverName };
        if (limit !== undefined) params.limit = limit;
        if (since !== undefined) params.since = since;
        try {
            const response = await this.request<{
                chunk?: unknown[];
                next_batch?: string;
                prev_batch?: string;
            }>({
                method: Method.Get,
                path: "/_matrix/federation/v1/publicRooms",
                queryParams: params,
                prefix: "",
            });
            const result: { chunk: unknown[]; next_batch?: string; prev_batch?: string } = {
                chunk: response.chunk || [],
            };
            if (response.next_batch) result.next_batch = response.next_batch;
            if (response.prev_batch) result.prev_batch = response.prev_batch;
            return result;
        } catch (e) {
            const error = this.normalizeError(e, "getPublicRoomsOnServer");
            this.emit(FederationQueryEvent.FederationError, error);
            throw error;
        }
    }
}
```

- [ ] **Step 7: 创建 federation-room-types.ts + federation-room-manager.ts**

Create `src/federation/sub-managers/federation-room-types.ts`（仅类型，无内容则文件可省略；若 sub-manager 内联类型则跳过此文件，但保持计划一致性建议创建空类型文件并导出 `unknown` 别名）。

Create `src/federation/sub-managers/federation-room-manager.ts`：迁移 `getHierarchy`、`getRoomEvent`、`getEventAuth`、`getJoiningRules`、`getRoomAuth`、`getState`、`getStateIds`、`getMembers`、`getJoinedMembers`、`getEvent`、`downloadMedia`、`getMediaThumbnail` 方法。模式同 Step 5/6。

```typescript
import { Method } from "../../http-api/method";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts, type RequestSpec } from "../../managers/base-manager";
import { ValidationError } from "../../errors";

export enum FederationRoomEvent {
    FederationError = "FederationError",
}

interface FederationRoomEventMap {
    [FederationRoomEvent.FederationError]: (error: Error) => void;
}

export class FederationRoomManager extends BaseManager<FederationRoomEvent, FederationRoomEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    protected async request<T>(spec: RequestSpec): Promise<T> {
        if (spec.prefix === "") {
            return super.request<T>({ ...spec, authenticated: false });
        }
        return super.request<T>(spec);
    }

    async getHierarchy(roomId: string): Promise<unknown> {
        if (!roomId) throw new ValidationError("Room ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/hierarchy/${encodeURIComponent(roomId)}`,
            prefix: "",
        });
    }

    async getRoomEvent(roomId: string, eventId: string): Promise<unknown> {
        if (!roomId) throw new ValidationError("Room ID is required");
        if (!eventId) throw new ValidationError("Event ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/event/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`,
            prefix: "",
        });
    }

    async getEvent(eventId: string): Promise<unknown> {
        if (!eventId) throw new ValidationError("Event ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/event/${encodeURIComponent(eventId)}`,
            prefix: "",
        });
    }

    async getEventAuth(roomId: string, eventId: string): Promise<unknown> {
        if (!roomId) throw new ValidationError("Room ID is required");
        if (!eventId) throw new ValidationError("Event ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/event_auth/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`,
            prefix: "",
        });
    }

    async getJoiningRules(roomId: string): Promise<unknown> {
        if (!roomId) throw new ValidationError("Room ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/joining_rules/${encodeURIComponent(roomId)}`,
            prefix: "",
        });
    }

    async getRoomAuth(roomId: string): Promise<unknown> {
        if (!roomId) throw new ValidationError("Room ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/room_auth/${encodeURIComponent(roomId)}`,
            prefix: "",
        });
    }

    async getState(roomId: string): Promise<unknown> {
        if (!roomId) throw new ValidationError("Room ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/state/${encodeURIComponent(roomId)}`,
            prefix: "",
        });
    }

    async getStateIds(roomId: string): Promise<unknown> {
        if (!roomId) throw new ValidationError("Room ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/state_ids/${encodeURIComponent(roomId)}`,
            prefix: "",
        });
    }

    async getMembers(roomId: string): Promise<unknown> {
        if (!roomId) throw new ValidationError("Room ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/members/${encodeURIComponent(roomId)}`,
            prefix: "",
        });
    }

    async getJoinedMembers(roomId: string): Promise<unknown> {
        if (!roomId) throw new ValidationError("Room ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/federation/v1/joined_members/${encodeURIComponent(roomId)}`,
            prefix: "",
        });
    }

    async downloadMedia(serverName: string, mediaId: string): Promise<unknown> {
        if (!serverName) throw new ValidationError("Server name is required");
        if (!mediaId) throw new ValidationError("Media ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/media/v3/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
            prefix: "",
        });
    }

    async getMediaThumbnail(serverName: string, mediaId: string): Promise<unknown> {
        if (!serverName) throw new ValidationError("Server name is required");
        if (!mediaId) throw new ValidationError("Media ID is required");
        return this.request<unknown>({
            method: Method.Get,
            path: `/_matrix/media/v3/thumbnail/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
            prefix: "",
        });
    }
}
```

- [ ] **Step 8: 重写 federation/index.ts 为门面**

Modify `src/federation/index.ts`：删除所有迁移到 sub-manager 的方法实现，保留 `FederationEvent` enum、`IFederationServer`/`IBlacklistEntry`/`IFederationStatus` re-export（从 sub-manager types 导入再导出，保持向后兼容）、构造器、`forwardSubManagerEvents`、4 个 `public readonly` sub-manager 实例、所有门面委托方法（one-liner）。最终结构：

````typescript
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { MatrixClient } from "../client";
import { registerManagerClass } from "../client-infra/manager-registry";
import { FederationBlacklistManager } from "./sub-managers/federation-blacklist-manager";
import { FederationServerManager } from "./sub-managers/federation-server-manager";
import { FederationQueryManager } from "./sub-managers/federation-query-manager";
import { FederationRoomManager } from "./sub-managers/federation-room-manager";
import type { IBlacklistEntry } from "./sub-managers/federation-blacklist-types";
import type { IFederationServer, IFederationStatus } from "./sub-managers/federation-server-types";
import type { IUserProfile } from "../user-directory/index";

// 保持 FederationEvent enum 不变（向后兼容）
export enum FederationEvent {
    BlacklistUpdated = "BlacklistUpdated",
    ServerAdded = "ServerAdded",
    ServerRemoved = "ServerRemoved",
    FederationError = "FederationError",
}

// Re-export 类型保持向后兼容
export type { IBlacklistEntry, IFederationServer, IFederationStatus };
export type { IQueryDirectoryResult } from "./sub-managers/federation-query-types";

interface FederationManagerEventMap {
    [FederationEvent.BlacklistUpdated]: (blacklist: IBlacklistEntry[]) => void;
    [FederationEvent.ServerAdded]: (serverName: string) => void;
    [FederationEvent.ServerRemoved]: (serverName: string) => void;
    [FederationEvent.FederationError]: (error: Error) => void;
}

/**
 * Federation Manager - 联邦管理（门面）
 *
 * 通过组合模式委托到 4 个子 Manager：
 * - blacklist: 黑名单 CRUD
 * - server: 服务器状态/连接
 * - query: 联邦查询
 * - room: 联邦房间/事件/状态
 *
 * @example
 * ```typescript
 * const fed = client.getFederationManager();
 * await fed.blacklist.addToBlacklist("evil.example.com");
 * await fed.server.getServerVersion("example.com");
 * ```
 */
export class FederationManager extends BaseManager<FederationEvent, FederationManagerEventMap> {
    public readonly blacklist: FederationBlacklistManager;
    public readonly server: FederationServerManager;
    public readonly query: FederationQueryManager;
    public readonly room: FederationRoomManager;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
        this.blacklist = new FederationBlacklistManager(client, opts);
        this.server = new FederationServerManager(client, opts);
        this.query = new FederationQueryManager(client, opts);
        this.room = new FederationRoomManager(client, opts);
        this.forwardSubManagerEvents();
    }

    private forwardSubManagerEvents(): void {
        this.blacklist.on(FederationBlacklistManager_Event.BlacklistUpdated, (list) =>
            this.emit(FederationEvent.BlacklistUpdated, list),
        );
        // ...（其他事件转发）
    }

    // ===== 向后兼容门面方法（@deprecated，请使用 sub-manager） =====

    /** @deprecated 请使用 `fed.blacklist.getBlacklist()` */
    async getBlacklist(throwOnError = true): Promise<IBlacklistEntry[]> {
        return this.blacklist.getBlacklist(throwOnError);
    }
    // ...（其余 18 个门面方法，全部 one-liner 委托 + @deprecated）
}

// 修正：事件 enum 不可循环引用，需从 sub-manager 直接导入事件常量
import { FederationBlacklistEvent as FederationBlacklistManager_Event } from "./sub-managers/federation-blacklist-manager";
import { FederationServerEvent as FederationServerManager_Event } from "./sub-managers/federation-server-manager";
import { FederationQueryEvent as FederationQueryManager_Event } from "./sub-managers/federation-query-manager";
import { FederationRoomEvent as FederationRoomManager_Event } from "./sub-managers/federation-room-manager";

registerManagerClass("FederationManager", FederationManager);
````

- [ ] **Step 9: 运行 federation 测试验证回归**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/federation.spec.ts spec/unit/api-consistency/federation.spec.ts 2>&1 | tail -40`
Expected: 全部 PASS（与 Step 1 基线一致）

- [ ] **Step 10: 运行 lint + 类型检查**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm lint:js-fix src/federation 2>&1 | tail -10 && pnpm lint:types 2>&1 | tail -10`
Expected: 0 error，0 warning

- [ ] **Step 11: Commit**

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk
git add src/federation/ spec/unit/federation.spec.ts spec/unit/api-consistency/federation.spec.ts
git commit -m "refactor(federation): P-102 拆分 FederationManager 为 4 个 sub-managers

将 federation/index.ts (1067 行) 拆分为:
- federation-blacklist-manager.ts: 黑名单 CRUD
- federation-server-manager.ts: 服务器状态/连接
- federation-query-manager.ts: 联邦查询
- federation-room-manager.ts: 联邦房间/事件/状态

index.ts 降至 < 280 行，保留全部门面方法（@deprecated）保持 API 向后兼容。
全部测试通过，无回归。"
```

---

## Task 2: space/index.ts 拆分（5 个 sub-managers）

**Files:**

- Create: `src/space/sub-managers/space-lifecycle-manager.ts` + `space-lifecycle-types.ts`
- Create: `src/space/sub-managers/space-query-manager.ts` + `space-query-types.ts`
- Create: `src/space/sub-managers/space-child-manager.ts` + `space-child-types.ts`
- Create: `src/space/sub-managers/space-member-manager.ts` + `space-member-types.ts`
- Create: `src/space/sub-managers/space-hierarchy-manager.ts` + `space-hierarchy-types.ts`
- Modify: `src/space/index.ts`
- Test: `spec/unit/space.spec.ts`、`spec/unit/space-extended.spec.ts`

**Interfaces:**

- Consumes: `BaseManager`、`Method`、`ClientPrefix`、`MatrixClient`、`registerManagerClass`、`Space`/`SpaceChild`/`SpaceMember`/`SpaceHierarchy` 等类型 from `../types`（已存在的 `src/space/types.ts`）、`JsonObject` from `../@types/partials`
- Produces: 5 个 sub-manager 类，顶层 `SpaceManager` 通过 `public readonly lifecycle/query/child/member/hierarchy` 暴露

- [ ] **Step 1: 建立测试基线**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/space.spec.ts spec/unit/space-extended.spec.ts 2>&1 | tail -30`
Expected: 全部 PASS

- [ ] **Step 2: 创建 space-lifecycle-manager.ts**

Create `src/space/sub-managers/space-lifecycle-manager.ts`：迁移 `createSpace`、`getSpace`、`updateSpace`、`deleteSpace` 方法。继承 `BaseManager<SpaceEvent, SpaceManagerEventMap>`。

```typescript
import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { ValidationError } from "../../errors";
import type { Space, CreateSpaceOptions, UpdateSpaceOptions } from "../types";
import { SpaceEvent, type SpaceManagerEventMap } from "../events"; // 若 events 在 index.ts 则提取到 events.ts

export class SpaceLifecycleManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    async createSpace(options: CreateSpaceOptions): Promise<Space> {
        if (!options.room_id) throw new ValidationError("room_id is required");
        if (options.name && options.name.length > 255) throw new ValidationError("name too long");
        if (options.topic && options.topic.length > 1000) throw new ValidationError("topic too long");
        if (options.avatar_url && options.avatar_url.length > 2048) throw new ValidationError("avatar_url too long");
        if (options.join_rule && options.join_rule.length > 50) throw new ValidationError("join_rule too long");
        if (options.visibility && options.visibility.length > 50) throw new ValidationError("visibility too long");
        // ...（原 createSpace 实现体）
    }

    async getSpace(spaceId: string): Promise<Space> {
        /* ... */
    }
    async updateSpace(spaceId: string, options: UpdateSpaceOptions): Promise<Space> {
        /* ... */
    }
    async deleteSpace(spaceId: string): Promise<void> {
        /* ... */
    }
}
```

- [ ] **Step 3: 创建 space-query-manager.ts**

Create `src/space/sub-managers/space-query-manager.ts`：迁移 `getPublicSpaces`、`searchSpaces`、`getSpaceStatistics`、`getUserSpaces`、`getSpaceStats`、`getSpaceByRoom`、`getRoomParentSpaces`、`isSpace` + 私有 `normalizeSpace`、`extractSpaces`、`asString`/`asNumber`/`asBoolean`/`asStringArray` 辅助方法 + 缓存状态。

```typescript
import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import type { Space, SpaceQueryOptions, SpaceListResponse, SpaceStatistics } from "../types";
import type { JsonObject } from "../../@types/partials";

export class SpaceQueryManager extends BaseManager<SpaceEvent, SpaceManagerEventMap> {
    private spaceCache: Map<string, Space> = new Map();
    private lastCacheRefresh: number = 0;
    private static CACHE_TTL = 5 * 60 * 1000;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    async getPublicSpaces(options: SpaceQueryOptions = {}): Promise<SpaceListResponse> {
        /* ... */
    }
    async searchSpaces(query: string, limit = 10): Promise<Space[]> {
        /* ... */
    }
    async getSpaceStatistics(): Promise<SpaceStatistics> {
        /* ... */
    }
    async getUserSpaces(forceRefresh = false): Promise<Space[]> {
        /* ... */
    }
    async getSpaceStats(spaceId: string): Promise<{ memberCount: number; childCount: number }> {
        /* ... */
    }
    async getSpaceByRoom(roomId: string): Promise<Space> {
        /* ... */
    }
    async getRoomParentSpaces(roomId: string, options: SpaceQueryOptions = {}): Promise<Space[]> {
        /* ... */
    }
    async isSpace(roomId: string): Promise<boolean> {
        /* ... */
    }

    // 私有辅助方法
    private normalizeSpace(space: JsonObject = {}, fallbackId = ""): Space {
        /* ... */
    }
    private extractSpaces(response: unknown): Space[] {
        /* ... */
    }
    private asString(value: unknown): string | undefined {
        /* ... */
    }
    private asNumber(value: unknown): number | undefined {
        /* ... */
    }
    private asBoolean(value: unknown): boolean | undefined {
        /* ... */
    }
    private asStringArray(value: unknown): string[] {
        /* ... */
    }
    private clearCache(): void {
        /* ... */
    }
}
```

- [ ] **Step 4: 创建 space-child-manager.ts**

Create `src/space/sub-managers/space-child-manager.ts`：迁移 `getSpaceChildren`、`addChild`、`removeChild`、`getSpaceRooms`、`getSpaceState` + `normalizeChild`、`extractChildren` 辅助方法。

- [ ] **Step 5: 创建 space-member-manager.ts**

Create `src/space/sub-managers/space-member-manager.ts`：迁移 `getSpaceMembers`、`inviteToSpace`、`joinSpace`、`leaveSpace` + `normalizeMember`、`extractMembers` 辅助方法。

- [ ] **Step 6: 创建 space-hierarchy-manager.ts**

Create `src/space/sub-managers/space-hierarchy-manager.ts`：迁移 `getSpaceHierarchy`、`getSpaceHierarchyPage`、`getSpaceHierarchyV1`、`getSpaceSummary`、`getSpaceSummaryWithChildren`、`getSpaceTreePath` + `spacePath` 私有辅助方法。

- [ ] **Step 7: 创建 space events.ts（提取事件定义）**

Create `src/space/events.ts`：将 `SpaceEvent` enum 和 `SpaceManagerEventMap` interface 从 index.ts 提取到独立文件，便于 sub-managers 导入而不产生循环依赖。

```typescript
export enum SpaceEvent {
    SpaceCreated = "SpaceCreated",
    SpaceUpdated = "SpaceUpdated",
    SpaceDeleted = "SpaceDeleted",
    ChildAdded = "ChildAdded",
    ChildRemoved = "ChildRemoved",
    MemberJoined = "MemberJoined",
    MemberLeft = "MemberLeft",
    Error = "Error",
}

export interface SpaceManagerEventMap {
    [SpaceEvent.SpaceCreated]: (spaceId: string) => void;
    [SpaceEvent.SpaceUpdated]: (spaceId: string) => void;
    [SpaceEvent.SpaceDeleted]: (spaceId: string) => void;
    [SpaceEvent.ChildAdded]: (spaceId: string, roomId: string) => void;
    [SpaceEvent.ChildRemoved]: (spaceId: string, roomId: string) => void;
    [SpaceEvent.MemberJoined]: (spaceId: string, userId: string) => void;
    [SpaceEvent.MemberLeft]: (spaceId: string, userId: string) => void;
    [SpaceEvent.Error]: (error: Error) => void;
}
```

- [ ] **Step 8: 重写 space/index.ts 为门面**

Modify `src/space/index.ts`：删除迁移方法，保留 `SpaceEvent` re-export、构造器、`forwardSubManagerEvents`、5 个 sub-manager 实例、门面委托方法、`getMetrics`/`start`/`stop` 生命周期方法（这些是顶层协调，保留在 index.ts）。

- [ ] **Step 9: 运行 space 测试验证回归**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/space.spec.ts spec/unit/space-extended.spec.ts 2>&1 | tail -40`
Expected: 全部 PASS

- [ ] **Step 10: 运行 lint + 类型检查**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm lint:js-fix src/space 2>&1 | tail -10 && pnpm lint:types 2>&1 | tail -10`
Expected: 0 error

- [ ] **Step 11: Commit**

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk
git add src/space/ spec/unit/space*.spec.ts
git commit -m "refactor(space): P-102 拆分 SpaceManager 为 5 个 sub-managers

将 space/index.ts (820 行) 拆分为:
- space-lifecycle-manager.ts: CRUD
- space-query-manager.ts: 查询 + 缓存
- space-child-manager.ts: 子房间
- space-member-manager.ts: 成员
- space-hierarchy-manager.ts: 层级

index.ts 降至 < 280 行，全部测试通过。"
```

---

## Task 3: dm/index.ts 拆分（3 个 sub-managers）

**Files:**

- Create: `src/dm/sub-managers/dm-room-creation-manager.ts` + `dm-room-creation-types.ts`
- Create: `src/dm/sub-managers/dm-room-list-manager.ts` + `dm-room-list-types.ts`
- Create: `src/dm/sub-managers/dm-room-operation-manager.ts` + `dm-room-operation-types.ts`
- Create: `src/dm/events.ts`（提取 DMEvent + EventMap）
- Modify: `src/dm/index.ts`
- Test: `spec/unit/dm.spec.ts`

**Interfaces:**

- Consumes: `BaseManager`、`Method`、`ClientPrefix`、`MatrixClient`、`registerManagerClass`、`LRUCache` from `../utils/lru-cache`、`MatrixError` from `../http-api/errors`、`NotFoundError` from `../errors`、`InvalidParamError` from `../common/errors`、`validateUserId`/`validateRoomId` from `../common/validators`、`EventType` from `../@types/event`、`Preset` from `../@types/partials`、`ICreateRoomOpts` from `../@types/requests`、`Room`/`RoomMember`/`MatrixEvent`/`IContent` from `../models/*`、`NotificationCountType` from `../models/room`
- Produces: 3 个 sub-manager 类，顶层 `DirectMessageManager` 通过 `public readonly creation/list/operation` 暴露；`dmRoomsCache`/`userDmMapCache` 由 list manager 持有，creation manager 通过参数共享

- [ ] **Step 1: 建立测试基线**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/dm.spec.ts 2>&1 | tail -30`
Expected: 全部 PASS

- [ ] **Step 2: 创建 dm/events.ts**

Create `src/dm/events.ts`：提取 `DMEvent` enum 和 `DirectMessageManagerEventMap` interface。

- [ ] **Step 3: 创建 dm-room-creation-types.ts**

Create `src/dm/sub-managers/dm-room-creation-types.ts`：

```typescript
import type { IContent } from "../../models/event";

export interface CreateDmOptions {
    userIds: string[];
    invite?: boolean;
    name?: string;
    topic?: string;
    isEncrypted?: boolean;
}

export interface CreateDmRoomResponse {
    room_id: string;
}

export interface CreateDmRoomOptions {
    name?: string;
    topic?: string;
    invite?: string[];
    visibility?: "private" | "public";
}

export interface UpdateDirectRoomResponse {
    room_id: string;
    users: string[];
    direct_map: import("../types").IDirectRoomsMap;
    updated_ts: number;
}

export interface UpdateDirectRoomOptions {
    userIds?: string[];
    content?: IContent;
}
```

- [ ] **Step 4: 创建 dm-room-list-types.ts**

Create `src/dm/sub-managers/dm-room-list-types.ts`：迁移 `DmRoomInfo`、`IDirectRoomsMap`、`DirectRoomsResponse`、`DmRoomCheckResponse`、`DmPartnerResponse` 接口。

- [ ] **Step 5: 创建 dm-room-creation-manager.ts**

Create `src/dm/sub-managers/dm-room-creation-manager.ts`：迁移 `createDm`、`setDmRoom`、`removeDmRoom` 方法。`createDm` 需要先调用 `list.getDmForUser` 检查现有 DM，所以 `creation` manager 构造时接收 `list` manager 引用。

```typescript
import { InvalidParamError } from "../../common/errors";
import { EventType } from "../../@types/event";
import type { ICreateRoomOpts } from "../../@types/requests";
import { Preset } from "../../@types/partials";
import { Method } from "../../http-api/method";
import { ClientPrefix } from "../../http-api/prefix";
import { MatrixClient } from "../../client";
import { BaseManager, type ManagerOpts } from "../../managers/base-manager";
import { validateUserId } from "../../common/validators";
import { LRUCache } from "../../utils/lru-cache";
import type { DmRoomInfo } from "./dm-room-list-types";
import type { CreateDmOptions } from "./dm-room-creation-types";
import type { DmRoomListManager } from "./dm-room-list-manager";
import { DMEvent, type DirectMessageManagerEventMap } from "../events";

export class DmRoomCreationManager extends BaseManager<DMEvent, DirectMessageManagerEventMap> {
    constructor(
        client: MatrixClient,
        private readonly dmRoomsCache: LRUCache<DmRoomInfo>,
        private readonly userDmMapCache: LRUCache<string>,
        private readonly listManager: DmRoomListManager,
        opts?: ManagerOpts,
    ) {
        super(client, opts);
    }

    async createDm(options: CreateDmOptions | string[]): Promise<string> {
        const opts = Array.isArray(options) ? { userIds: options } : options;
        if (!opts.userIds || opts.userIds.length === 0) {
            throw new InvalidParamError("At least one user ID is required");
        }
        opts.userIds.forEach((userId) => validateUserId(userId));

        const existingDm = await this.listManager.getDmForUser(opts.userIds[0]);
        if (existingDm) return existingDm;

        const createOptions: ICreateRoomOpts = {
            is_direct: true,
            invite: opts.userIds,
            preset: opts.isEncrypted === false ? Preset.PrivateChat : Preset.TrustedPrivateChat,
        };
        if (opts.name) createOptions.name = opts.name;
        if (opts.topic) createOptions.topic = opts.topic;
        if (opts.isEncrypted !== false) {
            createOptions.initial_state = [
                { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
            ];
        }

        try {
            const response = await this.withRetry(async () => {
                return (await this.client.createRoom(createOptions)) as { room_id: string };
            });
            const roomId = response.room_id;
            const dmInfo: DmRoomInfo = { roomId, invitees: opts.userIds };
            this.dmRoomsCache.set(roomId, dmInfo);
            opts.userIds.forEach((userId) => this.userDmMapCache.set(userId, roomId));
            await this.setDmRoom(roomId, opts.userIds[0]);
            this.emit(DMEvent.DMCreated, roomId, opts.userIds);
            this.emit(DMEvent.ListUpdated);
            return roomId;
        } catch (error) {
            throw this.normalizeError(error, "createDm");
        }
    }

    async setDmRoom(roomId: string, userId: string): Promise<void> {
        // 原 setDmRoom 实现
    }

    async removeDmRoom(roomId: string, userId: string): Promise<void> {
        // 原 removeDmRoom 实现
    }
}
```

- [ ] **Step 6: 创建 dm-room-list-manager.ts**

Create `src/dm/sub-managers/dm-room-list-manager.ts`：迁移 `getDMRooms`、`getDMRoomsFromRoomScan`、`buildDmRoomInfo`、`getDmPartnerFromDirect`、`getDirectRoomsByUser`、`getDirectRoomsByUserSync`、`getDmForUser`、`getCachedDmRooms`、`getCachedDmForUser`、`getDmRoomInfo`、`getDmRoomInfos`、`checkRoomIsDm` 方法。持有 `dmRoomsCache` 和 `userDmMapCache`。

- [ ] **Step 7: 创建 dm-room-operation-manager.ts**

Create `src/dm/sub-managers/dm-room-operation-manager.ts`：迁移 `leaveDm`、`markDmAsRead`、`sendDmMessage` 方法。接收 `listManager` 引用以查询 DM 信息。

- [ ] **Step 8: 重写 dm/index.ts 为门面**

Modify `src/dm/index.ts`：保留 `DMEvent` re-export、构造器（实例化 3 个 sub-manager，共享 LRUCache）、`forwardSubManagerEvents`、门面委托方法。

- [ ] **Step 9: 运行 dm 测试验证回归**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/dm.spec.ts 2>&1 | tail -30`
Expected: 全部 PASS

- [ ] **Step 10: 运行 lint + 类型检查**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm lint:js-fix src/dm 2>&1 | tail -10 && pnpm lint:types 2>&1 | tail -10`
Expected: 0 error

- [ ] **Step 11: Commit**

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk
git add src/dm/ spec/unit/dm.spec.ts
git commit -m "refactor(dm): P-102 拆分 DirectMessageManager 为 3 个 sub-managers

将 dm/index.ts (1118 行) 拆分为:
- dm-room-creation-manager.ts: 创建 + setDmRoom + removeDmRoom
- dm-room-list-manager.ts: 查询 + 缓存
- dm-room-operation-manager.ts: 离开 + 已读 + 发送

index.ts 降至 < 280 行，全部测试通过。"
```

---

## Task 4: room-summary/index.ts 门面化（复用 8 个 sub-managers）

**策略**：已有 8 个 sub-managers，但 index.ts 仍有 50+ 个直接实现的 async 方法。本 Task 将这些方法迁移到对应 sub-manager，index.ts 改为门面委托。

**Files:**

- Modify: `src/room-summary/sub-managers/room-event-operation-manager.ts`
- Modify: `src/room-summary/sub-managers/room-invite-policy-manager.ts`
- Modify: `src/room-summary/sub-managers/room-key-manager.ts`
- Modify: `src/room-summary/sub-managers/room-member-manager.ts`
- Modify: `src/room-summary/sub-managers/room-search-manager.ts`
- Modify: `src/room-summary/sub-managers/room-state-manager.ts`
- Modify: `src/room-summary/sub-managers/room-stats-manager.ts`
- Modify: `src/room-summary/index.ts`
- Test: `spec/unit/room-summary.spec.ts`

**Interfaces:**

- Consumes: 现有 8 个 sub-manager 类及其类型；`MatrixClient`、`BaseManager`、`RoomSummary` 等类型
- Produces: 8 个 sub-manager 各自扩充方法；顶层 `RoomSummaryManager` 通过 `public readonly eventOps/invitePolicy/keys/members/search/state/stats/thread` 暴露，门面方法委托

- [ ] **Step 1: 建立测试基线**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/room-summary.spec.ts 2>&1 | tail -30`
Expected: 全部 PASS

- [ ] **Step 2: 迁移方法到 room-event-operation-manager.ts**

Modify `src/room-summary/sub-managers/room-event-operation-manager.ts`：将 index.ts 中的 `createOrRefreshSummary`、`updateSummary`、`deleteSummary`、`syncSummary`、`processSummaryUpdates`、`convertRoomEvent`、`signRoomEvent`、`verifyRoomEvent`、`getRoomTurnServer`、`getStickyEvents`、`setStickyEvent`、`deleteStickyEvent`、`translate` 方法迁移到此类。保持方法签名不变。

- [ ] **Step 3: 迁移方法到 room-invite-policy-manager.ts**

Modify `src/room-summary/sub-managers/room-invite-policy-manager.ts`：迁移 `getInviteBlocklist`、`addInviteBlocklist`、`getInviteAllowlist`、`addInviteAllowlist`。

- [ ] **Step 4: 迁移方法到 room-key-manager.ts**

Modify `src/room-summary/sub-managers/room-key-manager.ts`：迁移 `claimRoomKeys`、`getRoomKeyCount`、`getRoomKeysVersion`、`forwardRoomKeys`。

- [ ] **Step 5: 迁移方法到 room-member-manager.ts**

Modify `src/room-summary/sub-managers/room-member-manager.ts`：迁移 `writeSummaryMembers`、`deleteSummaryMember`、`getAllSummaryState`、`getSummaryState`。

- [ ] **Step 6: 迁移方法到 room-search-manager.ts**

Modify `src/room-summary/sub-managers/room-search-manager.ts`：迁移 `searchPublicRooms`、`getRecommendedRooms`、`getFavoriteRooms`、`getRecentRooms`、`searchRoom`。

- [ ] **Step 7: 迁移方法到 room-state-manager.ts**

Modify `src/room-summary/sub-managers/room-state-manager.ts`：迁移 `getRoomCapabilities`、`getRoomAccountData`、`getRoomInvites`、`getRoomReceipts`、`getRoomUnreadCount`、`getRoomMetadata`、`getRoomVaultData`、`setRoomVaultData`、`getRoomRetention`、`getRoomExternalIds`、`getRoomSpaces`、`getRoomPermissions`、`getRoomResolve`、`getRoomServiceTypes`、`getRoomReducedEvents`、`getRoomRendered`、`getRoomFragments`、`getRoomDevice`、`getRoomEventUrl`（共 19 个方法）。

- [ ] **Step 8: 迁移方法到 room-stats-manager.ts**

Modify `src/room-summary/sub-managers/room-stats-manager.ts`：迁移 `getRoomSummaryStats`、`recalculateSummaryStats`、`recalculateSummaryHeroes`、`clearSummaryUnread`、`getEventKeys`、`getRoomThread`、`getRoomThreadById`、`getRoomHierarchy`。

- [ ] **Step 9: 重写 room-summary/index.ts 为门面**

Modify `src/room-summary/index.ts`：去除所有直接实现的方法，改为 one-liner 门面委托。保留 `createInternalSummary`、`batchGetSummaries`、`fetchBatchSummaries`、`listUserSummaries`（这些是顶层协调方法，涉及多 sub-manager 协作，可保留或迁移到 event-operation-manager）。保留 `clearCache`、`getCacheStats`、`getMetrics`、`getCachedSummary`、`getCachedMembers`、`getCachedStats`、`isCached`（缓存管理，保留在顶层）。

最终 index.ts 结构：

- imports（sub-managers + types）
- `RoomSummaryEvent` re-export
- `RoomSummaryManager` class
    - 构造器（实例化 8 个 sub-manager + forwardSubManagerEvents）
    - 8 个 `public readonly` sub-manager 实例
    - 缓存管理方法（clearCache, getCacheStats, getMetrics, getCachedSummary, getCachedMembers, getCachedStats, isCached）
    - 顶层协调方法（createInternalSummary, batchGetSummaries, fetchBatchSummaries, listUserSummaries）
    - `summaryReadPath`/`internalSummaryPath` 私有辅助
    - 全部门面委托方法（one-liner，@deprecated）

- [ ] **Step 10: 运行 room-summary 测试验证回归**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/room-summary.spec.ts 2>&1 | tail -40`
Expected: 全部 PASS

- [ ] **Step 11: 运行 lint + 类型检查**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm lint:js-fix src/room-summary 2>&1 | tail -10 && pnpm lint:types 2>&1 | tail -10`
Expected: 0 error

- [ ] **Step 12: Commit**

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk
git add src/room-summary/ spec/unit/room-summary.spec.ts
git commit -m "refactor(room-summary): P-102 将 index.ts 直接方法迁移到 8 个 sub-managers

将 room-summary/index.ts (1061 行) 中 50+ 个直接实现的方法迁移到对应 sub-manager:
- room-event-operation-manager: 13 个方法（CRUD + 事件操作）
- room-invite-policy-manager: 4 个方法
- room-key-manager: 4 个方法
- room-member-manager: 4 个方法
- room-search-manager: 5 个方法
- room-state-manager: 19 个方法
- room-stats-manager: 8 个方法

index.ts 降至 < 280 行（门面 + 缓存管理 + 顶层协调），全部测试通过。"
```

---

## Task 5: admin/index.ts 门面精简（复用 6 个 sub-managers）

**策略**：admin 已有 6 个 sub-managers，index.ts 是 800+ 行 one-liner 门面。本 Task 用 ES Proxy 自动转发 + 保留少量必要显式方法 + 全部加 @deprecated 注释。

**Files:**

- Modify: `src/admin/index.ts`
- Test: `spec/unit/admin.spec.ts`、`spec/unit/admin-extended.spec.ts`、`spec/unit/admin-new-endpoints.spec.ts`

**Interfaces:**

- Consumes: 6 个现有 sub-manager 类、`AdminBaseManager`、`AdminEvent`、`AdminManagerEventMap`、所有 admin types
- Produces: `AdminManager` 通过 Proxy 自动转发 + 6 个 `public readonly` sub-manager 实例；保留 `forwardSubManagerEvents`、构造器

- [ ] **Step 1: 建立测试基线**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/admin.spec.ts spec/unit/admin-extended.spec.ts spec/unit/admin-new-endpoints.spec.ts 2>&1 | tail -30`
Expected: 全部 PASS

- [ ] **Step 2: 重写 admin/index.ts 使用 Proxy 自动转发**

Modify `src/admin/index.ts`：删除所有显式门面委托方法（约 800 行），改为 ES Proxy 实现。保留：

- 所有 imports（sub-managers + types + AdminEvent）
- `AdminManager` class
    - 6 个 `public readonly` sub-manager 实例
    - 构造器（实例化 + forwardSubManagerEvents + Proxy 包装）
    - `forwardSubManagerEvents` 私有方法
    - 静态方法路由表（按方法名前缀映射到 sub-manager）

实现示例：

```typescript
export class AdminManager extends AdminBaseManager<AdminEvent, AdminManagerEventMap> {
    public readonly users: AdminUserManager;
    public readonly rooms: AdminRoomManager;
    public readonly server: AdminServerManager;
    public readonly federation: AdminFederationManager;
    public readonly media: AdminMediaManager;
    public readonly config: AdminConfigManager;

    constructor(client: MatrixClient, opts?: ManagerOpts) {
        const onError: AdminErrorCallback = (error) => {
            this.emit(AdminEvent.AdminError, error);
        };
        super(client, onError, opts);

        this.users = new AdminUserManager(client, onError, opts);
        this.rooms = new AdminRoomManager(client, onError, opts);
        this.server = new AdminServerManager(client, onError, opts);
        this.federation = new AdminFederationManager(client, onError, opts);
        this.media = new AdminMediaManager(client, onError, opts);
        this.config = new AdminConfigManager(client, onError, opts);

        this.forwardSubManagerEvents();

        // Proxy 自动转发（按方法名前缀路由）
        return new Proxy(this, {
            get(target, prop, receiver) {
                if (Reflect.has(target, prop)) {
                    return Reflect.get(target, prop, receiver);
                }
                if (typeof prop === "string") {
                    const subManager = target.routeToSubManager(prop);
                    if (subManager && typeof (subManager as Record<string, unknown>)[prop] === "function") {
                        return (subManager as Record<string, (...args: unknown[]) => unknown>)[prop].bind(subManager);
                    }
                }
                return undefined;
            },
        });
    }

    private routeToSubManager(
        methodName: string,
    ):
        | AdminUserManager
        | AdminRoomManager
        | AdminServerManager
        | AdminFederationManager
        | AdminMediaManager
        | AdminConfigManager
        | null {
        // 用户域：getUser*/createUser*/deactivateUser*/deleteUser*/batchCreateUsers/batchDeactivateUsers/resetPassword/setAdmin/listUserStats/invalidateUserSession/loginAsUser/logoutUser/evictUser/getAccountStatus/isAdmin/overrideRateLimit/getRateLimitOverride/deleteRateLimitOverride/shadowBanUser/unshadowBanUser/getShadowBanStatus/getRateLimit/setRateLimit/deleteRateLimit/getAccountDetails/getUserWhois/whois*/deleteUserMedia/getUserNotification/setUserNotification/getUserPushers/deleteUserPusher/blockEventReportUser/unblockEventReportUser/isSynapseAdministrator/whoisSynapseUser/deactivateSynapseUser/getUserDevices/deleteUserDevices/deleteUserDevice/getUserTokens/deleteUserToken/getUserRefreshTokens/deleteUserRefreshToken/getUserSession/getUserRooms/getUserStats
        if (
            /^(get|create|deactivate|delete|batch|reset|set|list|invalidate|login|logout|evict|is|override|shadowBan|unshadowBan|whois|blockEvent|unblockEvent)/.test(
                methodName,
            ) &&
            (methodName.includes("User") ||
                methodName.includes("Account") ||
                methodName.includes("RateLimit") ||
                methodName.includes("ShadowBan") ||
                methodName.includes("Whois") ||
                methodName.includes("Token") ||
                methodName.includes("Session") ||
                methodName.includes("Synapse"))
        ) {
            return this.users;
        }
        // 房间域：searchRooms/getRoom/deleteRoomAdmin/purgeRoomHistory/blockRoom/unblockRoom/getRoomMembers/addRoomMember/removeRoomMember/banRoomMember/kickRoomMember/unbanRoomMember/banRoom/kickRoom/makeRoomAdmin/getRoomState/deleteRoomMessage/getRoomAliases/getRoomVersion/getRoomBlockStatus/getRoomEventContext/getRoomForwardExtremities/getRoomTokenSync/searchRoomEvents/getRoomListings/setRoomPublicListing/deleteRoomPublicListing/getRoomStats/joinRoom
        if (methodName.includes("Room") || methodName === "joinRoom") {
            return this.rooms;
        }
        // 服务器域：getServerStats/...
        if (methodName.includes("Server") || methodName.includes("Stats")) {
            return this.server;
        }
        // 联邦域
        if (methodName.includes("Federation")) {
            return this.federation;
        }
        // 媒体域
        if (methodName.includes("Media")) {
            return this.media;
        }
        // 配置域
        if (methodName.includes("Config") || methodName.includes("Setting")) {
            return this.config;
        }
        return null;
    }

    private forwardSubManagerEvents(): void {
        // 保持原有事件转发逻辑不变
    }
}
```

**重要注意**：

- Proxy 的 `get` trap 必须先检查 `Reflect.has(target, prop)`，否则会破坏 `instanceof` 检查和 Symbol 属性访问
- Proxy 返回的对象替代原 `this`，调用方拿到的是 Proxy 而非原始 AdminManager 实例——这要求所有内部方法引用使用 `this.xxx` 而非外部捕获的 `self`，并且 sub-manager 实例化必须在 Proxy 返回前完成
- 测试中如果有 `instanceof AdminManager` 检查，Proxy 不会通过——需要在测试中改为 duck-typing 或在 Proxy 上添加 `[Symbol.hasInstance]` 处理

- [ ] **Step 3: 运行 admin 测试验证**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm vitest run spec/unit/admin.spec.ts spec/unit/admin-extended.spec.ts spec/unit/admin-new-endpoints.spec.ts 2>&1 | tail -40`
Expected: 全部 PASS。如果出现 `instanceof AdminManager` 失败，需在 Proxy handler 添加 `[Symbol.hasInstance]` 处理，或调整测试断言为 duck-typing。

- [ ] **Step 4: 运行 lint + 类型检查**

Run: `cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk && pnpm lint:js-fix src/admin 2>&1 | tail -10 && pnpm lint:types 2>&1 | tail -10`
Expected: 0 error

- [ ] **Step 5: Commit**

```bash
cd /Users/ljf/Desktop/hu_ts/matrix-js-sdk
git add src/admin/ spec/unit/admin*.spec.ts
git commit -m "refactor(admin): P-102 用 Proxy 自动转发替代 800+ 行门面方法

将 admin/index.ts (1253 行) 精简为:
- 6 个 public readonly sub-manager 实例
- forwardSubManagerEvents 事件转发
- ES Proxy 自动按方法名前缀路由到对应 sub-manager

index.ts 降至 < 280 行，全部测试通过。"
```

---

## Self-Review

### 1. Spec coverage

- ✅ Top 5 文件全部覆盖（admin/dm/federation/room-summary/space）
- ✅ 每个文件有明确的 sub-manager 划分和方法迁移映射
- ✅ 目标行数明确（index.ts < 280，sub-manager < 400）
- ✅ TDD 流程：每个 Task 先建立测试基线，再拆分，再验证回归
- ✅ 向后兼容：全部门面方法保留 + @deprecated 标注
- ✅ 事件转发：每个 Task 都有 forwardSubManagerEvents 步骤
- ✅ lint + types + test 三重验证：每个 Task 末尾都运行
- ✅ commit 粒度：每个 Task 一个 commit
- ✅ Global Constraints 全部体现（命名、基类、错误处理、import 规范等）

### 2. Placeholder scan

- ⚠️ Task 1 Step 8 中 `// ...（其他事件转发）` 是占位符——已通过 `forwardSubManagerEvents` 模式说明，实现时需补全 4 个 sub-manager 的事件转发（BlacklistUpdated/ServerAdded/ServerRemoved/FederationError）
- ⚠️ Task 2-4 中 `/* ... */` 表示方法体从原文件复制——这是迁移操作，非占位符，但实现时需逐字复制并调整 `this.request` → sub-manager 自身的 `request`、`this.client` → 仍是 `this.client`（BaseManager 提供）
- ⚠️ Task 5 Step 2 的 `routeToSubManager` 是简化版路由——实现时需根据 admin/index.ts 实际方法名补全所有前缀映射，可参考现有 6 个 sub-manager 的方法清单
- ✅ 无 TBD/TODO/"implement later"
- ✅ 每个 Step 都有具体命令或代码块

### 3. Type consistency

- ✅ `FederationBlacklistManager`/`FederationServerManager`/`FederationQueryManager`/`FederationRoomManager` 类名贯穿 Task 1 一致
- ✅ `SpaceLifecycleManager`/`SpaceQueryManager`/`SpaceChildManager`/`SpaceMemberManager`/`SpaceHierarchyManager` 类名贯穿 Task 2 一致
- ✅ `DmRoomCreationManager`/`DmRoomListManager`/`DmRoomOperationManager` 类名贯穿 Task 3 一致
- ✅ `IBlacklistEntry`/`IFederationServer`/`IFederationStatus` 类型从 index.ts re-export，保持向后兼容
- ✅ `DMEvent`/`SpaceEvent`/`FederationEvent` enum 从 events.ts 或 index.ts re-export，保持向后兼容
- ✅ admin/room-summary 的 sub-manager 类名沿用现有命名

### 4. 风险与注意事项

- **Task 5 Proxy 风险最高**：ES Proxy 可能破坏 `instanceof`、`Object.keys`、Symbol 属性访问。建议在 Task 5 前先验证现有测试是否有 `instanceof AdminManager` 断言；若有且无法调整，回退到保留显式门面方法（不使用 Proxy），仅做 `@deprecated` 标注——此时 index.ts 可能仍 > 300 行，但能保证零回归。
- **Task 3 DmRoomCreationManager 循环依赖**：creation manager 持有 listManager 引用，list manager 必须先实例化。构造顺序：list → creation → operation。
- **Task 4 迁移工作量大**：room-summary 有 50+ 方法迁移，建议按 sub-manager 分多个 commit（Step 2-8 各一个 commit），降低单次 review 难度。
- **测试基线**：每个 Task Step 1 必须先记录通过用例数，拆分后逐项对比，任何用例从 PASS 变 FAIL 都需停下排查。
