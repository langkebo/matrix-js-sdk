import { describe, it, expect, beforeEach, vi } from "vitest";

import { WorkerAdminManager } from "../../src/worker-admin/index";
import { ValidationError } from "../../src/errors";

describe("WorkerAdminManager", () => {
    let mockClient: any;
    let manager: WorkerAdminManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn().mockResolvedValue({});
        mockClient = { http: { authedRequest: mockAuthedRequest } };
        manager = new WorkerAdminManager(mockClient);
    });

    describe("registerWorker", () => {
        it("POSTs to /v1/register with worker prefix", async () => {
            await manager.registerWorker({
                worker_id: "w1",
                worker_name: "worker-one",
                worker_type: "media",
                host: "127.0.0.1",
                port: 9090,
            });
            const call = mockAuthedRequest.mock.calls[0];
            expect(call[0]).toBe("POST");
            expect(call[1]).toBe("/v1/register");
            expect(call[4]).toMatchObject({ prefix: "/_synapse/worker" });
        });

        it("validates worker_id", async () => {
            await expect(
                manager.registerWorker({
                    worker_id: "",
                    worker_name: "x",
                    worker_type: "t",
                    host: "h",
                    port: 1,
                }),
            ).rejects.toThrow(ValidationError);
        });
    });

    describe("listWorkers", () => {
        it("GETs /v1/workers", async () => {
            await manager.listWorkers();
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("GET");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/workers");
        });

        it("passes limit as query string", async () => {
            await manager.listWorkers(50);
            expect(mockAuthedRequest.mock.calls[0][2]).toEqual({ limit: "50" });
        });
    });

    describe("getWorker / unregisterWorker", () => {
        it("GET /v1/workers/{id} with encoded path", async () => {
            await manager.getWorker("w/1");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/workers/w%2F1");
        });

        it("DELETE /v1/workers/{id}", async () => {
            await manager.unregisterWorker("w1");
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("DELETE");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/workers/w1");
        });

        it("throws on empty workerId", async () => {
            await expect(manager.getWorker("")).rejects.toThrow(ValidationError);
            await expect(manager.unregisterWorker("")).rejects.toThrow(ValidationError);
        });
    });

    describe("heartbeat / connect / disconnect", () => {
        it("heartbeat POSTs body with status", async () => {
            await manager.heartbeat("w1", { status: "up" });
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("POST");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/workers/w1/heartbeat");
            expect(mockAuthedRequest.mock.calls[0][3]).toEqual({ status: "up" });
        });

        it("connectWorker sends {address}", async () => {
            await manager.connectWorker("w1", "tcp://h:1");
            expect(mockAuthedRequest.mock.calls[0][3]).toEqual({ address: "tcp://h:1" });
        });

        it("disconnectWorker uses POST", async () => {
            await manager.disconnectWorker("w1");
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("POST");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/workers/w1/disconnect");
        });
    });

    describe("commands", () => {
        it("sendCommand POSTs SendCommandRequest body", async () => {
            await manager.sendCommand("w1", {
                command_type: "restart",
                command_data: { force: true },
                priority: 10,
            });
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/workers/w1/commands");
            expect(mockAuthedRequest.mock.calls[0][3]).toMatchObject({
                command_type: "restart",
                priority: 10,
            });
        });

        it("failCommand posts {error}", async () => {
            await manager.failCommand("c1", "timed-out");
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("POST");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/commands/c1/fail");
            expect(mockAuthedRequest.mock.calls[0][3]).toEqual({ error: "timed-out" });
        });
    });

    describe("tasks", () => {
        it("assignTask POSTs to /v1/tasks", async () => {
            await manager.assignTask({ task_type: "index", task_data: {} });
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/tasks");
        });

        it("claimSpecificTask encodes both segments", async () => {
            await manager.claimSpecificTask("t/1", "w/2");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/tasks/t%2F1/claim/w%2F2");
        });

        it("completeTask sends {result}", async () => {
            await manager.completeTask("t1", { ok: true });
            expect(mockAuthedRequest.mock.calls[0][3]).toEqual({ result: { ok: true } });
        });
    });

    describe("statistics / select / replication", () => {
        it("getStatistics GETs /v1/statistics", async () => {
            await manager.getStatistics();
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/statistics");
        });

        it("selectWorker passes taskType in path", async () => {
            await manager.selectWorker("sync");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/select/sync");
        });

        it("getReplicationStream passes stream_id query", async () => {
            await manager.getReplicationStream("w1", "events", 42);
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/replication/w1/events");
            expect(mockAuthedRequest.mock.calls[0][2]).toEqual({ stream_id: "42" });
        });
    });
});
