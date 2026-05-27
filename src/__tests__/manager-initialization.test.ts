import { afterEach, describe, expect, it } from "vitest";

import { createClient, isManagerExtensionsInitialized } from "../../src/matrix";
import { resetManagerExtensions } from "../../src/manager-extensions";

describe("SDK manager initialization", () => {
    afterEach(() => {
        resetManagerExtensions();
    });

    it("createClient should have getAccountManager on prototype after creation", () => {
        const client = createClient({
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "token",
            deviceId: "DEVICE_MGR_TEST_A",
        });

        expect(typeof client.getAccountManager).toBe("function");
        expect(client.getAccountManager()).toBeTruthy();
    });

    it("createClient should have getDeviceManager on prototype after creation", () => {
        const client = createClient({
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "token",
            deviceId: "DEVICE_MGR_TEST_B",
        });

        expect(typeof client.getDeviceManager).toBe("function");
        expect(client.getDeviceManager()).toBeTruthy();
    });

    it("All synchronous core managers should be available immediately after createClient", () => {
        const client = createClient({
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "token",
            deviceId: "DEVICE_MGR_TEST_C",
        });

        // Synchronous core managers installed by installSynchronousCoreManagerExtensions:
        // Room, Event, Account, AccountData, Auth, Credentials, Device, IdentityServer, Presence, Profile
        expect(typeof client.getRoomManager).toBe("function");
        expect(typeof client.getAccountManager).toBe("function");
        expect(typeof client.getCredentialsManager).toBe("function");
        expect(typeof client.getDeviceManager).toBe("function");
        expect(typeof client.getProfileManager).toBe("function");
        expect(typeof client.getPresenceManager).toBe("function");

        // Verify instances are non-null
        expect(client.getRoomManager()).toBeTruthy();
        expect(client.getAccountManager()).toBeTruthy();
        expect(client.getCredentialsManager()).toBeTruthy();
        expect(client.getDeviceManager()).toBeTruthy()
        expect(client.getProfileManager()).toBeTruthy()
        expect(client.getPresenceManager()).toBeTruthy()

        // Async manager extensions should not be initialized in vitest environment
        expect(isManagerExtensionsInitialized()).toBe(false);
    });
});
