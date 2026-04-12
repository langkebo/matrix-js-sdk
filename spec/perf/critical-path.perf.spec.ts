import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";

import type { MatrixClient } from "../../src/client.ts";
import { PushManager } from "../../src/push/index.ts";
import { RoomSummaryManager } from "../../src/room-summary/index.ts";

function calculateP95(samples: number[]): number {
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length * 0.95)];
}

function calculateStats(samples: number[]) {
    samples.sort((a, b) => a - b);
    const sum = samples.reduce((a, b) => a + b, 0);
    return {
        min: samples[0],
        max: samples[samples.length - 1],
        mean: sum / samples.length,
        p50: samples[Math.floor(samples.length * 0.5)],
        p95: samples[Math.floor(samples.length * 0.95)],
        p99: samples[Math.floor(samples.length * 0.99)],
    };
}

describe("Critical Path Performance Guard", () => {
    describe("PushManager", () => {
        it("getPushRules should complete under budget in warm-cache path", async () => {
            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue({
                        global: {
                            override: [{ rule_id: "rule1", enabled: true, actions: ["notify"] }],
                            content: [],
                            room: [],
                            sender: [],
                            underride: [],
                        },
                    }),
                },
                getUserId: vi.fn().mockReturnValue("@perf:example.com"),
            };
            const manager = new PushManager(mockClient as unknown as MatrixClient);

            await manager.getPushRules(true);

            const samples: number[] = [];
            for (let i = 0; i < 100; i++) {
                const start = performance.now();
                await manager.getPushRules(false);
                samples.push(performance.now() - start);
            }

            const stats = calculateStats(samples);
            expect(stats.p95).toBeLessThan(2.0);
        });
    });

    describe("RoomSummaryManager", () => {
        it("getRoomSummary should complete under budget in warm-cache path", async () => {
            const mockRoomSummary = {
                room_id: "!room:example.com",
                name: "Test Room",
                topic: "Test Topic",
                avatar_url: "mxc://example.com/avatar",
                num_joined_members: 10,
                num_active_members: 5,
                join_rule: "public",
                world_readable: true,
                guest_can_join: false,
                created_at: Date.now(),
                updated_at: Date.now(),
            };

            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue(mockRoomSummary),
                },
                getUserId: vi.fn().mockReturnValue("@perf:example.com"),
            };
            const manager = new RoomSummaryManager(mockClient as unknown as MatrixClient);

            await manager.getRoomSummary("!room:example.com", undefined, true);

            const samples: number[] = [];
            for (let i = 0; i < 100; i++) {
                const start = performance.now();
                await manager.getRoomSummary("!room:example.com", undefined, false);
                samples.push(performance.now() - start);
            }

            const stats = calculateStats(samples);
            expect(stats.p95).toBeLessThan(2.0);
        });

        it("getRoomSummaryMembers should complete under budget", async () => {
            const mockMembers = Array.from({ length: 50 }, (_, i) => ({
                user_id: `@user${i}:example.com`,
                display_name: `User ${i}`,
                avatar_url: `mxc://example.com/avatar${i}`,
                membership: "join",
            }));

            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue({ members: mockMembers }),
                },
                getUserId: vi.fn().mockReturnValue("@perf:example.com"),
            };
            const manager = new RoomSummaryManager(mockClient as unknown as MatrixClient);

            const samples: number[] = [];
            for (let i = 0; i < 100; i++) {
                const start = performance.now();
                await manager.getRoomSummaryMembers("!room:example.com");
                samples.push(performance.now() - start);
            }

            const stats = calculateStats(samples);
            expect(stats.p95).toBeLessThan(5.0);
        });

        it("getRoomSummaryStats should complete under budget", async () => {
            const mockStats = {
                total_rooms: 100,
                total_messages: 5000,
                total_members: 250,
                active_users_24h: 50,
                active_users_7d: 100,
            };

            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue(mockStats),
                },
                getUserId: vi.fn().mockReturnValue("@perf:example.com"),
            };
            const manager = new RoomSummaryManager(mockClient as unknown as MatrixClient);

            const samples: number[] = [];
            for (let i = 0; i < 100; i++) {
                const start = performance.now();
                await manager.getRoomSummaryStats("!room:example.com");
                samples.push(performance.now() - start);
            }

            const stats = calculateStats(samples);
            expect(stats.p95).toBeLessThan(3.0);
        });

        it("listUserSummaries should complete under budget", async () => {
            const mockResponse = {
                rooms: Array.from({ length: 20 }, (_, i) => ({
                    room_id: `!room${i}:example.com`,
                    name: `Room ${i}`,
                    num_joined_members: 10,
                })),
                next_batch: null,
            };

            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue(mockResponse),
                },
                getUserId: vi.fn().mockReturnValue("@perf:example.com"),
            };
            const manager = new RoomSummaryManager(mockClient as unknown as MatrixClient);

            const samples: number[] = [];
            for (let i = 0; i < 100; i++) {
                const start = performance.now();
                await manager.listUserSummaries();
                samples.push(performance.now() - start);
            }

            const stats = calculateStats(samples);
            expect(stats.p95).toBeLessThan(5.0);
        });
    });

    describe("Performance Summary Report", () => {
        it("should generate performance baseline report", async () => {
            const results: Record<string, { p95: number; budget: number; passed: boolean }> = {};

            // PushManager.getPushRules
            const mockClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue({
                        global: { override: [], content: [], room: [], sender: [], underride: [] },
                    }),
                },
                getUserId: vi.fn().mockReturnValue("@perf:example.com"),
            };
            const pushManager = new PushManager(mockClient as unknown as MatrixClient);
            await pushManager.getPushRules(true);

            const pushSamples: number[] = [];
            for (let i = 0; i < 100; i++) {
                const start = performance.now();
                await pushManager.getPushRules(false);
                pushSamples.push(performance.now() - start);
            }
            const pushP95 = calculateP95(pushSamples);
            results["PushManager.getPushRules"] = { p95: pushP95, budget: 2.0, passed: pushP95 < 2.0 };

            // RoomSummaryManager.getRoomSummary
            const mockRoomClient = {
                http: {
                    authedRequest: vi.fn().mockResolvedValue({
                        room_id: "!room:example.com",
                        name: "Test Room",
                    }),
                },
                getUserId: vi.fn().mockReturnValue("@perf:example.com"),
            };
            const roomManager = new RoomSummaryManager(mockRoomClient as unknown as MatrixClient);
            await roomManager.getRoomSummary("!room:example.com", undefined, true);

            const roomSamples: number[] = [];
            for (let i = 0; i < 100; i++) {
                const start = performance.now();
                await roomManager.getRoomSummary("!room:example.com", undefined, false);
                roomSamples.push(performance.now() - start);
            }
            const roomP95 = calculateP95(roomSamples);
            results["RoomSummaryManager.getRoomSummary"] = { p95: roomP95, budget: 2.0, passed: roomP95 < 2.0 };
            const passed = Object.values(results).filter((r) => r.passed).length;
            const total = Object.keys(results).length;

            expect(passed).toBe(total);
        });
    });
});
