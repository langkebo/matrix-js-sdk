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

import { describe, expect, it, vi } from "vitest";

import { MemoryStore } from "../../../src/store/memory";
import { User } from "../../../src/models/user";
import { DEFAULT_STORE_CAPACITY, LruMap } from "../../../src/store/capacity";
import { CacheTtl } from "../../../src/store/ttl";

describe("LruMap", () => {
    it("set/get/has/size 基础行为", () => {
        const m = new LruMap<string, number>(3);
        m.set("a", 1);
        m.set("b", 2);
        expect(m.size).toBe(2);
        expect(m.get("a")).toBe(1);
        expect(m.has("b")).toBe(true);
        expect(m.has("c")).toBe(false);
        expect(m.get("c")).toBeUndefined();
    });

    it("超出容量时淘汰最久未访问条目（插入顺序）", () => {
        const evicted: string[] = [];
        const m = new LruMap<string, number>(3, (key) => evicted.push(key));
        m.set("a", 1);
        m.set("b", 2);
        m.set("c", 3);
        m.set("d", 4); // 淘汰 a
        expect(m.size).toBe(3);
        expect(m.has("a")).toBe(false);
        expect(m.has("b")).toBe(true);
        expect(evicted).toEqual(["a"]);
    });

    it("get 命中会触摸条目，使其免于淘汰（LRU）", () => {
        const m = new LruMap<string, number>(3);
        m.set("a", 1);
        m.set("b", 2);
        m.set("c", 3);
        m.get("a"); // 触摸 a，使其成为最近使用
        m.set("d", 4); // 应淘汰 b（a 已被触摸）
        expect(m.has("a")).toBe(true);
        expect(m.has("b")).toBe(false);
        expect(m.has("c")).toBe(true);
        expect(m.has("d")).toBe(true);
    });

    it("TTL 过期后 get 返回 undefined 并触发 onEvict", () => {
        vi.useFakeTimers();
        try {
            const evicted: string[] = [];
            const m = new LruMap<string, number>(3, (key) => evicted.push(key), 900); // 900s TTL
            m.set("a", 1);
            expect(m.get("a")).toBe(1); // 未过期
            vi.advanceTimersByTime(901_000);
            expect(m.get("a")).toBeUndefined(); // 已过期
            expect(evicted).toEqual(["a"]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("默认无 TTL（持久），永不过期", () => {
        vi.useFakeTimers();
        try {
            const m = new LruMap<string, number>(3);
            m.set("a", 1);
            vi.advanceTimersByTime(10_000_000);
            expect(m.get("a")).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("DEFAULT_STORE_CAPACITY (对齐后端 max_capacity + 原局部 LRU)", () => {
    it("room/user 兜底上限对齐后端 100_000", () => {
        expect(DEFAULT_STORE_CAPACITY.maxRooms).toBe(100_000);
        expect(DEFAULT_STORE_CAPACITY.maxUsers).toBe(100_000);
    });

    it("保留原 OOB=50、pending=100 的局部上限", () => {
        expect(DEFAULT_STORE_CAPACITY.maxOutOfBandMembersRooms).toBe(50);
        expect(DEFAULT_STORE_CAPACITY.maxPendingEventsPerRoom).toBe(100);
    });
});

describe("MemoryStore 缓存统计集成", () => {
    it("getUser 记录命中/未命中", () => {
        const store = new MemoryStore();
        store.storeUser(new User("@alice:server"));
        expect(store.getUser("@alice:server")).not.toBeNull(); // hit
        expect(store.getUser("@bob:server")).toBeNull(); // miss
        const stats = store.getStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
    });

    it("OOB 成员超出容量时 LRU 淘汰并计入统计", async () => {
        const store = new MemoryStore();
        // 首次查询未命中
        await store.getOutOfBandMembers("!room0:server");
        expect(store.getStats().misses).toBe(1);

        // 写入 60 个 room，超出默认 50 上限 → 淘汰 10 个
        for (let i = 0; i < 60; i++) {
            await store.setOutOfBandMembers(`!room${i}:server`, [
                { type: "m.room.member", content: { membership: "join" } } as any,
            ]);
        }

        const stats = store.getStats();
        expect(stats.evictions).toBe(10);
        expect(stats.totalEntries).toBe(50);

        // 命中一个未淘汰的 room
        const members = await store.getOutOfBandMembers("!room10:server");
        expect(members).not.toBeNull();
        expect(store.getStats().hits).toBe(1);

        // 内存占用估算为正
        expect(store.getStats().memoryUsageBytes).toBeGreaterThan(0);
    });

    it("getStats 汇总各集合条目数", async () => {
        const store = new MemoryStore();
        store.storeUser(new User("@alice:server"));
        store.storeUser(new User("@bob:server"));
        await store.setOutOfBandMembers("!room0:server", []);

        const stats = store.getStats();
        expect(stats.totalEntries).toBe(3); // 2 users + 1 oob room
    });

    it("deleteAllData 重置统计", async () => {
        const store = new MemoryStore();
        store.storeUser(new User("@alice:server"));
        await store.getOutOfBandMembers("!room0:server"); // miss
        await store.deleteAllData();

        const stats = store.getStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
        expect(stats.totalEntries).toBe(0);
    });

    it("支持通过 capacity 覆盖容量预算", async () => {
        const store = new MemoryStore({ capacity: { maxOutOfBandMembersRooms: 2 } });
        for (let i = 0; i < 4; i++) {
            await store.setOutOfBandMembers(`!room${i}:server`, [
                { type: "m.room.member", content: { membership: "join" } } as any,
            ]);
        }
        expect(store.getStats().totalEntries).toBe(2);
        expect(store.getStats().evictions).toBe(2);
    });

    it("user 超出 maxUsers 时 LRU 淘汰", () => {
        const store = new MemoryStore({ capacity: { maxUsers: 2 } });
        store.storeUser(new User("@alice:server"));
        store.storeUser(new User("@bob:server"));
        store.storeUser(new User("@carol:server")); // 超出 → 淘汰 alice
        expect(store.getUser("@alice:server")).toBeNull();
        expect(store.getUser("@carol:server")).not.toBeNull();
        expect(store.getStats().evictions).toBe(1);
    });

    it("room 超出 maxRooms 时 LRU 淘汰", () => {
        const store = new MemoryStore({ capacity: { maxRooms: 2 } });
        const makeRoom = (id: string) =>
            ({
                roomId: id,
                currentState: { on: () => {}, getMembers: () => [], removeListener: () => {} },
            }) as any;
        store.storeRoom(makeRoom("!r1:server"));
        store.storeRoom(makeRoom("!r2:server"));
        store.storeRoom(makeRoom("!r3:server")); // 超出 → 淘汰 r1
        expect(store.getRoom("!r1:server")).toBeNull();
        expect(store.getRoom("!r3:server")).not.toBeNull();
        expect(store.getStats().evictions).toBe(1);
    });

    it("OOB 成员 900s 后过期淘汰（对齐 room_members）", async () => {
        vi.useFakeTimers();
        try {
            const store = new MemoryStore();
            await store.setOutOfBandMembers("!room:server", [
                { type: "m.room.member", content: { membership: "join" } } as any,
            ]);
            expect(await store.getOutOfBandMembers("!room:server")).not.toBeNull(); // 未过期命中

            vi.advanceTimersByTime(901_000); // 超过 900s
            expect(await store.getOutOfBandMembers("!room:server")).toBeNull(); // 过期未命中
            expect(store.getStats().evictions).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("oobMembersTtl 按 roomId 动态设置 TTL（静态 900s / 动态 60s）", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            const store = new MemoryStore({
                oobMembersTtl: (roomId) => (roomId.startsWith("!dynamic") ? 60 : CacheTtl.ROOM_MEMBERS),
            });
            const member = { type: "m.room.member", content: { membership: "join" } } as any;
            await store.setOutOfBandMembers("!dynamic:server", [member]);
            await store.setOutOfBandMembers("!static:server", [member]);

            // 推进 61s：动态房间过期、静态房间仍命中
            vi.advanceTimersByTime(61_000);
            expect(await store.getOutOfBandMembers("!dynamic:server")).toBeNull();
            expect(await store.getOutOfBandMembers("!static:server")).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("oobMembersTtl 返回 0 禁用缓存：写入后立即过期", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            const store = new MemoryStore({ oobMembersTtl: () => 0 });
            await store.setOutOfBandMembers("!room:server", [
                { type: "m.room.member", content: { membership: "join" } } as any,
            ]);
            expect(await store.getOutOfBandMembers("!room:server")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});
