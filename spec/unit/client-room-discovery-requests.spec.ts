import {
    buildRoomHierarchyPath,
    buildTimestampToEventPath,
    buildRoomHierarchyQuery,
    getRoomHierarchyRequest,
    timestampToEventRequest,
} from "../../src/client-room-discovery-requests";
import { ClientPrefix, Method } from "../../src/http-api";
import { Direction } from "../../src/models/event-timeline";

describe("client-room-discovery-requests", () => {
    const mockAuthedRequest = vi.fn();

    beforeEach(() => {
        mockAuthedRequest.mockReset();
    });

    describe("Path builders", () => {
        it("buildRoomHierarchyPath encodes roomId correctly", () => {
            const roomId = "!room:example.com";
            const path = buildRoomHierarchyPath(roomId);
            expect(path).toBe("/rooms/!room%3Aexample.com/hierarchy");
        });

        it("buildTimestampToEventPath encodes roomId correctly", () => {
            const roomId = "!room:example.com";
            const path = buildTimestampToEventPath(roomId);
            expect(path).toBe("/rooms/!room%3Aexample.com/timestamp_to_event");
        });
    });

    describe("buildRoomHierarchyQuery", () => {
        it("should return default query with only suggested_only", () => {
            const query = buildRoomHierarchyQuery();
            expect(query).toEqual({
                suggested_only: "false",
                max_depth: undefined,
                from: undefined,
                limit: undefined,
            });
        });

        it("should include all parameters when provided", () => {
            const query = buildRoomHierarchyQuery(50, 3, true, "next_token");
            expect(query).toEqual({
                suggested_only: "true",
                max_depth: "3",
                from: "next_token",
                limit: "50",
            });
        });

        it("should convert numbers to strings", () => {
            const query = buildRoomHierarchyQuery(100, 5);
            expect(query.max_depth).toBe("5");
            expect(query.limit).toBe("100");
        });
    });

    describe("getRoomHierarchyRequest", () => {
        it("should call authedRequest with correct params for v1 prefix", async () => {
            const roomId = "!room:example.com";
            mockAuthedRequest.mockResolvedValue({ chunk: [] });

            await getRoomHierarchyRequest(roomId, 20, 2, true, "token", mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/hierarchy",
                {
                    suggested_only: "true",
                    max_depth: "2",
                    from: "token",
                    limit: "20",
                },
                undefined,
                { prefix: ClientPrefix.V1 }
            );
        });

        it("should fallback to unstable MSC2946 prefix on M_UNRECOGNIZED", async () => {
            const roomId = "!room:example.com";
            const matrixErr = {
                errcode: "M_UNRECOGNIZED",
                httpStatus: 404,
            };
            mockAuthedRequest
                .mockRejectedValueOnce(matrixErr)
                .mockResolvedValueOnce({ chunk: [] });

            await getRoomHierarchyRequest(roomId, undefined, undefined, false, undefined, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledTimes(2);
            expect(mockAuthedRequest).toHaveBeenLastCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/hierarchy",
                {
                    suggested_only: "false",
                    max_depth: undefined,
                    from: undefined,
                    limit: undefined,
                },
                undefined,
                { prefix: "/_matrix/client/unstable/org.matrix.msc2946" }
            );
        });

        it("should rethrow non-M_UNRECOGNIZED errors", async () => {
            const roomId = "!room:example.com";
            const matrixErr = {
                errcode: "M_FORBIDDEN",
                httpStatus: 403,
            };
            mockAuthedRequest.mockRejectedValue(matrixErr);

            await expect(
                getRoomHierarchyRequest(roomId, undefined, undefined, false, undefined, mockAuthedRequest)
            ).rejects.toEqual(matrixErr);
        });
    });

    describe("timestampToEventRequest", () => {
        it("should call authedRequest with correct params for v1 prefix", async () => {
            const roomId = "!room:example.com";
            const timestamp = 1609459200000;
            mockAuthedRequest.mockResolvedValue({ event_id: "$event:example.com" });

            await timestampToEventRequest(roomId, timestamp, Direction.Forward, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/timestamp_to_event",
                {
                    ts: "1609459200000",
                    dir: Direction.Forward,
                },
                undefined,
                { prefix: ClientPrefix.V1 }
            );
        });

        it("should fallback to unstable MSC3030 prefix on M_UNRECOGNIZED with 400/404/405", async () => {
            const roomId = "!room:example.com";
            const timestamp = 1609459200000;
            const matrixErr = {
                errcode: "M_UNRECOGNIZED",
                httpStatus: 400,
            };
            mockAuthedRequest
                .mockRejectedValueOnce(matrixErr)
                .mockResolvedValueOnce({ event_id: "$event:example.com" });

            await timestampToEventRequest(roomId, timestamp, Direction.Backward, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledTimes(2);
            expect(mockAuthedRequest).toHaveBeenLastCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/timestamp_to_event",
                {
                    ts: "1609459200000",
                    dir: Direction.Backward,
                },
                undefined,
                { prefix: "/_matrix/client/unstable/org.matrix.msc3030" }
            );
        });

        it("should not fallback on other error codes", async () => {
            const roomId = "!room:example.com";
            const timestamp = 1609459200000;
            const matrixErr = {
                errcode: "M_NOT_FOUND",
                httpStatus: 404,
            };
            mockAuthedRequest.mockRejectedValue(matrixErr);

            await expect(
                timestampToEventRequest(roomId, timestamp, Direction.Forward, mockAuthedRequest)
            ).rejects.toEqual(matrixErr);
        });

        it("should not fallback on non-M_UNRECOGNIZED errors", async () => {
            const roomId = "!room:example.com";
            const timestamp = 1609459200000;
            const matrixErr = {
                errcode: "M_FORBIDDEN",
                httpStatus: 403,
            };
            mockAuthedRequest.mockRejectedValue(matrixErr);

            await expect(
                timestampToEventRequest(roomId, timestamp, Direction.Forward, mockAuthedRequest)
            ).rejects.toEqual(matrixErr);
        });
    });

    describe("Edge cases", () => {
        it("should handle empty roomId in path builders", () => {
            expect(buildRoomHierarchyPath("")).toBe("/rooms//hierarchy");
            expect(buildTimestampToEventPath("")).toBe("/rooms//timestamp_to_event");
        });

        it("should handle zero timestamp", async () => {
            const roomId = "!room:example.com";
            mockAuthedRequest.mockResolvedValue({ event_id: "$event:example.com" });

            await timestampToEventRequest(roomId, 0, Direction.Forward, mockAuthedRequest);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/timestamp_to_event",
                {
                    ts: "0",
                    dir: Direction.Forward,
                },
                undefined,
                { prefix: ClientPrefix.V1 }
            );
        });
    });
});
