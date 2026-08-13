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

import { describe, expect, it } from "vitest";

import { CacheTtl, StoreDataType, TTL_PERSISTENT, getTtlMs, getTtlSeconds, isTtlExpired } from "../../../src/store/ttl";

describe("CacheTtl (对齐后端 synapse-cache CacheTtl)", () => {
    it("room 数据 TTL 为 900s（对齐 room_events/room_messages）", () => {
        expect(CacheTtl.ROOM).toBe(900);
        expect(getTtlSeconds(StoreDataType.Room)).toBe(900);
    });

    it("room 成员 TTL 为 900s（对齐 room_members）", () => {
        expect(CacheTtl.ROOM_MEMBERS).toBe(900);
        expect(getTtlSeconds(StoreDataType.RoomMembers)).toBe(900);
    });

    it("用户 profile TTL 为 3600s（对齐 user_profile）", () => {
        expect(CacheTtl.USER_PROFILE).toBe(3600);
        expect(getTtlSeconds(StoreDataType.UserProfile)).toBe(3600);
    });

    it("sync token 持久不 TTL", () => {
        expect(CacheTtl.SYNC_TOKEN).toBe(TTL_PERSISTENT);
        expect(getTtlSeconds(StoreDataType.SyncToken)).toBe(TTL_PERSISTENT);
        // 毫秒档返回 Infinity（而非负数哨兵），避免任何 `now - createdAt > ttlMs` 误判过期。
        expect(getTtlMs(StoreDataType.SyncToken)).toBe(Infinity);
    });

    it("to_device 队列持久不 TTL", () => {
        expect(CacheTtl.TO_DEVICE_QUEUE).toBe(TTL_PERSISTENT);
        expect(getTtlSeconds(StoreDataType.ToDeviceQueue)).toBe(TTL_PERSISTENT);
        expect(getTtlMs(StoreDataType.ToDeviceQueue)).toBe(Infinity);
    });
});

describe("getTtlMs / isTtlExpired", () => {
    it("getTtlMs 将秒转换为毫秒", () => {
        expect(getTtlMs(StoreDataType.Room)).toBe(900_000);
        expect(getTtlMs(StoreDataType.UserProfile)).toBe(3_600_000);
    });

    it("持久 TTL 永不过期", () => {
        expect(isTtlExpired(Date.now() - 10_000_000, TTL_PERSISTENT)).toBe(false);
    });

    it("超过 TTL 判定为过期", () => {
        const now = 1_000_000;
        expect(isTtlExpired(now - 901_000, 900, now)).toBe(true); // 901s > 900s
    });

    it("未超过 TTL 判定为未过期", () => {
        const now = 1_000_000;
        expect(isTtlExpired(now - 899_000, 900, now)).toBe(false); // 899s < 900s
    });
});
