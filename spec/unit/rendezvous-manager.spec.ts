import { beforeEach, describe, expect, it, vi } from "vitest";

import { MatrixError } from "../../src/http-api/errors.ts";
import { Method } from "../../src/http-api/method.ts";
import { RendezvousManager } from "../../src/rendezvous/RendezvousManager.ts";

describe("RendezvousManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: RendezvousManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        manager = new RendezvousManager({
            http: {
                authedRequest,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    });

    it("should forward session key header when reading a session", async () => {
        authedRequest.mockResolvedValueOnce({
            session_id: "sess-1",
            intent: "login.start",
            transport: "http.v1",
            status: "created",
            created_ts: 1,
            expires_at: 2,
        });

        await manager.getSession("sess-1", "rz-key");

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/rendezvous/sess-1", {}, undefined, {
            prefix: "/_matrix/client/v1",
            headers: {
                "X-Matrix-Rendezvous-Key": "rz-key",
            },
        });
    });

    it("should forward session key through pollForMessages", async () => {
        authedRequest
            .mockResolvedValueOnce({
                session_id: "sess-2",
                intent: "login.start",
                transport: "http.v1",
                status: "created",
                created_ts: 1,
                expires_at: 2,
            })
            .mockResolvedValueOnce({
                messages: [{ type: "m.login.progress", content: { stage: "waiting" } }],
            });

        const messages = await manager.pollForMessages("sess-2", {
            sessionKey: "poll-key",
            interval: 0,
            maxAttempts: 1,
        });

        expect(messages).toEqual([{ type: "m.login.progress", content: { stage: "waiting" } }]);
        expect(authedRequest).toHaveBeenNthCalledWith(1, Method.Get, "/rendezvous/sess-2", {}, undefined, {
            prefix: "/_matrix/client/v1",
            headers: {
                "X-Matrix-Rendezvous-Key": "poll-key",
            },
        });
        expect(authedRequest).toHaveBeenNthCalledWith(2, Method.Get, "/rendezvous/sess-2/messages", {}, undefined, {
            prefix: "/_matrix/client/v1",
            headers: {
                "X-Matrix-Rendezvous-Key": "poll-key",
            },
        });
    });

    it("should use the generated-compatible v1 rendezvous paths for create update delete and send", async () => {
        authedRequest
            .mockResolvedValueOnce({ url: "matrix://rendezvous/test/sess-3", session_id: "sess-3", key: "k3" })
            .mockResolvedValueOnce({ session_id: "sess-3", status: "connected" })
            .mockResolvedValueOnce({ session_id: "sess-3", message_id: "m1", sent_ts: 10 })
            .mockResolvedValueOnce(undefined);

        await manager.createSession({ intent: "login.start", transport: "http.v1" });
        await manager.updateSession("sess-3", "connected", "k3");
        await manager.sendMessage("sess-3", { type: "m.login.start", content: {} }, "k3");
        await manager.deleteSession("sess-3", "k3");

        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Post,
            "/rendezvous",
            {},
            { intent: "login.start", transport: "http.v1" },
            { prefix: "/_matrix/client/v1", headers: undefined },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Put,
            "/rendezvous/sess-3",
            {},
            { status: "connected" },
            {
                prefix: "/_matrix/client/v1",
                headers: { "X-Matrix-Rendezvous-Key": "k3" },
            },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            3,
            Method.Post,
            "/rendezvous/sess-3/messages",
            {},
            { type: "m.login.start", content: {} },
            {
                prefix: "/_matrix/client/v1",
                headers: { "X-Matrix-Rendezvous-Key": "k3" },
            },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(4, Method.Delete, "/rendezvous/sess-3", {}, undefined, {
            prefix: "/_matrix/client/v1",
            headers: { "X-Matrix-Rendezvous-Key": "k3" },
        });
    });

    it("should return null when the session is not found", async () => {
        authedRequest.mockRejectedValueOnce(
            new MatrixError({ errcode: "M_NOT_FOUND", error: "Session not found" }, 404),
        );

        await expect(manager.getSession("missing")).resolves.toBeNull();
    });
});
