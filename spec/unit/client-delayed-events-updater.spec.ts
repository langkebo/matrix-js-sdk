import { describe, expect, it, vi } from "vitest";

import { MatrixError } from "../../src/http-api/index.ts";
import {
    updateScheduledDelayedEventWithActionInBody,
    updateScheduledDelayedEventWithFallback,
} from "../../src/client-delayed-events-updater.ts";
import { UpdateDelayedEventAction } from "../../src/@types/requests.ts";

describe("client delayed-events updater helpers", () => {
    it("falls back to body action when path action is unrecognized", async () => {
        const request = vi
            .fn()
            .mockRejectedValueOnce(new MatrixError({ errcode: "M_UNRECOGNIZED" }, 400))
            .mockResolvedValueOnce({});
        const authedRequest = vi.fn();
        const http = { request, authedRequest };

        await expect(
            updateScheduledDelayedEventWithFallback(http, "id", UpdateDelayedEventAction.Cancel, "org.matrix.msc4140"),
        ).resolves.toEqual({});

        expect(request).toHaveBeenNthCalledWith(
            1,
            "POST",
            "/delayed_events/id/cancel",
            undefined,
            undefined,
            expect.objectContaining({ prefix: "/_matrix/client/unstable/org.matrix.msc4140" }),
        );
        expect(request).toHaveBeenNthCalledWith(
            2,
            "POST",
            "/delayed_events/id",
            undefined,
            { action: "cancel" },
            expect.objectContaining({ prefix: "/_matrix/client/unstable/org.matrix.msc4140" }),
        );
    });

    it("falls back to authed request when body update needs token", async () => {
        const request = vi.fn().mockRejectedValueOnce(new MatrixError({ errcode: "M_MISSING_TOKEN" }, 401));
        const authedRequest = vi.fn().mockResolvedValueOnce({});
        const http = { request, authedRequest };

        await expect(
            updateScheduledDelayedEventWithActionInBody(
                http,
                "id",
                UpdateDelayedEventAction.Send,
                "org.matrix.msc4140",
            ),
        ).resolves.toEqual({});

        expect(authedRequest).toHaveBeenCalledWith(
            "POST",
            "/delayed_events/id",
            undefined,
            { action: "send" },
            expect.objectContaining({ prefix: "/_matrix/client/unstable/org.matrix.msc4140" }),
        );
    });
});
