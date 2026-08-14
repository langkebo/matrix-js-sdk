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

import {
    CacheTtl,
    TTL_PERSISTENT,
    computeDeadlineMs,
    defaultOobMembersTtl,
    isDeadlineExpired,
} from "../../../src/store/ttl";

describe("CacheTtl (对齐后端 synapse-cache CacheTtl)", () => {
    it("room 成员 TTL 为 900s（对齐 room_members）", () => {
        expect(CacheTtl.ROOM_MEMBERS).toBe(900);
    });

    it("用户 profile TTL 为 3600s（对齐 user_profile）", () => {
        expect(CacheTtl.USER_PROFILE).toBe(3600);
    });

    it("sync 快照 staleness 为 24h", () => {
        expect(CacheTtl.SYNC_SNAPSHOT).toBe(24 * 3600);
    });
});

describe("computeDeadlineMs（统一 deadline 语义）", () => {
    it("正数 TTL 返回 now + ttl 毫秒", () => {
        const now = 1_000_000;
        expect(computeDeadlineMs(900, now)).toBe(now + 900_000);
    });

    it("TTL_PERSISTENT 返回 Infinity（持久不过期）", () => {
        expect(computeDeadlineMs(TTL_PERSISTENT)).toBe(Infinity);
    });

    it("0 或负数返回 0（立即过期 / 禁用缓存）", () => {
        expect(computeDeadlineMs(0)).toBe(0);
        expect(computeDeadlineMs(-5)).toBe(0);
    });
});

describe("isDeadlineExpired（统一 deadline 语义）", () => {
    it("Infinity 持久不过期", () => {
        expect(isDeadlineExpired(Infinity, Date.now())).toBe(false);
    });

    it("0 立即过期", () => {
        expect(isDeadlineExpired(0, 1_000_000)).toBe(true);
    });

    it("超过 deadline 判定过期", () => {
        expect(isDeadlineExpired(1_000_000, 1_000_001)).toBe(true);
    });

    it("未到 deadline 判定未过期", () => {
        expect(isDeadlineExpired(1_000_000, 999_999)).toBe(false);
    });
});

describe("defaultOobMembersTtl", () => {
    it("默认所有房间统一 room_members 900s", () => {
        expect(defaultOobMembersTtl("!any:server")).toBe(CacheTtl.ROOM_MEMBERS);
    });
});
