/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../src/errors";
import { KeyRotationManager } from "../../src/key-rotation/index";
import { ClientPrefix } from "../../src/http-api/prefix";
import { Method } from "../../src/http-api/method";

describe("KeyRotationManager", () => {
    let manager: KeyRotationManager;
    let mockHttp: { authedRequest: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mockHttp = {
            authedRequest: vi.fn(),
        };

        const client = {
            http: mockHttp,
        } as any;

        manager = new KeyRotationManager(client);
    });

    it("should get key rotation status", async () => {
        const mockResponse = {
            enabled: true,
            status: { rotation_enabled: true, grace_period_ms: 2592000000 },
            user_last_rotation: 1714175000000,
        };
        mockHttp.authedRequest.mockResolvedValue(mockResponse);

        const result = await manager.getStatus();

        expect(mockHttp.authedRequest).toHaveBeenCalledWith(Method.Get, "/keys/rotation/status", undefined, undefined, {
            prefix: ClientPrefix.V1,
        });
        expect(result).toEqual(mockResponse);
    });

    it("should reuse cached status without another request", async () => {
        const mockResponse = {
            enabled: true,
            status: { rotation_enabled: true },
            user_last_rotation: 1,
        };
        mockHttp.authedRequest.mockResolvedValue(mockResponse);

        const first = await manager.getStatus();
        const second = await manager.getStatus();

        expect(first).toEqual(mockResponse);
        expect(second).toEqual(mockResponse);
        expect(mockHttp.authedRequest).toHaveBeenCalledTimes(1);
    });

    it("should rotate key", async () => {
        const mockResponse = {
            success: true,
            message: "Keys rotated successfully",
            has_new_key: true,
        };
        mockHttp.authedRequest.mockResolvedValue(mockResponse);

        const result = await manager.rotateKey({ key_id: "key_v1" });

        expect(mockHttp.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/keys/rotation/rotate",
            undefined,
            { key_id: "key_v1" },
            { prefix: ClientPrefix.V1 },
        );
        expect(result).toEqual(mockResponse);
    });

    it("should get rotation history", async () => {
        const mockResponse = {
            device_id: "DEVICE1",
            rotations: [
                {
                    key_id: "key_v1",
                    rotated_ts: 1714176000000,
                },
            ],
        };
        mockHttp.authedRequest.mockResolvedValue(mockResponse);

        const result = await manager.getRotationHistory("DEVICE1", { limit: 20, from: "batch-0" });

        expect(mockHttp.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/keys/rotation/history/DEVICE1",
            { limit: 20, from: "batch-0" },
            undefined,
            { prefix: ClientPrefix.V1 },
        );
        expect(result).toEqual(mockResponse);
    });

    it("should revoke key", async () => {
        const mockResponse = {
            success: true,
            revoked: 0,
            message: "Key revocation is handled automatically by key rotation",
        };
        mockHttp.authedRequest.mockResolvedValue(mockResponse);

        const result = await manager.revokeKey({ key_id: "key_v1_old123", reason: "compromised" });

        expect(mockHttp.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/keys/rotation/revoke",
            undefined,
            { key_id: "key_v1_old123", reason: "compromised" },
            { prefix: ClientPrefix.V1 },
        );
        expect(result).toEqual(mockResponse);
    });

    it("should update rotation config", async () => {
        const mockResponse = {
            enabled: true,
            interval_ms: 2592000000,
        };
        mockHttp.authedRequest.mockResolvedValue(mockResponse);

        const result = await manager.updateConfig({
            enabled: true,
            interval_ms: 2592000000,
        });

        expect(mockHttp.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/keys/rotation/config",
            undefined,
            {
                enabled: true,
                interval_ms: 2592000000,
            },
            { prefix: ClientPrefix.V1 },
        );
        expect(result).toEqual(mockResponse);
    });

    it("should check key validity", async () => {
        const mockResponse = {
            needs_rotation: false,
            last_rotation: 1714176000000,
            interval_ms: 2592000000,
        };
        mockHttp.authedRequest.mockResolvedValue(mockResponse);

        const result = await manager.checkKeyValidity("key_v2_abc123");

        expect(mockHttp.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/keys/rotation/check",
            { key_id: "key_v2_abc123" },
            undefined,
            { prefix: ClientPrefix.V1 },
        );
        expect(result).toEqual(mockResponse);
    });

    it("should validate required device id for history", async () => {
        await expect(manager.getRotationHistory("")).rejects.toBeInstanceOf(ValidationError);
        expect(mockHttp.authedRequest).not.toHaveBeenCalled();
    });

    it("should validate positive limit for history", async () => {
        await expect(manager.getRotationHistory("DEVICE1", { limit: 0 })).rejects.toBeInstanceOf(ValidationError);
        expect(mockHttp.authedRequest).not.toHaveBeenCalled();
    });

    it("should validate config payload", async () => {
        await expect(
            manager.updateConfig({
                enabled: true,
                interval_ms: 0,
            }),
        ).rejects.toBeInstanceOf(ValidationError);

        expect(mockHttp.authedRequest).not.toHaveBeenCalled();
    });

    it("should invalidate cached status after mutate operations", async () => {
        mockHttp.authedRequest
            .mockResolvedValueOnce({
                enabled: true,
                status: { rotation_enabled: true },
                user_last_rotation: 1,
            })
            .mockResolvedValueOnce({
                enabled: false,
                interval_ms: 2000,
            })
            .mockResolvedValueOnce({
                enabled: false,
                status: { rotation_enabled: false },
                user_last_rotation: 3,
            });

        const first = await manager.getStatus();
        await manager.updateConfig({
            enabled: false,
            interval_ms: 2000,
        });
        const second = await manager.getStatus();

        expect(first.enabled).toBe(true);
        expect(second.enabled).toBe(false);
        expect(mockHttp.authedRequest).toHaveBeenCalledTimes(3);
    });
});
