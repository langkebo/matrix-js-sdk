import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { ClientPrefix } from "../../src/http-api/prefix.ts";
import { UserDirectoryManager } from "../../src/user-directory/index.ts";

describe("UserDirectoryManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let searchUserDirectory: ReturnType<typeof vi.fn>;
    let getUser: ReturnType<typeof vi.fn>;
    let getUsers: ReturnType<typeof vi.fn>;
    let manager: UserDirectoryManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        searchUserDirectory = vi.fn();
        getUser = vi.fn();
        getUsers = vi.fn();
        manager = new UserDirectoryManager({
            http: { authedRequest },
            searchUserDirectory,
            getUser,
            getUsers,
            // explicitly absent so getProfile takes the http branch
            getProfileManager: undefined,
        } as any);
    });

    it("delegates searchUserDirectory to the client with term + limit", async () => {
        searchUserDirectory.mockResolvedValueOnce({ results: [], limited: false });

        await manager.searchUserDirectory("alice", 10);

        expect(searchUserDirectory).toHaveBeenCalledWith({ term: "alice", limit: 10 });
    });

    it("falls back to /profile when no ProfileManager is wired", async () => {
        authedRequest.mockResolvedValueOnce({ displayname: "Alice" });

        await expect(manager.getProfile("@alice:example.com")).resolves.toEqual({
            displayname: "Alice",
        });
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/profile/%40alice%3Aexample.com",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("propagates 404 errors from the profile fallback", async () => {
        const httpError = Object.assign(new Error("Not Found"), {
            httpStatus: 404,
            errcode: "M_NOT_FOUND",
        });
        authedRequest.mockRejectedValueOnce(httpError);

        await expect(manager.getProfile("@missing:example.com")).rejects.toMatchObject({
            httpStatus: 404,
            errcode: "M_NOT_FOUND",
        });
    });

    it("prefers the ProfileManager when the client exposes one", async () => {
        const getProfileInfo = vi.fn().mockResolvedValueOnce({ displayname: "Alice" });
        const m = new UserDirectoryManager({
            http: { authedRequest },
            getProfileManager: () => ({ getProfileInfo }),
        } as any);

        await expect(m.getProfile("@alice:example.com")).resolves.toEqual({
            displayname: "Alice",
        });
        expect(getProfileInfo).toHaveBeenCalledWith("@alice:example.com");
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("looks up users by display name from the client cache", () => {
        getUsers.mockReturnValue([{ displayName: "Alice" }, { displayName: "Bob" }]);
        expect(manager.getUserByDisplayName("Alice")).toEqual({ displayName: "Alice" });
        expect(manager.getUserByDisplayName("Charlie")).toBeUndefined();
    });
});
