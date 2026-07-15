import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { UserDirectoryManager } from "../../src/user-directory/index.ts";

describe("UserDirectoryManager", () => {
    let request: ReturnType<typeof vi.fn>;
    let searchUserDirectory: ReturnType<typeof vi.fn>;
    let getUser: ReturnType<typeof vi.fn>;
    let getUsers: ReturnType<typeof vi.fn>;
    let manager: UserDirectoryManager;

    beforeEach(() => {
        request = vi.fn();
        searchUserDirectory = vi.fn();
        getUser = vi.fn();
        getUsers = vi.fn();
        manager = new UserDirectoryManager({
            http: { request },
            searchUserDirectory,
            getUser,
            getUsers,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    });

    it("delegates searchUserDirectory to the client with term + limit", async () => {
        searchUserDirectory.mockResolvedValueOnce({ results: [], limited: false });

        await manager.searchUserDirectory("alice", 10);

        expect(searchUserDirectory).toHaveBeenCalledWith({ term: "alice", limit: 10 });
    });

    it("lists user directory via POST /user_directory/list", async () => {
        request.mockResolvedValueOnce({ users: [{ user_id: "@alice:example.com" }] });

        await expect(manager.listUserDirectory()).resolves.toEqual({
            users: [{ user_id: "@alice:example.com" }],
        });
        expect(request).toHaveBeenCalledWith(Method.Post, "/user_directory/list");
    });

    it("fetches user directory profile directly", async () => {
        request.mockResolvedValueOnce({ displayname: "Alice" });

        await expect(manager.getProfile("@alice:example.com")).resolves.toEqual({
            displayname: "Alice",
        });
        expect(request).toHaveBeenCalledWith(Method.Get, "/user_directory/profiles/%40alice%3Aexample.com");
    });

    it("propagates 404 errors from the user directory profile endpoint", async () => {
        const httpError = Object.assign(new Error("Not Found"), {
            httpStatus: 404,
            errcode: "M_NOT_FOUND",
        });
        request.mockRejectedValueOnce(httpError);

        await expect(manager.getProfile("@missing:example.com")).rejects.toMatchObject({
            httpStatus: 404,
            errcode: "M_NOT_FOUND",
        });
    });

    it("delegates getUser to the client cache lookup", () => {
        getUser.mockReturnValue({ userId: "@alice:example.com" });

        expect(manager.getUser("@alice:example.com")).toEqual({ userId: "@alice:example.com" });
        expect(getUser).toHaveBeenCalledWith("@alice:example.com");
    });

    it("delegates getUsers to the client cache lookup", () => {
        getUsers.mockReturnValue([{ displayName: "Alice" }, { displayName: "Bob" }]);

        expect(manager.getUsers()).toEqual([{ displayName: "Alice" }, { displayName: "Bob" }]);
        expect(getUsers).toHaveBeenCalledTimes(1);
    });

    it("looks up users by display name from the client cache", () => {
        getUsers.mockReturnValue([{ displayName: "Alice" }, { displayName: "Bob" }]);
        expect(manager.getUserByDisplayName("Alice")).toEqual({ displayName: "Alice" });
        expect(manager.getUserByDisplayName("Charlie")).toBeUndefined();
    });
});
