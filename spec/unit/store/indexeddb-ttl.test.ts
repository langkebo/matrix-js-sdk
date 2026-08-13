/*
Copyright 2026 The Matrix.org Foundation C.I.C.

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
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

import { LocalIndexedDBStoreBackend } from "../../../src/store/indexeddb-local-backend";
import { CacheTtl } from "../../../src/store/ttl";

function makeSyncData(nextBatch: string): {
    next_batch: string;
    rooms: Record<string, unknown>;
    account_data: { events: unknown[] };
} {
    return {
        next_batch: nextBatch,
        rooms: { join: {}, invite: {}, leave: {} },
        account_data: { events: [] },
    };
}

describe("IndexedDB 持久化 TTL（per-key deadline 表）", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("sync 快照超过 staleness 后整体丢弃，触发全量 sync", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const dbName = "ttl-sync-" + Math.random().toString(36).slice(2);

        const b1 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b1.connect();
        await b1.setSyncData(makeSyncData("token1") as any);
        await b1.syncToDatabase([]); // 写 sync 快照 + expiry deadline
        await b1.destroy();

        // 推进超过 SYNC_SNAPSHOT（24h）
        vi.advanceTimersByTime(CacheTtl.SYNC_SNAPSHOT * 1000 + 1000);

        const b2 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b2.connect();
        // 快照已过期 → getSavedSync 返回 null → 客户端触发全量 /sync
        expect(await b2.getSavedSync()).toBeNull();
        await b2.destroy();
    });

    it("sync 快照未过期则恢复", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const dbName = "ttl-sync-fresh-" + Math.random().toString(36).slice(2);

        const b1 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b1.connect();
        await b1.setSyncData(makeSyncData("token1") as any);
        await b1.syncToDatabase([]);
        await b1.destroy();

        vi.advanceTimersByTime(60_000); // 只过 1 分钟

        const b2 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b2.connect();
        expect(await b2.getSavedSync()).not.toBeNull();
        await b2.destroy();
    });

    it("presence 超过 profile TTL 后不再恢复", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const dbName = "ttl-presence-" + Math.random().toString(36).slice(2);

        const presenceEvent = { type: "m.presence", content: { presence: "online" } };
        const b1 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b1.connect();
        await b1.syncToDatabase([["@alice:server", presenceEvent as any]]); // 写 presence + expiry
        await b1.destroy();

        vi.advanceTimersByTime(CacheTtl.USER_PROFILE * 1000 + 1000); // 超过 3600s

        const b2 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b2.connect();
        expect(await b2.getUserPresenceEvents()).toEqual([]);
        await b2.destroy();
    });

    it("presence 未过期则恢复", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const dbName = "ttl-presence-fresh-" + Math.random().toString(36).slice(2);

        const presenceEvent = { type: "m.presence", content: { presence: "online" } };
        const b1 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b1.connect();
        await b1.syncToDatabase([["@alice:server", presenceEvent as any]]);
        await b1.destroy();

        vi.advanceTimersByTime(60_000); // 只过 1 分钟

        const b2 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b2.connect();
        const tuples = await b2.getUserPresenceEvents();
        expect(tuples).toHaveLength(1);
        expect(tuples[0][0]).toBe("@alice:server");
        await b2.destroy();
    });

    it("OOB 成员超过 room_members TTL 后过期，返回 null 触发重新拉取", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const dbName = "ttl-oob-" + Math.random().toString(36).slice(2);

        const member = {
            room_id: "!r:server",
            state_key: "@u:server",
            type: "m.room.member",
            content: { membership: "join" },
        };
        const b1 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b1.connect();
        await b1.setOutOfBandMembers("!r:server", [member as any]);
        await b1.destroy();

        vi.advanceTimersByTime(CacheTtl.ROOM_MEMBERS * 1000 + 1000); // 超过 900s

        const b2 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b2.connect();
        expect(await b2.getOutOfBandMembers("!r:server")).toBeNull();
        await b2.destroy();
    });

    it("OOB 成员未过期则恢复", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const dbName = "ttl-oob-fresh-" + Math.random().toString(36).slice(2);

        const member = {
            room_id: "!r:server",
            state_key: "@u:server",
            type: "m.room.member",
            content: { membership: "join" },
        };
        const b1 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b1.connect();
        await b1.setOutOfBandMembers("!r:server", [member as any]);
        await b1.destroy();

        vi.advanceTimersByTime(60_000); // 只过 1 分钟

        const b2 = new LocalIndexedDBStoreBackend(indexedDB, dbName);
        await b2.connect();
        const members = await b2.getOutOfBandMembers("!r:server");
        expect(members).not.toBeNull();
        expect(members).toHaveLength(1);
        await b2.destroy();
    });
});
