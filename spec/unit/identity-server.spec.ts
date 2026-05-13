import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityServerManager } from "../../src/identity-server/index.ts";

describe("IdentityServerManager", () => {
    let setIdBaseUrl: ReturnType<typeof vi.fn>;
    let manager: IdentityServerManager;
    let client: any;

    beforeEach(() => {
        setIdBaseUrl = vi.fn();
        client = {
            http: { setIdBaseUrl },
            idBaseUrl: "https://id.example.com",
        };
        manager = new IdentityServerManager(client);
    });

    describe("getIdentityServerUrl", () => {
        it("returns the configured identity server URL", () => {
            expect(manager.getIdentityServerUrl()).toBe("https://id.example.com");
        });

        it("can strip the protocol prefix", () => {
            expect(manager.getIdentityServerUrl(true)).toBe("id.example.com");
        });
    });

    describe("setIdentityServerUrl", () => {
        it("normalizes trailing slashes, updates the http api, and emits a change event", () => {
            const changedSpy = vi.fn();
            manager.on("identity_server_url_changed", changedSpy);

            manager.setIdentityServerUrl("https://identity.example.org/");

            expect(client.idBaseUrl).toBe("https://identity.example.org");
            expect(setIdBaseUrl).toHaveBeenCalledWith("https://identity.example.org");
            expect(changedSpy).toHaveBeenCalledWith("https://identity.example.org/");
        });

        it("supports clearing the configured identity server URL", () => {
            manager.setIdentityServerUrl(undefined);

            expect(client.idBaseUrl).toBeUndefined();
            expect(setIdBaseUrl).toHaveBeenCalledWith(undefined);
        });
    });
});
