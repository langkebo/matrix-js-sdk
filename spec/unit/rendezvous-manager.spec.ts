import { beforeEach, describe, expect, it, vi } from "vitest";

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

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rendezvous/sess-1",
            {},
            undefined,
            {
                prefix: "/_matrix/client/v1",
                headers: {
                    "X-Matrix-Rendezvous-Key": "rz-key",
                },
            },
        );
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
        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Get,
            "/rendezvous/sess-2",
            {},
            undefined,
            {
                prefix: "/_matrix/client/v1",
                headers: {
                    "X-Matrix-Rendezvous-Key": "poll-key",
                },
            },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Get,
            "/rendezvous/sess-2/messages",
            {},
            undefined,
            {
                prefix: "/_matrix/client/v1",
                headers: {
                    "X-Matrix-Rendezvous-Key": "poll-key",
                },
            },
        );
    });
});
