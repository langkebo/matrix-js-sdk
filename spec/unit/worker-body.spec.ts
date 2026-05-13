/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
*/

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatrixClient } from "../../src/client.ts";
import { WorkerBodyManager } from "../../src/worker-body/index.ts";
import { Method } from "../../src/http-api/method.ts";

describe("WorkerBodyManager", () => {
    let mockClient: any;
    let manager: WorkerBodyManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new WorkerBodyManager(mockClient as MatrixClient);
    });

    it("should report heartbeat", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ status: "ok" });
        const req = { status: "running" };
        await manager.heartbeat("worker-1", req);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/v1/workers/worker-1/heartbeat",
            undefined,
            req,
            { prefix: "/_synapse/worker" },
        );
    });

    it("should complete a command", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ status: "completed" });
        await manager.completeCommand("cmd-1");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/v1/commands/cmd-1/complete",
            undefined,
            undefined,
            { prefix: "/_synapse/worker" },
        );
    });

    it("should fail a command", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ status: "failed" });
        await manager.failCommand("cmd-1", "some error");
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/v1/commands/cmd-1/fail",
            undefined,
            { error: "some error" },
            { prefix: "/_synapse/worker" },
        );
    });

    it("should update replication position", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ status: "updated" });
        await manager.updateReplicationPosition("worker-1", "events", 123);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/v1/replication/worker-1/events",
            undefined,
            { stream_name: "events", position: 123 },
            { prefix: "/_synapse/worker" },
        );
    });

    it("should get events", async () => {
        mockClient.http.authedRequest.mockResolvedValue({ events: [] });
        await manager.getEvents(100);
        expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/v1/events",
            { stream_id: "100" },
            undefined,
            { prefix: "/_synapse/worker" },
        );
    });
});
