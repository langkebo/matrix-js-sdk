import { describe, it, expect, vi } from "vitest";

import { normalizeExpiresInMs } from "../../src/auth/normalize-expires";
import { AuthManager } from "../../src/auth/index";

type WireAuthResponse = {
    expires_in_ms?: number;
    expires_in?: number;
} & Record<string, unknown>;

describe("normalizeExpiresInMs (ISSUE-05)", () => {
    it("maps expires_in (seconds) to expires_in_ms (milliseconds) when missing", () => {
        const wire: WireAuthResponse = { access_token: "a", refresh_token: "r", expires_in: 3600 };
        const res = normalizeExpiresInMs(wire);
        expect(res.expires_in_ms).toBe(3600 * 1000);
    });

    it("keeps an existing expires_in_ms untouched when both fields are present", () => {
        const res = normalizeExpiresInMs({ expires_in_ms: 1234, expires_in: 3600 });
        expect(res.expires_in_ms).toBe(1234);
    });

    it("leaves responses without expires_in unchanged", () => {
        const res = normalizeExpiresInMs({ access_token: "a" } as WireAuthResponse);
        expect(res.expires_in_ms).toBeUndefined();
    });

    it("ignores non-numeric expires_in", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = normalizeExpiresInMs({ expires_in: "3600" as any } as WireAuthResponse);
        expect(res.expires_in_ms).toBeUndefined();
    });
});

describe("AuthManager.refreshToken expires_in 归一化 (ISSUE-05)", () => {
    it("normalizes the wire expires_in field at the response boundary", async () => {
        const manager = new AuthManager({} as never);
        const requestSpy = vi
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .spyOn(manager as any, "request")
            .mockResolvedValue({ access_token: "a", refresh_token: "r", expires_in: 300 });

        const res = await manager.refreshToken("refresh-token");

        expect(requestSpy).toHaveBeenCalledOnce();
        expect(res.expires_in_ms).toBe(300 * 1000);
    });

    it("passes through an already-normalized expires_in_ms", async () => {
        const manager = new AuthManager({} as never);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(manager as any, "request").mockResolvedValue({
            access_token: "a",
            refresh_token: "r",
            expires_in_ms: 42_000,
        });

        const res = await manager.refreshToken("refresh-token");
        expect(res.expires_in_ms).toBe(42_000);
    });
});
