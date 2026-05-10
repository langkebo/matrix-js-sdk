import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { VoIPCallsManager } from "../../src/voip-calls/index.ts";
import { InvalidParamError } from "../../src/common/errors.ts";

describe("VoIPCallsManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let createCall: ReturnType<typeof vi.fn>;
    let setSupportsCallTransfer: ReturnType<typeof vi.fn>;
    let manager: VoIPCallsManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        createCall = vi.fn();
        setSupportsCallTransfer = vi.fn();
        manager = new VoIPCallsManager({
            http: { authedRequest },
            createCall,
            setSupportsCallTransfer,
            callEventHandler: { calls: new Map() },
        } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("getTurnServers", () => {
        it("GETs /voip/turnServer on ClientPrefix.R0 and caches the response", async () => {
            authedRequest.mockResolvedValueOnce({
                uris: ["turn:example.com"],
                username: "u",
                password: "p",
                ttl: 3600,
            });
            const emitted: unknown[] = [];
            manager.on("turnServersUpdated" as any, (p: unknown) => emitted.push(p));

            const res = await manager.getTurnServers();
            expect(res.uris).toEqual(["turn:example.com"]);
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/voip/turnServer", undefined, undefined, {
                prefix: "/_matrix/client/r0",
            });
            expect(emitted).toHaveLength(1);

            // Second call should hit the cache, no new HTTP call.
            await manager.getTurnServers();
            expect(authedRequest).toHaveBeenCalledTimes(1);
        });

        it("re-fetches after invalidateTurnServerCache", async () => {
            authedRequest.mockResolvedValue({
                uris: [],
                username: "u",
                password: "p",
                ttl: 0,
            });

            await manager.getTurnServers();
            manager.invalidateTurnServerCache();
            await manager.getTurnServers();

            expect(authedRequest).toHaveBeenCalledTimes(2);
        });

        it("propagates 401 typed errors", async () => {
            const err = Object.assign(new Error("Unauthorized"), {
                httpStatus: 401,
                errcode: "M_UNKNOWN_TOKEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getTurnServers()).rejects.toMatchObject({
                httpStatus: 401,
            });
        });
    });

    describe("getVoipConfig", () => {
        it("GETs /voip/config and caches the response", async () => {
            authedRequest.mockResolvedValueOnce({ enabled: true });
            const res = await manager.getVoipConfig();
            expect(res.enabled).toBe(true);

            await manager.getVoipConfig();
            expect(authedRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe("getGuestTurnCredentials", () => {
        it("GETs /voip/turnServer/guest", async () => {
            authedRequest.mockResolvedValueOnce({ uris: [], username: "g", password: "p", ttl: 0 });

            await manager.getGuestTurnCredentials();

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/voip/turnServer/guest", undefined, undefined, {
                prefix: "/_matrix/client/r0",
            });
        });
    });

    describe("getCallSession", () => {
        it("rejects empty roomId / callId", async () => {
            await expect(manager.getCallSession("", "c1")).rejects.toBeInstanceOf(InvalidParamError);
            await expect(manager.getCallSession("!r:e", "")).rejects.toBeInstanceOf(InvalidParamError);
        });

        it("GETs /rooms/{roomId}/call/{callId} with URL-encoded segments", async () => {
            authedRequest.mockResolvedValueOnce({
                call_id: "c1",
                room_id: "!r:e",
                state: "active",
                created_ts: 0,
            });

            await manager.getCallSession("!r:e", "c1");

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/rooms/!r%3Ae/call/c1", undefined, undefined, {
                prefix: "/_matrix/client/r0",
            });
        });

        it("propagates 404 errors", async () => {
            const err = Object.assign(new Error("Not Found"), {
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getCallSession("!r:e", "c1")).rejects.toMatchObject({
                httpStatus: 404,
            });
        });
    });

    describe("local helpers", () => {
        it("createCall rejects empty roomId", () => {
            expect(() => manager.createCall("")).toThrow(InvalidParamError);
        });

        it("createCall delegates to client.createCall", () => {
            createCall.mockReturnValueOnce({ roomId: "!r:e" });
            expect(manager.createCall("!r:e")).toEqual({ roomId: "!r:e" });
            expect(createCall).toHaveBeenCalledWith("!r:e");
        });

        it("setSupportsCallTransfer forwards to client", () => {
            manager.setSupportsCallTransfer(true);
            expect(setSupportsCallTransfer).toHaveBeenCalledWith(true);
        });

        it("getCall / getAllCalls / getCallsForRoom use callEventHandler.calls", () => {
            const calls = new Map<string, any>([
                ["c1", { roomId: "!r:e" }],
                ["c2", { roomId: "!s:e" }],
            ]);
            manager = new VoIPCallsManager({
                http: { authedRequest },
                callEventHandler: { calls },
            } as any);

            expect(manager.getCall("!r:e")).toEqual({ roomId: "!r:e" });
            expect(manager.getAllCalls()).toHaveLength(2);
            expect(manager.getCallsForRoom("!s:e")).toEqual([{ roomId: "!s:e" }]);
        });

        it("getCall rejects empty roomId", () => {
            expect(() => manager.getCall("")).toThrow(InvalidParamError);
        });
    });
});
