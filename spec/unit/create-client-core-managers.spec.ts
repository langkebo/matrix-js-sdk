import { afterEach, describe, expect, it } from "vitest";

import { createClient, isManagerExtensionsInitialized } from "../../src/matrix";
import { resetManagerExtensions } from "../../src/manager-extensions";

describe("createClient core manager registration", () => {
    afterEach(() => {
        resetManagerExtensions();
    });

    it("registers account and credentials managers synchronously for login flows", () => {
        const client = createClient({
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "token",
            deviceId: "DEVICE_A",
        });

        expect(typeof client.getAccountManager).toBe("function");
        expect(typeof client.getCredentialsManager).toBe("function");
        expect(client.getAccountManager()).toBeTruthy();
        expect(client.getCredentialsManager()).toBeTruthy();
    });

    it("registers room and profile managers synchronously for immediate room operations", () => {
        const client = createClient({
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "token",
            deviceId: "DEVICE_B",
        });

        expect(typeof client.getRoomManager).toBe("function");
        expect(typeof client.getProfileManager).toBe("function");
        expect(client.getRoomManager()).toBeTruthy();
        expect(client.getProfileManager()).toBeTruthy();
    });

    it("respects disableDynamicExtensions by skipping async extension bootstrap while keeping core managers", () => {
        const client = createClient({
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "token",
            deviceId: "DEVICE_C",
            disableDynamicExtensions: true,
        });

        expect(typeof client.getAccountManager).toBe("function");
        expect(typeof client.getRoomManager).toBe("function");
        expect(typeof client.getCredentialsManager).toBe("function");
        expect(isManagerExtensionsInitialized()).toBe(false);
    });
});
