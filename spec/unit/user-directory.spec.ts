import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method, ClientPrefix } from "../../src/http-api/index.ts";
import { UserDirectoryManager } from "../../src/user-directory/index.ts";

describe("UserDirectoryManager", () => {
    let request: ReturnType<typeof vi.fn>;
    let authedRequest: ReturnType<typeof vi.fn>;
    let searchUserDirectory: ReturnType<typeof vi.fn>;
    let getUser: ReturnType<typeof vi.fn>;
    let getUsers: ReturnType<typeof vi.fn>;
    let manager: UserDirectoryManager;

    beforeEach(() => {
        request = vi.fn();
        authedRequest = vi.fn();
        searchUserDirectory = vi.fn();
        getUser = vi.fn();
        getUsers = vi.fn();
        manager = new UserDirectoryManager({
            http: { request, authedRequest },
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
        authedRequest.mockResolvedValueOnce({ users: [{ user_id: "@alice:example.com" }] });

        await expect(manager.listUserDirectory()).resolves.toEqual({
            users: [{ user_id: "@alice:example.com" }],
        });
        expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/user_directory/list", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("fetches user directory profile directly", async () => {
        authedRequest.mockResolvedValueOnce({ displayname: "Alice" });

        await expect(manager.getProfile("@alice:example.com")).resolves.toEqual({
            displayname: "Alice",
        });
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/user_directory/profiles/%40alice%3Aexample.com",
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("propagates 404 errors from the user directory profile endpoint", async () => {
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

    it("listUserDirectoryPaginated passes limit and since as request body", async () => {
        authedRequest.mockResolvedValueOnce({
            users: [{ user_id: "@alice:server" }],
            next_batch: "next123",
        });

        const result = await manager.listUserDirectoryPaginated(50, "cursor123");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/user_directory/list",
            undefined,
            { limit: 50, since: "cursor123" },
            { prefix: ClientPrefix.V3 },
        );
        expect(result.users).toHaveLength(1);
        expect(result.next_batch).toBe("next123");
    });

    it("listUserDirectoryPaginated normalizes results array to users", async () => {
        authedRequest.mockResolvedValueOnce({
            results: [{ user_id: "@bob:server", display_name: "Bob" }],
            next_batch: "next456",
        });

        const result = await manager.listUserDirectoryPaginated(10);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/user_directory/list",
            undefined,
            { limit: 10 },
            { prefix: ClientPrefix.V3 },
        );
        expect(result.users).toEqual([{ user_id: "@bob:server", display_name: "Bob" }]);
        expect(result.next_batch).toBe("next456");
    });

    it("listUserDirectoryPaginated sends empty body when no params given", async () => {
        authedRequest.mockResolvedValueOnce({ users: [] });

        const result = await manager.listUserDirectoryPaginated();

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/user_directory/list",
            undefined,
            {},
            { prefix: ClientPrefix.V3 },
        );
        expect(result.users).toEqual([]);
        expect(result.next_batch).toBeUndefined();
    });

    it("listUserDirectoryPaginated tolerates missing users and results arrays", async () => {
        authedRequest.mockResolvedValueOnce({ next_batch: "next789" });

        const result = await manager.listUserDirectoryPaginated(undefined, "cursor");

        expect(result.users).toEqual([]);
        expect(result.next_batch).toBe("next789");
    });
});
