import { describe, it, expect, beforeEach, vi } from "vitest";

import { WorkerAdminManager } from "../../src/worker-admin/index.ts";
import { ValidationError } from "../../src/errors.ts";

describe("WorkerAdminManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

        it("listWorkersByType encodes worker type and forwards limit", async () => {
            await manager.listWorkersByType("media/worker", 25);
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("GET");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/workers/type/media%2Fworker");
            expect(mockAuthedRequest.mock.calls[0][2]).toEqual({ limit: "25" });
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
    });

    describe("tasks", () => {
        it("assignTask POSTs to /v1/tasks", async () => {
            await manager.assignTask({ task_type: "index", task_data: {} });
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/tasks");
        });

        it("getPendingTasks forwards limit as query string", async () => {
            await manager.getPendingTasks(10);
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("GET");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/tasks");
            expect(mockAuthedRequest.mock.calls[0][2]).toEqual({ limit: "10" });
        });

        it("claimTask POSTs to the worker claim route", async () => {
            await manager.claimTask("w/3");
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("POST");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/tasks/claim/w%2F3");
        });

        it("claimSpecificTask encodes both segments", async () => {
            await manager.claimSpecificTask("t/1", "w/2");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/tasks/t%2F1/claim/w%2F2");
        });
    });

    describe("statistics / select", () => {
        it("getStatistics GETs /v1/statistics", async () => {
            await manager.getStatistics();
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/statistics");
        });

        it("getStatisticsByType GETs /v1/statistics/types", async () => {
            await manager.getStatisticsByType();
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("GET");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/statistics/types");
        });

        it("selectWorker passes taskType in path", async () => {
            await manager.selectWorker("sync");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/v1/select/sync");
        });
    });
});
