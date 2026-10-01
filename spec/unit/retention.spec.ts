import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { RetentionManager } from "../../src/retention/index.ts";
import { InvalidParamError } from "../../src/common/errors.ts";

describe("RetentionManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let getRoom: ReturnType<typeof vi.fn>;
    let getRooms: ReturnType<typeof vi.fn>;
    let manager: RetentionManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        getRoom = vi.fn();
        getRooms = vi.fn().mockReturnValue([]);
        manager = new RetentionManager({
            http: { authedRequest },
            getRoom,
            getRooms,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("getServerRetentionPolicy", () => {
        it("GETs /_synapse/admin/v1/retention/policy", async () => {
            authedRequest.mockResolvedValueOnce({ max_lifetime: 86400000 });

            const res = await manager.getServerRetentionPolicy();

            expect(res).toEqual({ max_lifetime: 86400000 });
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/retention/policy", undefined, undefined, {
                prefix: "/_synapse/admin/v1",
            });
        });

        it("propagates 403 typed errors", async () => {
            const err = Object.assign(new Error("Forbidden"), {
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getServerRetentionPolicy()).rejects.toMatchObject({
                httpStatus: 403,
            });
        });
    });

    describe("setServerRetentionPolicy", () => {
        it("POSTs the policy with null-filled defaults and emits", async () => {
            authedRequest.mockResolvedValueOnce({ max_lifetime: 86400000 });
            const emitted: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("serverPolicyUpdated" as any, (p: unknown) => emitted.push(p));

            await manager.setServerRetentionPolicy({ max_lifetime: 86400000 });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/retention/policy",
                undefined,
                { max_lifetime: 86400000, min_lifetime: null, is_expire_on_clients: false },
                { prefix: "/_synapse/admin/v1" },
            );
            expect(emitted).toHaveLength(1);
        });

        it("FT-108: forwards is_expire_on_clients=true to match backend field name", async () => {
            authedRequest.mockResolvedValueOnce({ max_lifetime: 1000 });
            await manager.setServerRetentionPolicy({ is_expire_on_clients: true });

            const body = authedRequest.mock.calls[0][3];
            expect(body).toHaveProperty("is_expire_on_clients", true);
            expect(body).not.toHaveProperty("expire_on_clients");
        });
    });

    describe("getRoomRetentionPolicy", () => {
        it("throws InvalidParamError for empty roomId", async () => {
            await expect(manager.getRoomRetentionPolicy("")).rejects.toBeInstanceOf(InvalidParamError);
        });

        it("URL-encodes the room ID", async () => {
            authedRequest.mockResolvedValueOnce({ room_id: "!abc:ex", max_lifetime: 1000 });

            await manager.getRoomRetentionPolicy("!abc:ex");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/retention/policy/!abc%3Aex",
                undefined,
                undefined,
                { prefix: "/_synapse/admin/v1" },
            );
        });
    });

    describe("setRoomRetentionPolicy", () => {
        it("rejects empty roomId", async () => {
            await expect(manager.setRoomRetentionPolicy("", {})).rejects.toBeInstanceOf(InvalidParamError);
        });

        it("emits retentionPolicyUpdated on success", async () => {
            authedRequest.mockResolvedValueOnce({ room_id: "!r:ex", max_lifetime: 1000 });
            const emitted: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("retentionPolicyUpdated" as any, (p: unknown) => emitted.push(p));

            await manager.setRoomRetentionPolicy("!r:ex", { max_lifetime: 1000 });

            expect(emitted).toHaveLength(1);
            expect(emitted[0]).toMatchObject({ roomId: "!r:ex" });
        });

        it("FT-108: sends is_expire_on_clients (not expire_on_clients) to admin API", async () => {
            authedRequest.mockResolvedValueOnce({ room_id: "!r:ex", max_lifetime: 1000 });

            await manager.setRoomRetentionPolicy("!r:ex", { is_expire_on_clients: true });

            const body = authedRequest.mock.calls[0][3];
            expect(body).toHaveProperty("is_expire_on_clients", true);
            expect(body).not.toHaveProperty("expire_on_clients");
        });
    });

    describe("runRetention", () => {
        it("sends empty body when no roomId", async () => {
            authedRequest.mockResolvedValueOnce({ started: true });

            await manager.runRetention();

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/retention/run",
                undefined,
                {},
                { prefix: "/_synapse/admin/v1" },
            );
        });

        it("includes room_id when given, and emits retentionRunCompleted", async () => {
            authedRequest.mockResolvedValueOnce({ started: true, events_deleted: 5 });
            const emitted: unknown[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.on("retentionRunCompleted" as any, (p: unknown) => emitted.push(p));

            await manager.runRetention("!r:ex");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/retention/run",
                undefined,
                { room_id: "!r:ex" },
                { prefix: "/_synapse/admin/v1" },
            );
            expect(emitted).toHaveLength(1);
        });

        it("propagates 429 typed errors", async () => {
            const err = Object.assign(new Error("Rate"), {
                httpStatus: 429,
                errcode: "M_LIMIT_EXCEEDED",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.runRetention()).rejects.toMatchObject({
                httpStatus: 429,
            });
        });
    });

    describe("getRetentionStatus", () => {
        it("GETs /retention/status", async () => {
            authedRequest.mockResolvedValueOnce({ server_policy_enabled: true });

            await manager.getRetentionStatus();

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/retention/status", undefined, undefined, {
                prefix: "/_synapse/admin/v1",
            });
        });
    });

    describe("local-state helpers", () => {
        it("getRoomRetentionState returns disabled when room not found", () => {
            getRoom.mockReturnValueOnce(null);
            expect(manager.getRoomRetentionState("!x:e")).toEqual({ enabled: false });
        });

        it("getRoomRetentionState returns policy when m.room.retention is present", () => {
            getRoom.mockReturnValueOnce({
                currentState: {
                    getStateEvents: vi.fn().mockReturnValue({ getContent: () => ({ max_lifetime: 5000 }) }),
                },
            });
            expect(manager.getRoomRetentionState("!x:e")).toEqual({
                enabled: true,
                policy: { max_lifetime: 5000 },
            });
        });

        it("isMessageWithinRetention returns true when no policy", () => {
            getRoom.mockReturnValueOnce(null);
            expect(manager.isMessageWithinRetention("!x:e", Date.now())).toBe(true);
        });

        it("getMessageRemainingLifetime returns null when no policy", () => {
            getRoom.mockReturnValueOnce(null);
            expect(manager.getMessageRemainingLifetime("!x:e", Date.now())).toBeNull();
        });

        it("getAllRoomRetentionPolicies aggregates across rooms", () => {
            getRooms.mockReturnValueOnce([{ roomId: "!a:e" }, { roomId: "!b:e" }]);
            getRoom.mockImplementation((id: string) =>
                id === "!a:e"
                    ? {
                          currentState: {
                              getStateEvents: () => ({ getContent: () => ({ max_lifetime: 1 }) }),
                          },
                      }
                    : null,
            );

            expect(manager.getAllRoomRetentionPolicies()).toEqual({
                "!a:e": { max_lifetime: 1 },
            });
        });
    });
});
