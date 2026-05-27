import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThirdPartyManager } from "../../src/third-party/index.ts";
import { Method } from "../../src/http-api";
import { ClientPrefix } from "../../src/http-api/prefix";

describe("ThirdPartyManager", () => {
    let thirdPartyManager: ThirdPartyManager;
    let mockClient: any;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        thirdPartyManager = new ThirdPartyManager(mockClient);
    });

    it("returns protocols successfully", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce({
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
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.getProtocols()).rejects.toBeInstanceOf(Error);
    });

    it("returns an empty list when protocol fallback mode is enabled", async () => {
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.getProtocols(false)).resolves.toEqual([]);
    });

    it("throws by default when fetching a single protocol fails", async () => {
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.getProtocol("irc")).rejects.toBeInstanceOf(Error);
    });

    it("returns null when single protocol fallback mode is enabled", async () => {
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.getProtocol("irc", false)).resolves.toBeNull();
    });

    it("fetches a single protocol through the dedicated protocol route", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce({
            instances: [],
            location_fields: ["alias"],
            user_fields: ["userid"],
        });

        await expect(thirdPartyManager.getProtocol("irc")).resolves.toEqual({
            protocol: "irc",
            instances: [],
            location_fields: ["alias"],
            user_fields: ["userid"],
        });

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/thirdparty/protocol/irc",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("throws by default when searching locations fails", async () => {
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.searchLocations("irc", { alias: "#room:example.com" })).rejects.toBeInstanceOf(
            Error,
        );
    });

    it("returns an empty list when location search fallback mode is enabled", async () => {
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.searchLocations("irc", { alias: "#room:example.com" }, false)).resolves.toEqual(
            [],
        );
    });

    it("throws by default when searching users fails", async () => {
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.searchUsers("irc", { userid: "@alice:example.com" })).rejects.toBeInstanceOf(
            Error,
        );
    });

    it("returns an empty list when user search fallback mode is enabled", async () => {
        mockClient.http.authedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(thirdPartyManager.searchUsers("irc", { userid: "@alice:example.com" }, false)).resolves.toEqual(
            [],
        );
    });

    it("searches all locations through the v3 generic route", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce([
            { alias: "#room:example.com", protocol: "irc", fields: { network: "freenode" } },
        ]);

        await expect(thirdPartyManager.searchAllLocations({ alias: "#room:example.com" })).resolves.toEqual([
            { alias: "#room:example.com", protocol: "irc", fields: { network: "freenode" } },
        ]);

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/thirdparty/location",
            { alias: "#room:example.com" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("searches all users through the v3 generic route", async () => {
        mockClient.http.authedRequest.mockResolvedValueOnce([
            { userid: "@alice:example.com", protocol: "irc", fields: { nick: "alice" } },
        ]);

        await expect(thirdPartyManager.searchAllUsers({ userid: "@alice:example.com" })).resolves.toEqual([
            { userid: "@alice:example.com", protocol: "irc", fields: { nick: "alice" } },
        ]);

        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/thirdparty/user",
            { userid: "@alice:example.com" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("returns empty arrays for generic searches in fallback mode", async () => {
        mockClient.http.authedRequest.mockRejectedValue(new Error("boom"));

        await expect(thirdPartyManager.searchAllLocations({ alias: "#room:example.com" }, false)).resolves.toEqual([]);
        await expect(thirdPartyManager.searchAllUsers({ userid: "@alice:example.com" }, false)).resolves.toEqual([]);
    });
});
