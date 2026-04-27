import { MatrixClient } from "../../src/client";
import { MockHttpBackend } from "../test-utils/mock-http-backend";

describe("MatrixClient typing methods", () => {
    let client: MatrixClient;
    let httpBackend: MockHttpBackend;

    beforeEach(() => {
        httpBackend = new MockHttpBackend();
        client = new MatrixClient({
            baseUrl: "https://example.com",
            userId: "@user:example.com",
            fetchFn: httpBackend.fetchFn as typeof global.fetch,
        });
    });

    afterEach(() => {
        httpBackend.verifyNoOutstandingRequests();
    });

    describe("getRoomTyping", () => {
        it("should get typing users in a room", async () => {
            const roomId = "!room:example.com";
            httpBackend
                .when("GET", "/rooms/!room%3Aexample.com/typing")
                .respond(200, { user_ids: ["@user1:example.com", "@user2:example.com"] });

            const users = await client.getRoomTyping(roomId);
            expect(users).toEqual(["@user1:example.com", "@user2:example.com"]);
        });

        it("should return empty array when no users typing", async () => {
            const roomId = "!room:example.com";
            httpBackend.when("GET", "/rooms/!room%3Aexample.com/typing").respond(200, { user_ids: [] });

            const users = await client.getRoomTyping(roomId);
            expect(users).toEqual([]);
        });
    });

    describe("getBatchTyping", () => {
        it("should get typing users in multiple rooms", async () => {
            const roomIds = ["!room1:example.com", "!room2:example.com"];
            httpBackend.when("POST", "/rooms/typing").respond(200, {
                rooms: {
                    "!room1:example.com": { user_ids: ["@user1:example.com"] },
                    "!room2:example.com": { user_ids: ["@user2:example.com"] },
                },
            });

            const result = await client.getBatchTyping(roomIds);
            expect(result).toEqual({
                "!room1:example.com": ["@user1:example.com"],
                "!room2:example.com": ["@user2:example.com"],
            });
        });
    });

    describe("getAggregations", () => {
        it("should get aggregations for an event", async () => {
            const roomId = "!room:example.com";
            const eventId = "$event:example.com";
            const relType = "m.annotation";

            httpBackend
                .when("GET", "/rooms/!room%3Aexample.com/aggregations/%24event%3Aexample.com/m.annotation")
                .respond(200, {
                    chunk: [
                        { type: "m.reaction", key: "👍", count: 5 },
                        { type: "m.reaction", key: "❤️", count: 3 },
                    ],
                });

            const result = await client.getAggregations(roomId, eventId, relType);
            expect(result.chunk).toHaveLength(2);
            expect(result.chunk[0].count).toBe(5);
        });
    });

    describe("scoreReport", () => {
        it("should score a report", async () => {
            const roomId = "!room:example.com";
            const eventId = "$event:example.com";
            const score = -50;

            httpBackend
                .when("PUT", "/rooms/!room%3Aexample.com/report/%24event%3Aexample.com/score")
                .respond(200, {});

            await client.scoreReport(roomId, eventId, score);
        });
    });

    describe("getScannerInfo", () => {
        it("should get scanner info for a report", async () => {
            const roomId = "!room:example.com";
            const eventId = "$event:example.com";

            httpBackend
                .when("GET", "/rooms/!room%3Aexample.com/report/%24event%3Aexample.com/scanner_info")
                .respond(200, { scanner: "test-scanner", version: "1.0" });

            const result = await client.getScannerInfo(roomId, eventId);
            expect(result.scanner).toBe("test-scanner");
        });
    });
});
