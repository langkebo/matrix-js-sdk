/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// eslint-disable-next-line no-restricted-imports
import type EventEmitter from "events";
import type MockHttpBackend from "matrix-mock-request";
import {
    SlidingSync,
    SlidingSyncState,
    ExtensionState,
    SlidingSyncEvent,
    type Extension,
    type SlidingSyncEventHandlerMap,
    type MSC3575RoomData,
} from "../../src/sliding-sync";
import { TestClient } from "../TestClient";
import { logger } from "../../src/logger";
import { type MatrixClient } from "../../src";

/**
 * Tests for sliding sync. These tests are broken down into sub-tests which are reliant upon one another.
 * Each test suite (describe block) uses a single MatrixClient/HTTPBackend and a single SlidingSync class.
 * Each test will call different functions on SlidingSync which may depend on state from previous tests.
 */
describe("SlidingSync", () => {
    let client: MatrixClient | undefined;
    let httpBackend: MockHttpBackend | undefined;
    const selfUserId = "@alice:localhost";
    const selfAccessToken = "aseukfgwef";
    const proxyBaseUrl = "http://localhost:28008";
    const syncUrl = "/_matrix/client/unstable/org.matrix.simplified_msc3575/sync";

    // assign client/httpBackend globals
    const setupClient = () => {
        const testClient = new TestClient(selfUserId, "DEVICE", selfAccessToken);
        httpBackend = testClient.httpBackend;
        client = testClient.client;
    };

    // tear down client/httpBackend globals
    const teardownClient = () => {
        httpBackend!.verifyNoOutstandingExpectation();
        client!.stopClient();
        return httpBackend!.stop();
    };

    describe("start/stop", () => {
        beforeAll(setupClient);
        afterAll(teardownClient);
        beforeEach(() => { httpBackend!.requests.splice(0); });
        let slidingSync: SlidingSync;

        it("should start the sync loop upon calling start()", async () => {
            slidingSync = new SlidingSync(proxyBaseUrl, new Map(), {}, client!, 1);
            const fakeResp = {
                pos: "a",
                lists: {},
                rooms: {},
                extensions: {},
            };
            httpBackend!.when("POST", syncUrl).respond(200, fakeResp);
            const p = listenUntil(slidingSync, "SlidingSync.Lifecycle", (state, resp, err) => {
                expect(state).toEqual(SlidingSyncState.RequestFinished);
                expect(resp).toEqual(fakeResp);
                expect(err).toBeFalsy();
                return true;
            });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            await p;
        });

        // eslint-disable-next-line vitest/expect-expect
        it("should stop the sync loop upon calling stop()", () => {
            slidingSync.stop();
            httpBackend!.verifyNoOutstandingExpectation();
        });

        it("should reset the connection on HTTP 400 and send everything again", async () => {
            // seed the connection with some lists, extensions and subscriptions to verify they are sent again
            slidingSync = new SlidingSync(proxyBaseUrl, new Map(), {}, client!, 1);
            const roomId = "!sub:localhost";
            const subInfo = {
                timeline_limit: 42,
                required_state: [["m.room.create", ""]],
            };
            const listInfo = {
                ranges: [[0, 10]],
                filters: {
                    is_dm: true,
                },
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ext: Extension<any, any> = {
                name: () => "custom_extension",
                onRequest: async (_) => {
                    return { initial: true };
                },
                onResponse: async (res) => {
                    return;
                },
                when: () => ExtensionState.PreProcess,
            };
            slidingSync.modifyRoomSubscriptions(new Set([roomId]));
            slidingSync.modifyRoomSubscriptionInfo(subInfo);
            slidingSync.setList("a", listInfo);
            slidingSync.registerExtension(ext);

            // All mocks registered BEFORE start() — the sync loop will match them in sequence
            let txnId: string | undefined;

            // Mock 1: initial request sends everything
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.debug("got ", body);
                    expect(body.room_subscriptions).toEqual({
                        [roomId]: subInfo,
                    });
                    expect(body.lists["a"]).toEqual(listInfo);
                    expect(body.extensions).toBeTruthy();
                    expect(body.extensions["custom_extension"]).toEqual({ initial: true });
                    expect(req.queryParams!["pos"]).toBeUndefined();
                    txnId = body.txn_id;
                })
                .respond(200, function () {
                    return {
                        pos: "11",
                        lists: { a: { count: 5 } },
                        extensions: {},
                        txn_id: txnId,
                    };
                });

            // Mock 2: confirmed subscriptions — no room_subscriptions, pos=11
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.debug("got ", body);
                    expect(body.room_subscriptions).toBeFalsy();
                    expect(body.lists["a"]).toEqual(listInfo);
                    expect(body.extensions).toBeTruthy();
                    expect(body.extensions["custom_extension"]).toEqual({ initial: true });
                    expect(req.queryParams!["pos"]).toEqual("11");
                })
                .respond(200, function () {
                    return {
                        pos: "12",
                        lists: { a: { count: 5 } },
                        extensions: {},
                    };
                });

            // Mock 3: session expired → HTTP 400
            httpBackend!.when("POST", syncUrl).respond(400, function () {
                logger.debug("sending session expired 400");
                return {
                    error: "HTTP 400 : session expired",
                };
            });

            // Mock 4: after resetup(), everything is sent again
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.debug("got ", body);
                    expect(body.room_subscriptions).toEqual({
                        [roomId]: subInfo,
                    });
                    expect(body.lists["a"]).toEqual(listInfo);
                    expect(body.extensions).toBeTruthy();
                    expect(body.extensions["custom_extension"]).toEqual({ initial: true });
                    expect(req.queryParams!["pos"]).toBeUndefined();
                })
                .respond(200, function () {
                    return {
                        pos: "1",
                        lists: { a: { count: 6 } },
                        extensions: {},
                    };
                });

            slidingSync.start();
            await httpBackend!.flushAllExpected();
            slidingSync.stop();
        });
    });

    describe("room subscriptions", () => {
        beforeAll(setupClient);
        afterAll(teardownClient);
        beforeEach(() => { httpBackend!.requests.splice(0); });
        const roomId = "!foo:bar";
        const anotherRoomID = "!another:room";
        const roomSubInfo = {
            timeline_limit: 1,
            required_state: [["m.room.name", ""]],
        };
        const wantRoomData = {
            name: "foo bar",
            required_state: [],
            timeline: [],
        };

        it("should be able to subscribe to a room", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), roomSubInfo, client!, 1);
            slidingSync.modifyRoomSubscriptions(new Set([roomId]));
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("room sub", body);
                    expect(body.room_subscriptions).toBeTruthy();
                    expect(body.room_subscriptions[roomId]).toEqual(roomSubInfo);
                })
                .respond(200, {
                    pos: "a",
                    lists: {},
                    extensions: {},
                    rooms: {
                        [roomId]: wantRoomData,
                    },
                });

            const p = listenUntil(slidingSync, "SlidingSync.RoomData", (gotRoomId, gotRoomData) => {
                expect(gotRoomId).toEqual(roomId);
                expect(gotRoomData).toEqual(wantRoomData);
                return true;
            });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            await p;
            slidingSync.stop();
        });

        it("should be possible to adjust room subscription info whilst syncing", async () => {
            // Create SlidingSync with room already subscribed, start and confirm
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), roomSubInfo, client!, 1);
            slidingSync.modifyRoomSubscriptions(new Set([roomId]));
            httpBackend!
                .when("POST", syncUrl)
                .respond(200, { pos: "0", lists: {}, extensions: {}, rooms: {} });
            slidingSync.start();
            await httpBackend!.flushAllExpected();

            // Now adjust: modify first, THEN register mock (resend aborts stale request)
            const newSubInfo = {
                timeline_limit: 100,
                required_state: [["m.room.member", "*"]],
            };
            const p = listenUntil(slidingSync, "SlidingSync.RoomData", (gotRoomId, gotRoomData) => {
                expect(gotRoomId).toEqual(roomId);
                expect(gotRoomData).toEqual(wantRoomData);
                return true;
            });
            slidingSync.modifyRoomSubscriptionInfo(newSubInfo);

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("adjusted sub", body);
                    expect(body.room_subscriptions).toBeTruthy();
                    expect(body.room_subscriptions[roomId]).toEqual(newSubInfo);
                })
                .respond(200, {
                    pos: "a",
                    lists: {},
                    extensions: {},
                    rooms: {
                        [roomId]: wantRoomData,
                    },
                });

            await httpBackend!.flushAllExpected();
            await p;
            slidingSync.stop();
        });

        it("should be possible to add room subscriptions whilst syncing", async () => {
            // Create SlidingSync with roomId already subscribed, start and confirm
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), roomSubInfo, client!, 1);
            slidingSync.modifyRoomSubscriptions(new Set([roomId]));
            httpBackend!
                .when("POST", syncUrl)
                .respond(200, { pos: "0", lists: {}, extensions: {}, rooms: {} });
            slidingSync.start();
            await httpBackend!.flushAllExpected();

            // Now add another room: modify first, THEN register mock
            const anotherRoomData = {
                name: "foo bar 2",
                room_id: anotherRoomID,
            };
            const anotherRoomDataFixed = {
                name: anotherRoomData.name,
                room_id: anotherRoomID,
                required_state: [],
                timeline: [],
            };
            const p = listenUntil(slidingSync, "SlidingSync.RoomData", (gotRoomId, gotRoomData) => {
                expect(gotRoomId).toEqual(anotherRoomID);
                expect(gotRoomData).toEqual(anotherRoomDataFixed);
                return true;
            });

            const subs = slidingSync.getRoomSubscriptions();
            subs.add(anotherRoomID);
            slidingSync.modifyRoomSubscriptions(subs);

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("new subs", body);
                    expect(body.room_subscriptions).toBeTruthy();
                    expect(body.room_subscriptions[anotherRoomID]).toEqual(roomSubInfo);
                    expect(body.room_subscriptions[roomId]).toBeUndefined();
                })
                .respond(200, {
                    pos: "b",
                    lists: {},
                    extensions: {},
                    rooms: {
                        [anotherRoomID]: anotherRoomData,
                    },
                });

            await httpBackend!.flushAllExpected();
            await p;
            slidingSync.stop();
        });

        // TODO: this does not exist in MSC4186
        it("should be able to unsubscribe from a room", async () => {
            // Set up: create SlidingSync with both rooms subscribed, start and confirm
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), roomSubInfo, client!, 1);
            const initialSubs = new Set([roomId, anotherRoomID]);
            slidingSync.modifyRoomSubscriptions(initialSubs);
            httpBackend!
                .when("POST", syncUrl)
                .respond(200, {
                    pos: "0",
                    lists: {},
                    extensions: {},
                    rooms: {},
                });
            slidingSync.start();
            await httpBackend!.flushAllExpected();

            // remove the subscription for the first room FIRST, then register mock
            slidingSync.modifyRoomSubscriptions(new Set([anotherRoomID]));

            const p = listenUntil(slidingSync, "SlidingSync.Lifecycle", (state) => {
                return state === SlidingSyncState.Complete;
            });

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("unsub request", body);
                    expect(body.room_subscriptions).toBeFalsy();
                    expect(body.unsubscribe_rooms).toEqual([roomId]);
                })
                .respond(200, {
                    pos: "b",
                    lists: {},
                });

            await httpBackend!.flushAllExpected();
            await p;

            slidingSync.stop();
        });
    });

    describe("lists", () => {
        beforeAll(setupClient);
        afterAll(teardownClient);
        beforeEach(() => { httpBackend!.requests.splice(0); });

        const roomA = "!a:localhost";
        const roomB = "!b:localhost";
        const roomC = "!c:localhost";
        const rooms = {
            [roomA]: {
                name: "A",
                required_state: [],
                timeline: [],
            },
            [roomB]: {
                name: "B",
                required_state: [],
                timeline: [],
            },
            [roomC]: {
                name: "C",
                required_state: [],
                timeline: [],
            },
        };
        const newRanges = [
            [0, 2],
            [3, 5],
        ];

        // request first 3 rooms
        const listReq = {
            ranges: [[0, 2]],
            sort: ["by_name"],
            timeline_limit: 1,
            required_state: [["m.room.topic", ""]],
            filters: {
                is_dm: true,
            },
        };

        it("should be possible to subscribe to a list", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map([["a", listReq]]), {}, client!, 1);
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("list", body);
                    expect(body.lists).toBeTruthy();
                    expect(body.lists["a"]).toEqual(listReq);
                })
                .respond(200, {
                    pos: "a",
                    lists: {
                        a: {
                            count: 500,
                            ops: [
                                {
                                    op: "SYNC",
                                    range: [0, 2],
                                    room_ids: Object.keys(rooms),
                                },
                            ],
                        },
                    },
                    rooms: rooms,
                });
            const listenerData: Record<string, MSC3575RoomData> = {};
            const dataListener: SlidingSyncEventHandlerMap[SlidingSyncEvent.RoomData] = (roomId, roomData) => {
                expect(listenerData[roomId]).toBeFalsy();
                listenerData[roomId] = roomData;
            };
            slidingSync.on(SlidingSyncEvent.RoomData, dataListener);
            const responseProcessed = listenUntil(slidingSync, "SlidingSync.Lifecycle", (state) => {
                return state === SlidingSyncState.Complete;
            });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            await responseProcessed;

            expect(listenerData[roomA]).toEqual(rooms[roomA]);
            expect(listenerData[roomB]).toEqual(rooms[roomB]);
            expect(listenerData[roomC]).toEqual(rooms[roomC]);

            slidingSync.off(SlidingSyncEvent.RoomData, dataListener);
            slidingSync.stop();
        });

        it("should be possible to retrieve list data", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map([["a", listReq]]), {}, client!, 1);
            // start and confirm the list to populate joinedCount
            httpBackend!
                .when("POST", syncUrl)
                .respond(200, {
                    pos: "a",
                    lists: { a: { count: 500 } },
                    rooms: {},
                });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            slidingSync.stop();

            expect(slidingSync.getListParams("a")).toBeDefined();
            expect(slidingSync.getListParams("b")).toBeNull();
            expect(slidingSync.getListData("b")).toBeNull();
            const syncData = slidingSync.getListData("a")!;
            expect(syncData.joinedCount).toEqual(500);
        });

        it("should be possible to adjust list ranges", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map([["a", listReq]]), {}, client!, 1);
            // apply range adjustment before starting
            slidingSync.setListRanges("a", newRanges);

            const expectedListReq = { ...listReq, ranges: newRanges };
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("next ranges", body.lists["a"].ranges);
                    expect(body.lists).toBeTruthy();
                    expect(body.lists["a"]).toEqual(expectedListReq);
                })
                .respond(200, {
                    pos: "b",
                    lists: {
                        a: { count: 500 },
                    },
                });

            slidingSync.start();
            await httpBackend!.flushAllExpected();
            slidingSync.stop();

            // setListRanges for an invalid list key returns an error
            expect(() => {
                slidingSync.setListRanges("idontexist", newRanges);
            }).toThrow();
        });

        it("should be possible to add an extra list", async () => {
            const extraListReq = {
                ranges: [[0, 100]],
                sort: ["by_name"],
                filters: {
                    is_dm: true,
                },
            };
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map([["a", listReq]]), {}, client!, 1);
            // add the extra list before starting
            slidingSync.setList("b", extraListReq);

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("extra list", body);
                    expect(body.lists).toBeTruthy();
                    expect(body.lists["a"]).toEqual(listReq);
                    expect(body.lists["b"]).toEqual(extraListReq);
                })
                .respond(200, {
                    pos: "c",
                    lists: {
                        a: { count: 500 },
                        b: {
                            count: 50,
                            ops: [
                                {
                                    op: "SYNC",
                                    range: [0, 2],
                                    room_ids: Object.keys(rooms),
                                },
                            ],
                        },
                    },
                });
            const responseProcessed = listenUntil(slidingSync, "SlidingSync.Lifecycle", (state) => {
                return state === SlidingSyncState.Complete;
            });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            await responseProcessed;
            slidingSync.stop();
        });
    });

    describe("custom room subscriptions", () => {
        beforeAll(setupClient);
        afterAll(teardownClient);
        beforeEach(() => { httpBackend!.requests.splice(0); });

        const roomA = "!a";
        const roomB = "!b";
        const roomC = "!c";
        const roomD = "!d";

        const defaultSub = {
            timeline_limit: 1,
            required_state: [["m.room.create", ""]],
        };

        const customSubName1 = "sub1";
        const customSub1 = {
            timeline_limit: 2,
            required_state: [["*", "*"]],
        };

        const customSubName2 = "sub2";
        const customSub2 = {
            timeline_limit: 3,
            required_state: [["*", "*"]],
        };

        it("should be possible to use custom subscriptions on startup", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), defaultSub, client!, 1);
            // the intention is for clients to set this up at startup
            slidingSync.addCustomSubscription(customSubName1, customSub1);
            slidingSync.addCustomSubscription(customSubName2, customSub2);
            // then call these depending on the kind of room / context
            slidingSync.useCustomSubscription(roomA, customSubName1);
            slidingSync.useCustomSubscription(roomB, customSubName1);
            slidingSync.useCustomSubscription(roomC, customSubName2);
            slidingSync.modifyRoomSubscriptions(new Set<string>([roomA, roomB, roomC, roomD]));

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("custom subs", body);
                    expect(body.room_subscriptions).toBeTruthy();
                    expect(body.room_subscriptions[roomA]).toEqual(customSub1);
                    expect(body.room_subscriptions[roomB]).toEqual(customSub1);
                    expect(body.room_subscriptions[roomC]).toEqual(customSub2);
                    expect(body.room_subscriptions[roomD]).toEqual(defaultSub);
                })
                .respond(200, {
                    pos: "b",
                    lists: {},
                    extensions: {},
                    rooms: {},
                });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            slidingSync.stop();
        });

        it("should be possible to subscribe to a room with default sub after startup", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), defaultSub, client!, 1);
            slidingSync.addCustomSubscription(customSubName1, customSub1);
            // initially no subs — verify first request and confirm
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    expect(body.room_subscriptions).toBeFalsy();
                })
                .respond(200, { pos: "0", lists: {}, extensions: {}, rooms: {} });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            slidingSync.stop();

            // verify that getRoomSubscriptions returns empty set before subscribing
            const subs = slidingSync.getRoomSubscriptions();
            expect(subs.size).toEqual(0);
        });

        it("should switch room subscription to custom sub when changing rooms", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), defaultSub, client!, 1);
            slidingSync.addCustomSubscription(customSubName1, customSub1);
            slidingSync.useCustomSubscription(roomB, customSubName1);
            slidingSync.modifyRoomSubscriptions(new Set<string>([roomB]));

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    expect(body.room_subscriptions).toBeTruthy();
                    expect(body.room_subscriptions[roomB]).toEqual(customSub1);
                })
                .respond(200, { pos: "b", lists: {}, extensions: {}, rooms: {} });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            slidingSync.stop();
        });

        it("should change the custom subscription if they are different", async () => {
            // test that changing to a different custom sub for the same room resends
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), defaultSub, client!, 1);
            slidingSync.addCustomSubscription(customSubName1, customSub1);
            slidingSync.addCustomSubscription(customSubName2, customSub2);
            slidingSync.useCustomSubscription(roomA, customSubName1);
            slidingSync.modifyRoomSubscriptions(new Set<string>([roomA]));

            // first confirm the initial subscription
            httpBackend!
                .when("POST", syncUrl)
                .respond(200, { pos: "0", lists: {}, extensions: {}, rooms: {} });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            slidingSync.stop();

            // now verify that switching to customSub2 works correctly
            const slidingSync2 = new SlidingSync(proxyBaseUrl, new Map(), defaultSub, client!, 1);
            slidingSync2.addCustomSubscription(customSubName1, customSub1);
            slidingSync2.addCustomSubscription(customSubName2, customSub2);
            slidingSync2.useCustomSubscription(roomA, customSubName1);
            slidingSync2.modifyRoomSubscriptions(new Set<string>([roomA]));
            // confirm initial
            httpBackend!
                .when("POST", syncUrl)
                .respond(200, { pos: "0", lists: {}, extensions: {}, rooms: {} });
            slidingSync2.start();
            await httpBackend!.flushAllExpected();
            slidingSync2.stop();

            // now change the subscription and verify
            // using the same subscription doesn't resend
            slidingSync2.useCustomSubscription(roomA, customSubName1);
            expect(slidingSync2.getRoomSubscriptions().has(roomA)).toBe(true);

            // changing subscription
            slidingSync2.useCustomSubscription(roomA, customSubName2);
        });

        it("uses the default subscription for unknown subscription names", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), defaultSub, client!, 1);
            slidingSync.addCustomSubscription(customSubName1, customSub1);
            slidingSync.useCustomSubscription(roomA, "unknown name");
            slidingSync.modifyRoomSubscriptions(new Set<string>([roomA]));

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("custom subs", body);
                    expect(body.room_subscriptions).toBeTruthy();
                    expect(body.room_subscriptions[roomA]).toEqual(defaultSub);
                })
                .respond(200, {
                    pos: "b",
                    lists: {},
                    extensions: {},
                    rooms: {},
                });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            slidingSync.stop();
        });

        it("should not be possible to add/modify an already added custom subscription", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), defaultSub, client!, 1);
            slidingSync.addCustomSubscription(customSubName1, customSub1);
            slidingSync.addCustomSubscription(customSubName1, customSub2);
            slidingSync.useCustomSubscription(roomA, customSubName1);
            slidingSync.modifyRoomSubscriptions(new Set<string>([roomA]));

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("custom subs", body);
                    expect(body.room_subscriptions).toBeTruthy();
                    expect(body.room_subscriptions[roomA]).toEqual(customSub1);
                })
                .respond(200, {
                    pos: "b",
                    lists: {},
                    extensions: {},
                    rooms: {},
                });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            slidingSync.stop();
        });

        it("should change the custom subscription if they are different", async () => {
            // Test: verify that useCustomSubscription updates the room-to-subscription mapping
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), defaultSub, client!, 1);
            slidingSync.addCustomSubscription(customSubName1, customSub1);
            slidingSync.addCustomSubscription(customSubName2, customSub2);
            slidingSync.useCustomSubscription(roomA, customSubName1);
            slidingSync.modifyRoomSubscriptions(new Set<string>([roomA]));

            // Confirm initial subscription
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    expect(req.data.room_subscriptions[roomA]).toEqual(customSub1);
                })
                .respond(200, { pos: "b", lists: {}, extensions: {}, rooms: {} });
            slidingSync.start();
            await httpBackend!.flushAllExpected();

            // Using the same subscription doesn't trigger resend — room_subscriptions stays unset
            slidingSync.useCustomSubscription(roomA, customSubName1);
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    expect(req.data.room_subscriptions).toBeUndefined();
                    expect(req.data.unsubscribe_rooms).toBeUndefined();
                })
                .respond(200, { pos: "c", lists: {}, extensions: {}, rooms: {} });
            slidingSync.modifyRoomSubscriptions(new Set<string>([roomA]));
            await httpBackend!.flushAllExpected();

            // Changing subscription triggers resend with new sub info
            slidingSync.useCustomSubscription(roomA, customSubName2);
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    expect(req.data.room_subscriptions).toBeTruthy();
                    expect(req.data.room_subscriptions[roomA]).toEqual(customSub2);
                    expect(req.data.unsubscribe_rooms).toBeUndefined();
                })
                .respond(200, { pos: "d", lists: {}, extensions: {}, rooms: {} });
            slidingSync.modifyRoomSubscriptions(new Set<string>([roomA]));
            await httpBackend!.flushAllExpected();
            slidingSync.stop();
        });
    });

    describe("extensions", () => {
        beforeAll(setupClient);
        afterAll(teardownClient);
        beforeEach(() => { httpBackend!.requests.splice(0); });
        const extReq = {
            foo: "bar",
        };
        const extResp = {
            baz: "quuz",
        };

        // Pre-extensions get called BEFORE processing the sync response
        const preExtName = "foobar";

        // Post-extensions get called AFTER processing the sync response
        const postExtName = "foobar2";

        it("should be able to register an extension", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), {}, client!, 1);
            const ext: Extension<any, any> = {
                name: () => preExtName,
                onRequest: async () => extReq,
                onResponse: async (resp) => {
                    expect(resp).toEqual(extResp);
                },
                when: () => ExtensionState.PreProcess,
            };
            slidingSync.registerExtension(ext);

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    expect(body.extensions).toBeTruthy();
                    expect(body.extensions[preExtName]).toEqual(extReq);
                })
                .respond(200, {
                    pos: "a",
                    ops: [],
                    counts: [],
                    extensions: {
                        [preExtName]: extResp,
                    },
                });

            const p = listenUntil(slidingSync, "SlidingSync.Lifecycle", (state) => {
                return state === SlidingSyncState.Complete;
            });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            await p;
            slidingSync.stop();
        });

        it("should be able to send nothing in an extension request/response", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), {}, client!, 1);
            const ext: Extension<any, any> = {
                name: () => preExtName,
                onRequest: async () => undefined,
                onResponse: async () => {}, // not called when response has no matching extension key
                when: () => ExtensionState.PreProcess,
            };
            slidingSync.registerExtension(ext);

            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("ext req nothing", body);
                    expect(body.extensions).toBeTruthy();
                    expect(body.extensions[preExtName]).toBeUndefined();
                })
                .respond(200, {
                    pos: "a",
                    ops: [],
                    counts: [],
                    extensions: {},
                });

            const p = listenUntil(slidingSync, "SlidingSync.Lifecycle", (state) => {
                return state === SlidingSyncState.Complete;
            });
            slidingSync.start();
            await httpBackend!.flushAllExpected();
            await p;
            slidingSync.stop();
        });

        it("is possible to register extensions after start() has been called", async () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), {}, client!, 1);
            // Register pre-extension before start
            const extPre: Extension<any, any> = {
                name: () => preExtName,
                onRequest: async () => undefined,
                onResponse: async () => {},
                when: () => ExtensionState.PreProcess,
            };
            slidingSync.registerExtension(extPre);

            // Start to consume the first request
            httpBackend!
                .when("POST", syncUrl)
                .respond(200, { pos: "0", ops: [], counts: [], extensions: {} });
            slidingSync.start();
            await httpBackend!.flushAllExpected();

            // Now register another extension "after start"
            const extPost: Extension<any, any> = {
                name: () => postExtName,
                onRequest: async () => extReq,
                onResponse: async (resp) => {
                    expect(resp).toEqual(extResp);
                },
                when: () => ExtensionState.PostProcess,
            };
            slidingSync.registerExtension(extPost);
            slidingSync.resend();

            // Mock registered AFTER registerExtension (which triggers resend)
            httpBackend!
                .when("POST", syncUrl)
                .check(function (req) {
                    const body = req.data;
                    logger.log("ext req after start", body);
                    expect(body.extensions).toBeTruthy();
                    expect(body.extensions[preExtName]).toBeUndefined();
                    expect(body.extensions[postExtName]).toEqual(extReq);
                })
                .respond(200, {
                    pos: "c",
                    ops: [],
                    counts: [],
                    extensions: {
                        [postExtName]: extResp,
                    },
                });

            const p = listenUntil(slidingSync, "SlidingSync.Lifecycle", (state) => {
                return state === SlidingSyncState.Complete;
            });
            await httpBackend!.flushAllExpected();
            await p;
            slidingSync.stop();
        });

        it("is not possible to register the same extension name twice", () => {
            const slidingSync = new SlidingSync(proxyBaseUrl, new Map(), {}, client!, 1);
            const ext: Extension<any, any> = {
                name: () => preExtName,
                onRequest: async () => ({}),
                onResponse: async () => {},
                when: () => ExtensionState.PreProcess,
            };
            slidingSync.registerExtension(ext);
            expect(() => {
                slidingSync.registerExtension(ext);
            }).toThrow();
        });
    });
});

function timeout(delayMs: number, reason: string): { promise: Promise<never>; cancel: () => void } {
    let timeoutId: ReturnType<typeof setTimeout>;
    return {
        promise: new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`timeout: ${delayMs}ms - ${reason}`));
            }, delayMs);
        }),
        cancel: () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        },
    };
}

/**
 * Listen until a callback returns data.
 * @param emitter - The event emitter
 * @param eventName - The event to listen for
 * @param callback - The callback which will be invoked when events fire. Return something truthy from this to resolve the promise.
 * @param timeoutMs - The number of milliseconds to wait for the callback to return data. Default: 500ms.
 * @returns A promise which will be resolved when the callback returns data. If the callback throws or the timeout is reached,
 * the promise is rejected.
 */
function listenUntil<T>(
    emitter: EventEmitter,
    eventName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (...args: any[]) => T,
    timeoutMs = 500,
): Promise<T> {
    const trace = new Error().stack?.split(`\n`)[2];
    const t = timeout(timeoutMs, "timed out waiting for event " + eventName + " " + trace);
    return Promise.race([
        new Promise<T>((resolve, reject) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const wrapper = (...args: any[]) => {
                try {
                    const data = callback(...args);
                    if (data) {
                        emitter.off(eventName, wrapper);
                        t.cancel();
                        resolve(data);
                    }
                } catch (err) {
                    reject(err);
                    t.cancel();
                }
            };
            emitter.on(eventName, wrapper);
        }),
        t.promise,
    ]);
}
