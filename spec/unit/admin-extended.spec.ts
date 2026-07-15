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

import { describe, it, expect, beforeEach, vi } from "vitest";

import { AdminManager, AdminEvent } from "../../src/admin/index";
import { MatrixError } from "../../src/http-api/errors";

describe("AdminManager - Extended Tests", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let adminManager: AdminManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        adminManager = new AdminManager(mockClient);
    });

    describe("User Management - Extended", () => {
        it("should deactivate user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue();

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.deactivateUser("@user:example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            expect(emitSpy).toHaveBeenCalledWith(AdminEvent.UserDeactivated, "@user:example.com");
        });

        it("should reset password successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.resetPassword("@user:example.com", "newpass123");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("new_password", "newpass123");
        });

        it("should set admin status successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.setAdmin("@user:example.com", true);

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("admin", true);
        });

        it("should get user devices successfully", async () => {
            const mockDevices = [
                { device_id: "DEVICE1", display_name: "Phone" },
                { device_id: "DEVICE2", display_name: "Desktop" },
            ];
            mockClient.http.authedRequest.mockResolvedValue({ devices: mockDevices });

            const devices = await adminManager.getUserDevices("@user:example.com");

            expect(devices).toEqual(mockDevices);
        });

        it("should delete user devices successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.deleteUserDevices("@user:example.com", ["DEVICE1", "DEVICE2"]);

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("devices", ["DEVICE1", "DEVICE2"]);
        });

        it("should shadow ban user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.shadowBanUser("@user:example.com");

            expect(emitSpy).toHaveBeenCalledWith(AdminEvent.UserShadowBanned, "@user:example.com");
        });

        it("should unshadow ban user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.unshadowBanUser("@user:example.com");

            expect(emitSpy).toHaveBeenCalledWith(AdminEvent.UserUnshadowBanned, "@user:example.com");
        });

        it("should get shadow ban status successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                user_id: "@user:example.com",
                banned: true,
                banned_at: 1234567890,
            });

            const status = await adminManager.getShadowBanStatus("@user:example.com");

            expect(status?.banned).toBe(true);
            expect(status?.user_id).toBe("@user:example.com");
        });

        it("should return null for non-existent shadow ban status when throwOnError is false", async () => {
            const notFoundError = new MatrixError({ errcode: "M_NOT_FOUND" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValue(notFoundError);

            const status = await adminManager.getShadowBanStatus("@user:example.com", false);

            expect(status).toBeNull();
        });
    });

    describe("Rate Limiting", () => {
        it("should get rate limit successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                messages_per_second: 10,
                burst_count: 20,
            });

            const rateLimit = await adminManager.getRateLimit("@user:example.com");

            expect(rateLimit?.messages_per_second).toBe(10);
            expect(rateLimit?.burst_count).toBe(20);
        });

        it("should return null for non-existent rate limit when throwOnError is false", async () => {
            const notFoundError = new MatrixError({ errcode: "M_NOT_FOUND" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValue(notFoundError);

            const rateLimit = await adminManager.getRateLimit("@user:example.com", false);

            expect(rateLimit).toBeNull();
        });

        it("should set rate limit successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.setRateLimit("@user:example.com", {
                messages_per_second: 5,
                burst_count: 10,
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("messages_per_second", 5);
        });

        it("should delete rate limit successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.deleteRateLimit("@user:example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("Room Management - Extended", () => {
        it("should get room successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                room_id: "!room:example.com",
                name: "Test Room",
                joined_members: 5,
            });

            const room = await adminManager.getRoom("!room:example.com");

            expect(room?.room_id).toBe("!room:example.com");
            expect(room?.name).toBe("Test Room");
        });

        it("should return null for non-existent room when throwOnError is false", async () => {
            const notFoundError = new MatrixError({ errcode: "M_NOT_FOUND" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValue(notFoundError);

            const room = await adminManager.getRoom("!room:example.com", false);

            expect(room).toBeNull();
        });

        it("should delete room with options", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ delete_id: "delete123" });

            await adminManager.deleteRoom("!room:example.com", {
                purge: true,
                force_purge: true,
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("purge", true);
            expect(call[3]).toHaveProperty("force_purge", true);
        });

        it("should block room successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.blockRoom("!room:example.com", true);

            expect(emitSpy).toHaveBeenCalledWith(AdminEvent.RoomBlocked, "!room:example.com", true);
        });

        it("should get room members successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                members: ["@user1:example.com", "@user2:example.com"],
                total: 2,
            });

            const members = await adminManager.getRoomMembers("!room:example.com");

            expect(members).toHaveLength(2);
            expect(members).toContain("@user1:example.com");
        });

        it("should join room as user successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.joinRoom("!room:example.com", "@user:example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should get room state successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                state: [
                    { type: "m.room.name", content: { name: "Test" } },
                    { type: "m.room.topic", content: { topic: "Topic" } },
                ],
            });

            const state = await adminManager.getRoomState("!room:example.com");

            expect(state.state).toHaveLength(2);
        });

        it("should get room messages successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                chunk: [{ event_id: "$event1" }, { event_id: "$event2" }],
                start: "t1",
                end: "t2",
            });

            const messages = await adminManager.getRoomMessages("!room:example.com", {
                limit: 10,
                from: "t1",
            });

            expect(messages.chunk).toHaveLength(2);
        });

        it("should preserve zero-valued room message limits", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                chunk: [],
                start: "t1",
                end: "t2",
            });

            await adminManager.getRoomMessages("!room:example.com", {
                limit: 0,
                dir: "b",
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/rooms/!room%3Aexample.com/messages",
                { limit: "0", dir: "b" },
                undefined,
                {
                    prefix: "/_synapse/admin/v1",
                },
            );
        });

        it("should get room aliases successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                aliases: ["#room1:example.com", "#room2:example.com"],
            });

            const result = await adminManager.getRoomAliases("!room:example.com");

            expect(result.aliases).toHaveLength(2);
        });

        it("should get room version successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                room_id: "!room:example.com",
                room_version: "10",
            });

            const version = await adminManager.getRoomVersion("!room:example.com");

            expect(version?.room_version).toBe("10");
        });

        it("should get room block status successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                block: true,
                blocked_at: 1234567890,
            });

            const status = await adminManager.getRoomBlockStatus("!room:example.com");

            expect(status.block).toBe(true);
        });

        it("should unblock room successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.blockRoom("!room:example.com", false);

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("Server Management - Extended", () => {
        it("should get server config successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                max_upload_size: 10485760,
                enable_registration: false,
            });

            const config = await adminManager.getServerConfig();

            expect(config.max_upload_size).toBe(10485760);
        });

        it("should emit ServerStatsUpdated event", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                total_users: 100,
                total_rooms: 50,
            });

            const emitSpy = vi.spyOn(adminManager, "emit");
            await adminManager.getServerStats();

            expect(emitSpy).toHaveBeenCalledWith(AdminEvent.ServerStatsUpdated, expect.any(Object));
        });
    });

    describe("Registration Tokens", () => {
        it("should get registration tokens successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                registration_tokens: [
                    { token: "token1", uses_allowed: 10, pending: 0, completed: 5 },
                    { token: "token2", uses_allowed: null, pending: 0, completed: 2 },
                ],
            });

            const tokens = await adminManager.getRegistrationTokens();

            expect(tokens).toHaveLength(2);
            expect(tokens[0].token).toBe("token1");
        });

        it("should create registration token successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                token: "newtoken123",
                uses_allowed: 5,
                expiry_time: null,
            });

            const token = await adminManager.createRegistrationToken({
                token: "newtoken123",
                uses_allowed: 5,
            });

            expect(token.token).toBe("newtoken123");
        });

        it("should update registration token successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.updateRegistrationToken("token1", {
                uses_allowed: 20,
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
            const call = mockClient.http.authedRequest.mock.calls[0];
            expect(call[3]).toHaveProperty("uses_allowed", 20);
        });

        it("should delete registration token successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.deleteRegistrationToken("token1");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("Federation Management", () => {
        it("should get federation destinations successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                destinations: [
                    { destination: "server1.com", retry_last_ts: 0, retry_interval: 0 },
                    { destination: "server2.com", retry_last_ts: 0, retry_interval: 0 },
                ],
            });

            const destinations = await adminManager.getFederationDestinations();

            expect(destinations).toHaveLength(2);
        });

        it("should get federation destination successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                destination: "server1.com",
                retry_last_ts: 0,
                retry_interval: 0,
                failure_ts: null,
            });

            const dest = await adminManager.getFederationDestination("server1.com");

            expect(dest?.destination).toBe("server1.com");
        });

        it("should return null for non-existent federation destination when throwOnError is false", async () => {
            const notFoundError = new MatrixError({ errcode: "M_NOT_FOUND" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValue(notFoundError);

            const dest = await adminManager.getFederationDestination("unknown.com", false);

            expect(dest).toBeNull();
        });

        it("should reset federation connection successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.resetFederationConnection("server1.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });
    });

    describe("Media Management", () => {
        it("should get media successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                media: [
                    { media_id: "media1", media_type: "image/png" },
                    { media_id: "media2", media_type: "image/jpeg" },
                ],
                next_token: "next",
            });

            const result = await adminManager.getMedia(10, "from");

            expect(result.media).toHaveLength(2);
            expect(result.next_token).toBe("next");
        });

        it("should delete media successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.deleteMedia("media123");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should quarantine media successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});

            await adminManager.quarantineMedia("media123");

            expect(mockClient.http.authedRequest).toHaveBeenCalled();
        });

        it("should purge media cache successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ deleted: 42 });

            const result = await adminManager.purgeMediaCache(1234567890);

            expect(result.deleted).toBe(42);
        });
    });

    describe("Cache Management", () => {
        it("should cache and retrieve server stats", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                total_users: 100,
                total_rooms: 50,
            });

            await adminManager.getServerStats();
            const cached = adminManager.getServerStatsCached();

            expect(cached?.total_users).toBe(100);
            expect(cached?.total_rooms).toBe(50);
        });

        it("should return null when no cached stats", () => {
            const cached = adminManager.getServerStatsCached();

            expect(cached).toBeNull();
        });
    });
});
