import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileEvent, ProfileManager } from "../../src/profile/index.ts";
import { Method, ClientPrefix } from "../../src/http-api/index.ts";

describe("ProfileManager", () => {
    let profileManager: ProfileManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;
    let mockRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockRequest = vi.fn();
        profileManager = new ProfileManager({
            http: {
                authedRequest: mockAuthedRequest,
                request: mockRequest,
            },
            credentials: {
                userId: "@alice:example.com",
            },
            getUserId: () => "@alice:example.com",
            getUser: () => null,
            getHomeserverUrl: () => "https://example.com",
            doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(false),
            isVersionSupported: vi.fn().mockResolvedValue(false),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    });

    it("uses the dedicated displayname endpoint and reuses the cached field", async () => {
        mockAuthedRequest.mockResolvedValueOnce({ displayname: "Bob" });

        await expect(profileManager.getDisplayName("@bob:example.com")).resolves.toBe("Bob");
        await expect(profileManager.getDisplayName("@bob:example.com")).resolves.toBe("Bob");

        expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/profile/%40bob%3Aexample.com/displayname",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("uses the dedicated avatar_url endpoint and reuses the cached field", async () => {
        mockAuthedRequest.mockResolvedValueOnce({ avatar_url: "mxc://example.com/avatar" });

        await expect(profileManager.getAvatarUrl("@bob:example.com")).resolves.toBe("mxc://example.com/avatar");
        await expect(profileManager.getAvatarUrl("@bob:example.com")).resolves.toBe("mxc://example.com/avatar");

        expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/profile/%40bob%3Aexample.com/avatar_url",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("still fetches the full profile when only a partial field is cached", async () => {
        mockAuthedRequest.mockResolvedValueOnce({ displayname: "Bob" });
        mockAuthedRequest.mockResolvedValueOnce({
            displayname: "Bob",
            avatar_url: "mxc://example.com/avatar",
        });

        await expect(profileManager.getDisplayName("@bob:example.com")).resolves.toBe("Bob");
        await expect(profileManager.getProfileInfo("@bob:example.com")).resolves.toEqual({
            displayname: "Bob",
            avatar_url: "mxc://example.com/avatar",
        });

        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Get,
            "/profile/%40bob%3Aexample.com/displayname",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Get,
            "/profile/%40bob%3Aexample.com",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("lets full-profile cache satisfy field readers without extra requests", async () => {
        mockAuthedRequest.mockResolvedValueOnce({
            displayname: "Bob",
            avatar_url: "mxc://example.com/avatar",
        });

        await expect(profileManager.getProfileInfo("@bob:example.com")).resolves.toEqual({
            displayname: "Bob",
            avatar_url: "mxc://example.com/avatar",
        });
        await expect(profileManager.getDisplayName("@bob:example.com")).resolves.toBe("Bob");
        await expect(profileManager.getAvatarUrl("@bob:example.com")).resolves.toBe("mxc://example.com/avatar");

        expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/profile/%40bob%3Aexample.com",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("treats both field caches as a complete profile and avoids an extra full-profile request", async () => {
        mockAuthedRequest.mockResolvedValueOnce({ displayname: "Bob" });
        mockAuthedRequest.mockResolvedValueOnce({ avatar_url: "mxc://example.com/avatar" });

        await expect(profileManager.getDisplayName("@bob:example.com")).resolves.toBe("Bob");
        await expect(profileManager.getAvatarUrl("@bob:example.com")).resolves.toBe("mxc://example.com/avatar");
        await expect(profileManager.getProfileInfo("@bob:example.com")).resolves.toEqual({
            displayname: "Bob",
            avatar_url: "mxc://example.com/avatar",
        });

        expect(mockAuthedRequest).toHaveBeenCalledTimes(2);
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Get,
            "/profile/%40bob%3Aexample.com/displayname",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Get,
            "/profile/%40bob%3Aexample.com/avatar_url",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("does not keep a stale full-profile cache after force-refreshing a single field", async () => {
        mockAuthedRequest.mockResolvedValueOnce({
            displayname: "Bob",
            avatar_url: "mxc://example.com/original-avatar",
        });
        mockAuthedRequest.mockResolvedValueOnce({ displayname: "Bob Updated" });
        mockAuthedRequest.mockResolvedValueOnce({
            displayname: "Bob Updated",
            avatar_url: "mxc://example.com/new-avatar",
        });

        await expect(profileManager.getProfileInfo("@bob:example.com")).resolves.toEqual({
            displayname: "Bob",
            avatar_url: "mxc://example.com/original-avatar",
        });
        await expect(profileManager.getDisplayName("@bob:example.com", true)).resolves.toBe("Bob Updated");
        await expect(profileManager.getProfileInfo("@bob:example.com")).resolves.toEqual({
            displayname: "Bob Updated",
            avatar_url: "mxc://example.com/new-avatar",
        });

        expect(mockAuthedRequest).toHaveBeenCalledTimes(3);
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Get,
            "/profile/%40bob%3Aexample.com",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Get,
            "/profile/%40bob%3Aexample.com/displayname",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(
            3,
            Method.Get,
            "/profile/%40bob%3Aexample.com",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("emits ProfileError when getDisplayName falls back to null after a request failure", async () => {
        const errorSpy = vi.fn();
        profileManager.on(ProfileEvent.ProfileError, errorSpy);
        mockAuthedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(profileManager.getDisplayName("@bob:example.com", false, false)).resolves.toBeNull();

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    });

    it("emits ProfileError and rethrows when getDisplayName uses the default throw behavior", async () => {
        const errorSpy = vi.fn();
        profileManager.on(ProfileEvent.ProfileError, errorSpy);
        mockAuthedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(profileManager.getDisplayName("@bob:example.com")).rejects.toBeInstanceOf(Error);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    });

    it("emits ProfileError and rethrows when getAvatarUrl uses the default throw behavior", async () => {
        const errorSpy = vi.fn();
        profileManager.on(ProfileEvent.ProfileError, errorSpy);
        mockAuthedRequest.mockRejectedValueOnce(new Error("boom"));

        await expect(profileManager.getAvatarUrl("@bob:example.com")).rejects.toBeInstanceOf(Error);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    });

    it("updates the current-user cache and emits ProfileUpdated after setDisplayName", async () => {
        const updatedSpy = vi.fn();
        profileManager.on(ProfileEvent.ProfileUpdated, updatedSpy);
        mockAuthedRequest.mockResolvedValueOnce({});

        await expect(profileManager.setDisplayName("Alice Updated")).resolves.toEqual({});
        await expect(profileManager.getDisplayName("@alice:example.com")).resolves.toBe("Alice Updated");

        expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
        expect(mockAuthedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/profile/%40alice%3Aexample.com/displayname",
            undefined,
            { displayname: "Alice Updated" },
            { prefix: ClientPrefix.V3 },
        );
        expect(updatedSpy).toHaveBeenCalledWith("@alice:example.com", { displayname: "Alice Updated" });
    });

    describe("setExtendedProfilePropertyForUser / deleteExtendedProfilePropertyForUser", () => {
        const unstableMSC4133Prefix = "/_matrix/client/unstable/uk.tcpip.msc4133";

        beforeEach(() => {
            // Configure the server to support MSC4133 (unstable) so that
            // assertExtendedProfileSupport() passes and the unstable prefix is selected.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (profileManager as any).client.doesServerSupportUnstableFeature.mockImplementation((feature: string) =>
                Promise.resolve(feature === "uk.tcpip.msc4133"),
            );
        });

        it("setExtendedProfilePropertyForUser sends the raw value for an arbitrary userId", async () => {
            mockAuthedRequest.mockResolvedValueOnce({});

            await profileManager.setExtendedProfilePropertyForUser("@bob:server", "custom_field", "my_value");

            // The body must be the raw value, NOT wrapped as { custom_field: "my_value" }.
            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/profile/%40bob%3Aserver/custom_field",
                undefined,
                "my_value",
                { prefix: unstableMSC4133Prefix },
            );
        });

        it("setExtendedProfilePropertyForUser sends raw object values without wrapping", async () => {
            mockAuthedRequest.mockResolvedValueOnce({});
            const rawObject = { nested: { value: 42 }, list: [1, 2, 3] };

            await profileManager.setExtendedProfilePropertyForUser("@bob:server", "custom_field", rawObject);

            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/profile/%40bob%3Aserver/custom_field",
                undefined,
                rawObject,
                { prefix: unstableMSC4133Prefix },
            );
        });

        it("deleteExtendedProfilePropertyForUser deletes for an arbitrary userId", async () => {
            mockAuthedRequest.mockResolvedValueOnce({});

            await profileManager.deleteExtendedProfilePropertyForUser("@bob:server", "custom_field");

            expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/profile/%40bob%3Aserver/custom_field",
                undefined,
                undefined,
                { prefix: unstableMSC4133Prefix },
            );
        });

        it("throws when the server does not support extended profiles", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (profileManager as any).client.doesServerSupportUnstableFeature.mockResolvedValue(false);

            await expect(
                profileManager.setExtendedProfilePropertyForUser("@bob:server", "custom_field", "my_value"),
            ).rejects.toThrow("Server does not support extended profiles");
            await expect(
                profileManager.deleteExtendedProfilePropertyForUser("@bob:server", "custom_field"),
            ).rejects.toThrow("Server does not support extended profiles");
            expect(mockAuthedRequest).not.toHaveBeenCalled();
        });
    });
});
