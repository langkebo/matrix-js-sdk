import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThirdPartyManager } from "../../src/thirdparty/index.ts";

describe("ThirdPartyManager", () => {
    let thirdPartyManager: ThirdPartyManager;
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            getThirdpartyProtocols: vi.fn(),
            getThirdpartyLocation: vi.fn(),
            getThirdpartyUser: vi.fn(),
        };
        thirdPartyManager = new ThirdPartyManager(mockClient);
    });

    it("returns protocols successfully", async () => {
        mockClient.getThirdpartyProtocols.mockResolvedValueOnce({
            irc: { instances: [], location_fields: [], user_fields: [] },
        });

        await expect(thirdPartyManager.getProtocols()).resolves.toEqual([
            {
                protocol: "irc",
                instances: [],
                location_fields: [],
                user_fields: [],
            },
        ]);
    });

    it("throws by default when fetching protocols fails", async () => {
        mockClient.getThirdpartyProtocols.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.getProtocols()).rejects.toBeInstanceOf(Error);
    });

    it("returns an empty list when protocol fallback mode is enabled", async () => {
        mockClient.getThirdpartyProtocols.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.getProtocols(false)).resolves.toEqual([]);
    });

    it("throws by default when fetching a single protocol fails", async () => {
        mockClient.getThirdpartyProtocols.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.getProtocol("irc")).rejects.toBeInstanceOf(Error);
    });

    it("returns null when single protocol fallback mode is enabled", async () => {
        mockClient.getThirdpartyProtocols.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.getProtocol("irc", false)).resolves.toBeNull();
    });

    it("throws by default when searching locations fails", async () => {
        mockClient.getThirdpartyLocation.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.searchLocations("irc", { alias: "#room:example.com" })).rejects.toBeInstanceOf(
            Error,
        );
    });

    it("returns an empty list when location search fallback mode is enabled", async () => {
        mockClient.getThirdpartyLocation.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.searchLocations("irc", { alias: "#room:example.com" }, false)).resolves.toEqual(
            [],
        );
    });

    it("throws by default when searching users fails", async () => {
        mockClient.getThirdpartyUser.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.searchUsers("irc", { userid: "@alice:example.com" })).rejects.toBeInstanceOf(
            Error,
        );
    });

    it("returns an empty list when user search fallback mode is enabled", async () => {
        mockClient.getThirdpartyUser.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.searchUsers("irc", { userid: "@alice:example.com" }, false)).resolves.toEqual(
            [],
        );
    });
});
