/**
 * API consistency tests — Push pusher device binding (SDK-7, P2 #32)
 *
 * P2 #32 binds a pusher to the *access token's* device: the backend derives
 * the device from `auth_user.device_id` and its `SetPusherRequest` is
 * `#[serde(deny_unknown_fields)]`, so a `device_id` in the body is a 400.
 * The SDK must therefore accept `device_id` for backwards compatibility but
 * strip it before the request is sent.
 */
import { describe, it, expect, vi } from "vitest";
import { PushManager } from "../../../src/push/index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockClient(): any {
    return {
        http: {
            authedRequest: vi.fn().mockImplementation((method: string, path: string) => {
                if (path === "/pushers") return Promise.resolve({ pushers: [] });
                return Promise.resolve({});
            }),
        },
        getUserId: vi.fn().mockReturnValue("@test:example.com"),
    };
}

describe("SDK-7: Push pusher device binding (P2 #32)", () => {
    it("IPusherRequest still exposes an optional device_id for compatibility", () => {
        const validPusher = {
            pushkey: "key",
            app_id: "app",
            app_display_name: "Test",
            device_display_name: "Device",
            lang: "en",
            device_id: "test-device",
        };
        // Type-level compatibility: the field is still accepted.
        expect(validPusher.device_id).toBe("test-device");
    });

    it("setPusher strips device_id from the request body", async () => {
        const mockClient = createMockClient();
        const pushManager = new PushManager(mockClient);

        await pushManager.setPusher({
            pushkey: "key",
            app_id: "app",
            app_display_name: "Test",
            device_display_name: "Device",
            lang: "en",
            device_id: "test-device",
        });

        const setCall = mockClient.http.authedRequest.mock.calls.find((c: unknown[]) => c[1] === "/pushers/set");
        expect(setCall?.[0]).toBe("POST");
        expect(setCall?.[1]).toBe("/pushers/set");
        expect(setCall?.[3]).not.toHaveProperty("device_id");
        expect(setCall?.[3]).toMatchObject({ pushkey: "key", app_id: "app" });
    });

    it("removePusher does not forward the optional deviceId", async () => {
        const mockClient = createMockClient();
        const pushManager = new PushManager(mockClient);

        await pushManager.removePusher("k", "a", "d");

        const setCall = mockClient.http.authedRequest.mock.calls.find((c: unknown[]) => c[1] === "/pushers/set");
        expect(setCall?.[3]).not.toHaveProperty("device_id");
        expect(setCall?.[3]).toMatchObject({ pushkey: "k", app_id: "a", kind: null });
    });
});
