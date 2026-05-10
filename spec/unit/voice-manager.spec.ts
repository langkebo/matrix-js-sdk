import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { VoiceEvent, VoiceMessageManager } from "../../src/voice/index.ts";

describe("VoiceMessageManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: VoiceMessageManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        manager = new VoiceMessageManager({ http: { authedRequest } } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("getServerConfig", () => {
        it("GETs /voice/config on ClientPrefix.R0", async () => {
            authedRequest.mockResolvedValueOnce({
                enabled: true,
                max_duration_ms: 300000,
                max_size_bytes: 1024,
                supported_formats: ["audio/ogg"],
            });

            const cfg = await manager.getServerConfig();

            expect(cfg).toEqual({
                enabled: true,
                max_duration_ms: 300000,
                max_size_bytes: 1024,
                supported_formats: ["audio/ogg"],
            });
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/voice/config", undefined, undefined, {
                prefix: "/_matrix/client/r0",
            });
        });

        it("falls back to { enabled: true } on 403 typed errors", async () => {
            const err = Object.assign(new Error("Forbidden"), {
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getServerConfig()).resolves.toEqual({ enabled: true });
        });

        it("falls back to { enabled: true } on 500 errors", async () => {
            authedRequest.mockRejectedValueOnce(Object.assign(new Error("Internal"), { httpStatus: 500 }));

            await expect(manager.getServerConfig()).resolves.toEqual({ enabled: true });
        });
    });

    describe("local session helpers", () => {
        it("createRecordingSession emits SessionCreated and tracks session", () => {
            const emitted: unknown[] = [];
            manager.on(VoiceEvent.SessionCreated, (sid, rid) => emitted.push({ sid, rid }));

            const sessionId = manager.createRecordingSession("!r:e");

            expect(sessionId).toMatch(/^voice_/);
            expect(emitted).toHaveLength(1);
            expect(manager.getActiveSessions()).toContain(sessionId);
            expect(manager.getSessionInfo(sessionId)).toMatchObject({ roomId: "!r:e" });
        });

        it("endRecordingSession drops the session and emits SessionEnded", () => {
            const sid = manager.createRecordingSession("!r:e");
            const emitted: unknown[] = [];
            manager.on(VoiceEvent.SessionEnded, (s) => emitted.push(s));

            manager.endRecordingSession(sid);

            expect(manager.getSessionInfo(sid)).toBeNull();
            expect(emitted).toEqual([sid]);
        });

        it("setConfig / getConfig round-trip merges values", () => {
            manager.setConfig({ maxDuration: 1234 });
            expect(manager.getConfig().maxDuration).toBe(1234);
            expect(manager.getConfig().enabled).toBe(true);
        });
    });
});
