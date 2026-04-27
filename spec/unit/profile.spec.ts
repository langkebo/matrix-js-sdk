import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileEvent, ProfileManager } from "../../src/profile/index.ts";
import { Method } from "../../src/http-api/index.ts";

describe("ProfileManager", () => {
    let profileManager: ProfileManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        profileManager = new ProfileManager({
            http: {
                authedRequest: mockAuthedRequest,
            },
            credentials: {
                userId: "@alice:example.com",
            },
            getUserId: () => "@alice:example.com",
            getUser: () => null,
            getHomeserverUrl: () => "https://example.com",
        } as any);
    });

    it("uses the dedicated displayname endpoint and reuses the cached field", async () => {
        mockAuthedRequest.mockResolvedValueOnce({ displayname: "Bob" });

        await expect(profileManager.getDisplayName("@bob:example.com")).resolves.toBe("Bob");
        await expect(profileManager.getDisplayName("@bob:example.com")).resolves.toBe("Bob");

        expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
        expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/profile/%40bob%3Aexample.com/displayname");
    });

    it("uses the dedicated avatar_url endpoint and reuses the cached field", async () => {
        mockAuthedRequest.mockResolvedValueOnce({ avatar_url: "mxc://example.com/avatar" });

        await expect(profileManager.getAvatarUrl("@bob:example.com")).resolves.toBe("mxc://example.com/avatar");
        await expect(profileManager.getAvatarUrl("@bob:example.com")).resolves.toBe("mxc://example.com/avatar");

        expect(mockAuthedRequest).toHaveBeenCalledTimes(1);
        expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/profile/%40bob%3Aexample.com/avatar_url");
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

        expect(mockAuthedRequest).toHaveBeenNthCalledWith(1, Method.Get, "/profile/%40bob%3Aexample.com/displayname");
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(2, Method.Get, "/profile/%40bob%3Aexample.com");
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
        expect(mockAuthedRequest).toHaveBeenCalledWith(Method.Get, "/profile/%40bob%3Aexample.com");
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
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(1, Method.Get, "/profile/%40bob%3Aexample.com/displayname");
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(2, Method.Get, "/profile/%40bob%3Aexample.com/avatar_url");
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
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(1, Method.Get, "/profile/%40bob%3Aexample.com");
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(2, Method.Get, "/profile/%40bob%3Aexample.com/displayname");
        expect(mockAuthedRequest).toHaveBeenNthCalledWith(3, Method.Get, "/profile/%40bob%3Aexample.com");
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
        );
        expect(updatedSpy).toHaveBeenCalledWith("@alice:example.com", { displayname: "Alice Updated" });
    });
});
