/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi } from "vitest";

import {
    buildSendToDevicePath,
    buildSendToDeviceBody,
    sendToDeviceRequest,
    type SendToDeviceOptions,
    type SendToDeviceDeps,
} from "../../src/client-to-device.ts";
import { Method } from "../../src/http-api/method.ts";

describe("client-to-device", () => {
    describe("buildSendToDevicePath", () => {
        it("should build correct path with event type and txn id", () => {
            const path = buildSendToDevicePath("m.room.encrypted", "txn123");
            expect(path).toBe("/sendToDevice/m.room.encrypted/txn123");
        });

        it("should handle special characters in event type", () => {
            const path = buildSendToDevicePath("m.custom.event", "txn456");
            expect(path).toBe("/sendToDevice/m.custom.event/txn456");
        });
    });

    describe("buildSendToDeviceBody", () => {
        it("should build body from content map", () => {
            const contentMap = new Map([
                ["@user1:server", new Map([["DEVICE1", { key: "value1" }]])],
                ["@user2:server", new Map([["DEVICE2", { key: "value2" }]])],
            ]);

            const { body, targets } = buildSendToDeviceBody(contentMap);

            expect(body).toEqual({
                messages: {
                    "@user1:server": { DEVICE1: { key: "value1" } },
                    "@user2:server": { DEVICE2: { key: "value2" } },
                },
            });

            expect(targets.get("@user1:server")).toEqual(["DEVICE1"]);
            expect(targets.get("@user2:server")).toEqual(["DEVICE2"]);
        });

        it("should handle multiple devices per user", () => {
            const contentMap = new Map([
                [
                    "@user:server",
                    new Map([
                        ["DEVICE1", { key: "value1" }],
                        ["DEVICE2", { key: "value2" }],
                    ]),
                ],
            ]);

            const { body, targets } = buildSendToDeviceBody(contentMap);

            expect(body.messages["@user:server"]).toEqual({
                DEVICE1: { key: "value1" },
                DEVICE2: { key: "value2" },
            });

            expect(targets.get("@user:server")).toEqual(["DEVICE1", "DEVICE2"]);
        });

        it("should handle empty content map", () => {
            const contentMap = new Map();

            const { body, targets } = buildSendToDeviceBody(contentMap);

            expect(body).toEqual({ messages: {} });
            expect(targets.size).toBe(0);
        });
    });

    describe("sendToDeviceRequest", () => {
        it("should send request with generated txn id", async () => {
            const mockAuthedRequest = vi.fn().mockResolvedValue({});
            const mockLogger = { debug: vi.fn() };

            const deps: SendToDeviceDeps = {
                authedRequest: mockAuthedRequest,
                logger: mockLogger,
            };

            const contentMap = new Map([["@user:server", new Map([["DEVICE1", { key: "value" }]])]]);

            const options: SendToDeviceOptions = {
                eventType: "m.room.encrypted",
                contentMap,
                makeTxnId: () => "generated-txn-id",
            };

            const result = await sendToDeviceRequest(options, deps);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/sendToDevice/m.room.encrypted/generated-txn-id",
                undefined,
                { messages: { "@user:server": { DEVICE1: { key: "value" } } } },
            );
            expect(mockLogger.debug).toHaveBeenCalled();
            expect(result).toEqual({});
        });

        it("should use provided txn id", async () => {
            const mockAuthedRequest = vi.fn().mockResolvedValue({});
            const mockLogger = { debug: vi.fn() };

            const deps: SendToDeviceDeps = {
                authedRequest: mockAuthedRequest,
                logger: mockLogger,
            };

            const contentMap = new Map([["@user:server", new Map([["DEVICE1", { key: "value" }]])]]);

            const options: SendToDeviceOptions = {
                eventType: "m.room.encrypted",
                contentMap,
                txnId: "provided-txn-id",
                makeTxnId: () => "should-not-be-called",
            };

            await sendToDeviceRequest(options, deps);

            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/sendToDevice/m.room.encrypted/provided-txn-id",
                undefined,
                expect.any(Object),
            );
        });

        it("should log targets", async () => {
            const mockAuthedRequest = vi.fn().mockResolvedValue({});
            const mockLogger = { debug: vi.fn() };

            const deps: SendToDeviceDeps = {
                authedRequest: mockAuthedRequest,
                logger: mockLogger,
            };

            const contentMap = new Map([["@user:server", new Map([["DEVICE1", { key: "value" }]])]]);

            const options: SendToDeviceOptions = {
                eventType: "m.room.encrypted",
                contentMap,
                makeTxnId: () => "txn-id",
            };

            await sendToDeviceRequest(options, deps);

            expect(mockLogger.debug).toHaveBeenCalledWith("PUT /sendToDevice/m.room.encrypted/txn-id", expect.any(Map));
        });
    });
});
