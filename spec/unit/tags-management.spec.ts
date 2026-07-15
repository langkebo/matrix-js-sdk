import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method, ClientPrefix } from "../../src/http-api/index.ts";
import { TagsManager } from "../../src/tags-management/index.ts";

describe("TagsManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let getRoomTagsStub: ReturnType<typeof vi.fn>;
    let getRoomAccountDataStub: ReturnType<typeof vi.fn>;
    let manager: TagsManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        getRoomTagsStub = vi.fn();
        getRoomAccountDataStub = vi.fn();
        manager = new TagsManager({
            http: { authedRequest },
            credentials: { userId: "@alice:example.com" },
            getRoom: vi.fn().mockImplementation((roomId: string) => ({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tags: ((getRoomTagsStub as any)(roomId) || []).reduce(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (acc: any, t: string) => ({ ...acc, [t]: {} }),
                    {},
                ),
                getAccountData: (type: string) => ({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    getContent: () => (getRoomAccountDataStub as any)(roomId, type),
                }),
            })),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("getRoomTags", () => {
        it("delegates to the client's room object", () => {
            getRoomTagsStub.mockReturnValue(["m.favourite", "u.custom"]);
            expect(manager.getRoomTags("!room:example.com")).toEqual(["m.favourite", "u.custom"]);
            expect(getRoomTagsStub).toHaveBeenCalledWith("!room:example.com");
        });
    });

    describe("getRoomAccountData", () => {
        it("delegates to the client's room object", () => {
            getRoomAccountDataStub.mockReturnValue({ hidden: true });
            expect(manager.getRoomAccountData("!room:example.com", "m.hidden")).toEqual({ hidden: true });
        });
    });

    describe("setRoomAccountData", () => {
        it("PUTs to the /user/$userId/rooms/$roomId/account_data/$type path", async () => {
            authedRequest.mockResolvedValueOnce({});

            await manager.setRoomAccountData("!room:example.com", "m.hidden", { hidden: true });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/%40alice%3Aexample.com/rooms/!room%3Aexample.com/account_data/m.hidden",
                undefined,
                { hidden: true },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("propagates 400 errors", async () => {
            authedRequest.mockRejectedValueOnce(
                Object.assign(new Error("Bad Request"), { httpStatus: 400, errcode: "M_INVALID_PARAM" }),
            );

            await expect(manager.setRoomAccountData("!room:example.com", "m.hidden", {})).rejects.toMatchObject({
                httpStatus: 400,
                errcode: "M_INVALID_PARAM",
            });
        });
    });

    describe("addRoomTag", () => {
        it("PUTs to the room tag path with content (defaults to empty object)", async () => {
            authedRequest.mockResolvedValueOnce({});

            await manager.addRoomTag("!room:example.com", "m.favourite");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/%40alice%3Aexample.com/rooms/!room%3Aexample.com/tags/m.favourite",
                undefined,
                {},
                { prefix: ClientPrefix.V3 },
            );
        });

        it("forwards the optional content payload", async () => {
            authedRequest.mockResolvedValueOnce({});

            await manager.addRoomTag("!room:example.com", "u.work", { order: 0.5 });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/user/%40alice%3Aexample.com/rooms/!room%3Aexample.com/tags/u.work",
                undefined,
                { order: 0.5 },
                { prefix: ClientPrefix.V3 },
            );
        });

        it("propagates 403 errors", async () => {
            authedRequest.mockRejectedValueOnce(
                Object.assign(new Error("Forbidden"), { httpStatus: 403, errcode: "M_FORBIDDEN" }),
            );

            await expect(manager.addRoomTag("!room:example.com", "m.favourite")).rejects.toMatchObject({
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
        });
    });

    describe("removeRoomTag", () => {
        it("DELETEs the room tag path", async () => {
            authedRequest.mockResolvedValueOnce({});

            await manager.removeRoomTag("!room:example.com", "m.favourite");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/user/%40alice%3Aexample.com/rooms/!room%3Aexample.com/tags/m.favourite",
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 },
            );
        });

        it("propagates 404 errors", async () => {
            authedRequest.mockRejectedValueOnce(
                Object.assign(new Error("Not Found"), { httpStatus: 404, errcode: "M_NOT_FOUND" }),
            );

            await expect(manager.removeRoomTag("!room:example.com", "missing")).rejects.toMatchObject({
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
        });
    });
});
