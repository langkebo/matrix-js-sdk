/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi } from "vitest";

import { getRoomPushRuleRequest, setRoomMutePushRuleRequest } from "../../src/client-push-rules.ts";
import { PushRuleActionName, PushRuleKind, type IPushRules, type IPushRule } from "../../src/@types/PushRules.ts";

describe("client-push-rules", () => {
    describe("getRoomPushRuleRequest", () => {
        it("should return the matching room push rule", () => {
            const pushRules: IPushRules = {
                global: {
                    room: [
                        {
                            rule_id: "!room1:server",
                            actions: [PushRuleActionName.DontNotify],
                            default: false,
                            enabled: true,
                        },
                        {
                            rule_id: "!room2:server",
                            actions: [PushRuleActionName.Notify],
                            default: false,
                            enabled: true,
                        },
                    ],
                },
            };

            const result = getRoomPushRuleRequest(pushRules, "global", "!room1:server");

            expect(result).toEqual(pushRules.global!.room![0]);
        });

        it("should return undefined when no matching rule found", () => {
            const pushRules: IPushRules = {
                global: {
                    room: [{ rule_id: "!room1:server", actions: [], default: false, enabled: true }],
                },
            };

            const result = getRoomPushRuleRequest(pushRules, "global", "!room2:server");

            expect(result).toBeUndefined();
        });

        it("should throw error when pushRules is undefined", () => {
            expect(() => getRoomPushRuleRequest(undefined, "global", "!room:server")).toThrow(
                "SyncApi.sync() must be done before accessing to push rules.",
            );
        });

        it("should return undefined when scope is missing", () => {
            const pushRules: IPushRules = { global: {} };

            const result = getRoomPushRuleRequest(pushRules, "global", "!room:server");

            expect(result).toBeUndefined();
        });
    });

    describe("setRoomMutePushRuleRequest", () => {
        const createMockPushManager = () => ({
            deletePushRule: vi.fn().mockResolvedValue(undefined),
            createPushRule: vi.fn().mockResolvedValue(undefined),
            getPushRules: vi.fn().mockResolvedValue({ global: {} }),
        });

        it("should return undefined when unmuting and no DontNotify rule", () => {
            const mockManager = createMockPushManager();
            const roomPushRule: IPushRule = {
                rule_id: "!room:server",
                actions: [PushRuleActionName.Notify],
                default: false,
                enabled: true,
            };

            const result = setRoomMutePushRuleRequest(
                "global",
                "!room:server",
                false,
                roomPushRule,
                () => mockManager,
                vi.fn(),
            );

            expect(result).toBeUndefined();
        });

        it("should delete rule when unmuting with DontNotify rule", async () => {
            const mockManager = createMockPushManager();
            const setPushRules = vi.fn();
            const roomPushRule: IPushRule = {
                rule_id: "!room:server",
                actions: [PushRuleActionName.DontNotify],
                default: false,
                enabled: true,
            };

            await setRoomMutePushRuleRequest(
                "global",
                "!room:server",
                false,
                roomPushRule,
                () => mockManager,
                setPushRules,
            );

            expect(mockManager.deletePushRule).toHaveBeenCalledWith(
                "global",
                PushRuleKind.RoomSpecific,
                "!room:server",
            );
        });

        it("should create rule when muting and no existing rule", async () => {
            const mockManager = createMockPushManager();
            const setPushRules = vi.fn();

            await setRoomMutePushRuleRequest(
                "global",
                "!room:server",
                true,
                undefined,
                () => mockManager,
                setPushRules,
            );

            expect(mockManager.createPushRule).toHaveBeenCalledWith(
                "global",
                PushRuleKind.RoomSpecific,
                "!room:server",
                {
                    actions: [PushRuleActionName.DontNotify],
                },
            );
        });

        it("should return undefined when muting with existing DontNotify rule", () => {
            const mockManager = createMockPushManager();
            const roomPushRule: IPushRule = {
                rule_id: "!room:server",
                actions: [PushRuleActionName.DontNotify],
                default: false,
                enabled: true,
            };

            const result = setRoomMutePushRuleRequest(
                "global",
                "!room:server",
                true,
                roomPushRule,
                () => mockManager,
                vi.fn(),
            );

            expect(result).toBeUndefined();
        });

        it("should delete and recreate rule when muting with non-DontNotify rule", async () => {
            const mockManager = createMockPushManager();
            const setPushRules = vi.fn();
            const roomPushRule: IPushRule = {
                rule_id: "!room:server",
                actions: [PushRuleActionName.Notify],
                default: false,
                enabled: true,
            };

            await setRoomMutePushRuleRequest(
                "global",
                "!room:server",
                true,
                roomPushRule,
                () => mockManager,
                setPushRules,
            );

            expect(mockManager.deletePushRule).toHaveBeenCalledWith(
                "global",
                PushRuleKind.RoomSpecific,
                "!room:server",
            );
            expect(mockManager.createPushRule).toHaveBeenCalledWith(
                "global",
                PushRuleKind.RoomSpecific,
                "!room:server",
                {
                    actions: [PushRuleActionName.DontNotify],
                },
            );
        });

        it("should update push rules after successful operation", async () => {
            const mockManager = createMockPushManager();
            const setPushRules = vi.fn();
            const newRules: IPushRules = { global: { room: [] } };
            mockManager.getPushRules.mockResolvedValue(newRules);

            await setRoomMutePushRuleRequest(
                "global",
                "!room:server",
                true,
                undefined,
                () => mockManager,
                setPushRules,
            );

            expect(mockManager.getPushRules).toHaveBeenCalled();
            expect(setPushRules).toHaveBeenCalledWith(newRules);
        });
    });
});
