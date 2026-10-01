/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, beforeEach, vi } from "vitest";

import { WorkerManager, type WorkerInfo } from "./worker";
import { Method } from "../../http-api/method";
import { MatrixError } from "../../http-api/errors";
import { AuthError, NotFoundError, ApiError, RetryableError, ValidationError } from "../../errors";
import type { Transport } from "../../managers/base-manager";

describe("WorkerManager", () => {
    let transport: Transport;
    let workerManager: WorkerManager;

    beforeEach(() => {
        transport = {
            request: vi.fn().mockResolvedValue({}),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        workerManager = new WorkerManager({} as any, { transport });
    });

    // =========================================================================
    // URL 组装测试
    // =========================================================================

    describe("URL 组装规则", () => {
        it("应该使用相对路径，不包含前缀", async () => {
            transport.request = vi.fn().mockResolvedValue([]);

            await workerManager.listWorkers();

            expect(transport.request).toHaveBeenCalled();
            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];

            const path = call[1];
            expect(path).toBe("/v1/workers");
            expect(path).not.toContain("/_synapse/worker");

            const opts = call[4];
            expect(opts?.prefix).toBe("/_synapse/worker");
        });

        it("应该正确组装 getWorker URL", async () => {
            transport.request = vi.fn().mockResolvedValue({
                id: 1,
                worker_id: "worker-1",
                worker_name: "Worker 1",
                worker_type: "frontend",
                host: "127.0.0.1",
                port: 8080,
                status: "running",
                last_heartbeat_ts: 1234567890,
                started_ts: 1234560000,
            });

            await workerManager.getWorker("worker-1");

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(call[1]).toBe("/v1/workers/worker-1");
            expect(call[1]).not.toContain("/_synapse/worker");
        });

        it("应该正确编码 workerId 中的特殊字符", async () => {
            transport.request = vi.fn().mockResolvedValue({
                id: 1,
                worker_id: "worker@test",
                worker_name: "Test Worker",
                worker_type: "frontend",
                host: "127.0.0.1",
                port: 8080,
                status: "running",
                last_heartbeat_ts: 1234567890,
                started_ts: 1234560000,
            });

            await workerManager.getWorker("worker@test");

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(call[1]).toBe("/v1/workers/worker%40test");
        });
    });

    // =========================================================================
    // Worker 管理方法测试
    // =========================================================================

    describe("Worker 管理方法", () => {
        describe("registerWorker", () => {
            it("应该成功注册 Worker", async () => {
                const workerInfo = {
                    worker_id: "worker-1",
                    worker_name: "Worker One",
                    worker_type: "frontend" as const,
                    host: "127.0.0.1",
                    port: 8080,
                };

                const mockWorker: WorkerInfo = {
                    id: 1,
                    worker_id: "worker-1",
                    worker_name: "Worker One",
                    worker_type: "frontend",
                    instance_map_keys: [],
                    responsibility_domains: [],
                    owned_route_prefixes: [],
                    replication_streams: [],
                    capabilities: {},
                    host: "127.0.0.1",
                    port: 8080,
                    status: "running",
                    last_heartbeat_ts: 1234567890,
                    started_ts: 1234560000,
                };

                transport.request = vi.fn().mockResolvedValue(mockWorker);

                const result = await workerManager.registerWorker(workerInfo);

                expect(result.worker_id).toBe("worker-1");
                expect(result.worker_name).toBe("Worker One");
                expect(transport.request).toHaveBeenCalledWith(
                    Method.Post,
                    "/v1/register",
                    undefined,
                    workerInfo,
                    expect.objectContaining({ prefix: "/_synapse/worker" }),
                );
            });

            it("应该拒绝缺少 worker_id 的请求", async () => {
                await expect(
                    workerManager.registerWorker({
                        worker_id: "",
                        worker_name: "Worker One",
                        worker_type: "frontend",
                        host: "127.0.0.1",
                        port: 8080,
                    } as any),
                ).rejects.toThrow(ValidationError);
            });

            it("应该拒绝缺少 worker_type 的请求", async () => {
                await expect(
                    workerManager.registerWorker({
                        worker_id: "worker-1",
                        worker_name: "Worker One",
                        worker_type: "" as any,
                        host: "127.0.0.1",
                        port: 8080,
                    } as any),
                ).rejects.toThrow(ValidationError);
            });

            it("应该接受可选参数", async () => {
                const workerInfo = {
                    worker_id: "worker-1",
                    worker_name: "Worker One",
                    worker_type: "frontend" as const,
                    host: "127.0.0.1",
                    port: 8080,
                    config: { thread_count: 4 },
                    metadata: { region: "us-east" },
                    version: "1.0.0",
                };

                const mockWorker: WorkerInfo = {
                    id: 1,
                    worker_id: "worker-1",
                    worker_name: "Worker One",
                    worker_type: "frontend",
                    instance_map_keys: [],
                    responsibility_domains: [],
                    owned_route_prefixes: [],
                    replication_streams: [],
                    capabilities: {},
                    host: "127.0.0.1",
                    port: 8080,
                    status: "running",
                    last_heartbeat_ts: 1234567890,
                    started_ts: 1234560000,
                };

                transport.request = vi.fn().mockResolvedValue(mockWorker);

                const result = await workerManager.registerWorker(workerInfo);

                expect(result.worker_id).toBe("worker-1");
            });
        });

        describe("listWorkers", () => {
            it("应该成功列出所有 Workers", async () => {
                const workers = [
                    {
                        id: 1,
                        worker_id: "worker-1",
                        worker_name: "Worker 1",
                        worker_type: "frontend",
                        host: "127.0.0.1",
                        port: 8080,
                        status: "running",
                        last_heartbeat_ts: 1234567890,
                        started_ts: 1234560000,
                    },
                    {
                        id: 2,
                        worker_id: "worker-2",
                        worker_name: "Worker 2",
                        worker_type: "federation_reader",
                        host: "127.0.0.1",
                        port: 8081,
                        status: "running",
                        last_heartbeat_ts: 1234567890,
                        started_ts: 1234560000,
                    },
                ];

                transport.request = vi.fn().mockResolvedValue({ workers });

                const result = await workerManager.listWorkers();

                expect(result).toHaveLength(2);
                expect(result[0].worker_id).toBe("worker-1");
                expect(result[1].worker_type).toBe("federation_reader");
            });

            it("应该返回空数组当没有 Workers 时", async () => {
                transport.request = vi.fn().mockResolvedValue({ workers: [] });

                const result = await workerManager.listWorkers();

                expect(result).toEqual([]);
            });
        });

        describe("getWorker", () => {
            it("应该成功获取指定 Worker", async () => {
                const worker = {
                    id: 1,
                    worker_id: "worker-1",
                    worker_name: "Worker One",
                    worker_type: "frontend",
                    host: "127.0.0.1",
                    port: 8080,
                    status: "running",
                    last_heartbeat_ts: 1234567890,
                    started_ts: 1234560000,
                };

                transport.request = vi.fn().mockResolvedValue(worker);

                const result = await workerManager.getWorker("worker-1");

                expect(result.worker_id).toBe("worker-1");
                expect(result.worker_name).toBe("Worker One");
            });

            it("应该拒绝空 workerId", async () => {
                await expect(workerManager.getWorker("")).rejects.toThrow(ValidationError);
            });
        });

        describe("unregisterWorker", () => {
            it("应该成功注销 Worker", async () => {
                transport.request = vi.fn().mockResolvedValue(undefined);

                await workerManager.unregisterWorker("worker-1");

                expect(transport.request).toHaveBeenCalledWith(
                    Method.Delete,
                    "/v1/workers/worker-1",
                    undefined,
                    undefined,
                    expect.objectContaining({ prefix: "/_synapse/worker" }),
                );
            });

            it("应该拒绝空 workerId", async () => {
                await expect(workerManager.unregisterWorker("")).rejects.toThrow(ValidationError);
            });
        });
    });

    // =========================================================================
    // 命令方法测试
    // =========================================================================

    describe("sendCommand", () => {
        it("应该成功发送命令给 Worker", async () => {
            transport.request = vi.fn().mockResolvedValue(undefined);

            await workerManager.sendCommand("worker-1", {
                command_type: "reload_config",
                command_data: {},
            });

            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/v1/workers/worker-1/commands",
                undefined,
                { command_type: "reload_config", command_data: {} },
                expect.objectContaining({ prefix: "/_synapse/worker" }),
            );
        });

        it("应该拒绝缺少 workerId 的请求", async () => {
            await expect(
                workerManager.sendCommand("", {
                    command_type: "reload_config",
                    command_data: {},
                } as any),
            ).rejects.toThrow(ValidationError);
        });

        it("应该拒绝缺少 command_type 的请求", async () => {
            await expect(
                workerManager.sendCommand("worker-1", {
                    command_type: "",
                    command_data: {},
                } as any),
            ).rejects.toThrow(ValidationError);
        });

        it("应该接受可选的 priority 和 max_retries 参数", async () => {
            transport.request = vi.fn().mockResolvedValue(undefined);

            await workerManager.sendCommand("worker-1", {
                command_type: "custom_command",
                command_data: { room_id: "!room:example.com" },
                priority: 5,
                max_retries: 3,
            });

            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/v1/workers/worker-1/commands",
                undefined,
                {
                    command_type: "custom_command",
                    command_data: { room_id: "!room:example.com" },
                    priority: 5,
                    max_retries: 3,
                },
                expect.objectContaining({ prefix: "/_synapse/worker" }),
            );
        });
    });

    // =========================================================================
    // 任务方法测试
    // =========================================================================

    describe("任务方法", () => {
        describe("listTasks", () => {
            it("应该成功列出所有任务", async () => {
                const tasks = [
                    {
                        task_id: "task-1",
                        task_type: "http",
                        status: "pending",
                        assigned_worker_id: null,
                    },
                    {
                        task_id: "task-2",
                        task_type: "federation",
                        status: "pending",
                        assigned_worker_id: null,
                    },
                ];

                transport.request = vi.fn().mockResolvedValue({ tasks });

                const result = await workerManager.listTasks();

                expect(result).toHaveLength(2);
                expect(result[0].task_type).toBe("http");
                expect(result[1].task_type).toBe("federation");
            });

            it("应该返回空数组当没有任务时", async () => {
                transport.request = vi.fn().mockResolvedValue({ tasks: [] });

                const result = await workerManager.listTasks();

                expect(result).toEqual([]);
            });
        });

        describe("assignTask", () => {
            it("应该成功分配任务", async () => {
                const task = {
                    task_id: "task-1",
                    task_type: "http",
                    status: "assigned",
                    assigned_worker_id: "worker-1",
                };

                transport.request = vi.fn().mockResolvedValue(task);

                const result = await workerManager.assignTask({
                    task_type: "http",
                    task_data: { path: "/sync" },
                });

                expect(result.task_id).toBe("task-1");
                expect(result.assigned_worker_id).toBe("worker-1");
                expect(transport.request).toHaveBeenCalledWith(
                    Method.Post,
                    "/v1/tasks",
                    undefined,
                    {
                        task_type: "http",
                        task_data: { path: "/sync" },
                    },
                    expect.objectContaining({ prefix: "/_synapse/worker" }),
                );
            });

            it("应该拒绝缺少 task_type 的请求", async () => {
                await expect(
                    workerManager.assignTask({
                        task_type: "",
                        task_data: {},
                    } as any),
                ).rejects.toThrow(ValidationError);
            });

            it("应该接受可选的 priority 和 preferred_worker_id 参数", async () => {
                const task = {
                    task_id: "task-1",
                    task_type: "http",
                    status: "assigned",
                    assigned_worker_id: "worker-2",
                };

                transport.request = vi.fn().mockResolvedValue(task);

                await workerManager.assignTask({
                    task_type: "http",
                    task_data: { path: "/sync" },
                    priority: 10,
                    preferred_worker_id: "worker-1",
                });

                expect(transport.request).toHaveBeenCalledWith(
                    Method.Post,
                    "/v1/tasks",
                    undefined,
                    {
                        task_type: "http",
                        task_data: { path: "/sync" },
                        priority: 10,
                        preferred_worker_id: "worker-1",
                    },
                    expect.objectContaining({ prefix: "/_synapse/worker" }),
                );
            });
        });

        describe("claimNextTask", () => {
            it("应该成功领取下一个任务", async () => {
                const task = {
                    task_id: "task-1",
                    task_type: "http",
                    status: "claimed",
                    assigned_worker_id: "worker-1",
                };

                transport.request = vi.fn().mockResolvedValue(task);

                const result = await workerManager.claimNextTask("worker-1");

                expect(result.task_id).toBe("task-1");
                expect(result.assigned_worker_id).toBe("worker-1");
                expect(transport.request).toHaveBeenCalledWith(
                    Method.Post,
                    "/v1/tasks/claim/worker-1",
                    undefined,
                    undefined,
                    expect.objectContaining({ prefix: "/_synapse/worker" }),
                );
            });

            it("应该拒绝空 workerId", async () => {
                await expect(workerManager.claimNextTask("")).rejects.toThrow(ValidationError);
            });
        });
    });

    // =========================================================================
    // 拓扑与统计方法测试
    // =========================================================================

    describe("拓扑与统计方法", () => {
        describe("getTopology", () => {
            it("应该成功获取拓扑信息", async () => {
                const topology = {
                    worker_enabled: true,
                    instance_name: "master",
                    known_instances: ["master", "worker-1"],
                    replication_enabled: true,
                    replication_http_enabled: true,
                    validation: {
                        valid: true,
                        errors: [],
                    },
                    stream_writers: [
                        { stream_name: "events", owners: ["worker-1"] },
                    ],
                    route_owner_expectations: [
                        { probe: "sync", path: "/_matrix/client/v3/sync", expected_owner: "master" },
                    ],
                };

                transport.request = vi.fn().mockResolvedValue(topology);

                const result = await workerManager.getTopology();

                expect(result.worker_enabled).toBe(true);
                expect(result.instance_name).toBe("master");
                expect(result.known_instances).toContain("master");
            });
        });

        describe("getStatistics", () => {
            it("应该成功获取统计信息", async () => {
                const statistics = [
                    {
                        worker_id: "worker-1",
                        worker_name: "Worker 1",
                        worker_type: "frontend",
                        status: "running",
                        host: "127.0.0.1",
                        port: 8080,
                        last_heartbeat_ts: 1234567890,
                        started_ts: 1234560000,
                        cpu_usage: 45.5,
                        memory_usage: 1024.5,
                        active_connections: 100,
                        requests_per_second: 50.5,
                        average_latency_ms: 15.2,
                        queue_depth: 10,
                        pending_commands: 0,
                        active_tasks: 5,
                    },
                ];

                transport.request = vi.fn().mockResolvedValue(statistics);

                const result = await workerManager.getStatistics();

                expect(result).toHaveLength(1);
                expect(result[0].worker_id).toBe("worker-1");
                expect(result[0].cpu_usage).toBe(45.5);
            });

            it("应该返回空数组当没有统计信息时", async () => {
                transport.request = vi.fn().mockResolvedValue([]);

                const result = await workerManager.getStatistics();

                expect(result).toEqual([]);
            });
        });
    });

    // =========================================================================
    // 错误分类测试
    // =========================================================================

    describe("错误分类测试", () => {
        it("应该对 401 响应抛出 AuthError", async () => {
            transport.request = vi
                .fn()
                .mockRejectedValue(new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "Invalid token" }, 401, undefined));

            await expect(workerManager.getWorker("worker-1")).rejects.toThrow(AuthError);
        });

        it("应该对 404 响应抛出 NotFoundError", async () => {
            transport.request = vi
                .fn()
                .mockRejectedValue(new MatrixError({ errcode: "M_NOT_FOUND", error: "Worker not found" }, 404, undefined));

            await expect(workerManager.getWorker("nonexistent")).rejects.toThrow(NotFoundError);
        });

        it("应该对其他错误码抛出 ApiError", async () => {
            transport.request = vi
                .fn()
                .mockRejectedValue(new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined));

            await expect(workerManager.listWorkers()).rejects.toThrow(ApiError);
        });

        it("应该对 500 错误抛出 RetryableError", async () => {
            transport.request = vi
                .fn()
                .mockRejectedValue(
                    new MatrixError({ errcode: "M_UNKNOWN", error: "Internal server error" }, 500, undefined),
                );

            await expect(workerManager.getWorker("worker-1")).rejects.toThrow(RetryableError);
        });

        it("错误消息应该包含类名", async () => {
            transport.request = vi
                .fn()
                .mockRejectedValue(new MatrixError({ errcode: "M_UNKNOWN", error: "Something went wrong" }, 500, undefined));

            await expect(workerManager.getWorker("worker-1")).rejects.toThrow(/WorkerManager/);
        });

        it("错误消息应该包含原始错误信息", async () => {
            transport.request = vi
                .fn()
                .mockRejectedValue(new MatrixError({ errcode: "M_FORBIDDEN", error: "Access denied" }, 403, undefined));

            await expect(workerManager.getWorker("worker-1")).rejects.toThrow(/Access denied/);
        });
    });

    // =========================================================================
    // URL 重复前缀检测测试
    // =========================================================================

    describe("URL 重复前缀检测", () => {
        it("getWorker 不应该产生重复前缀的 URL", async () => {
            const worker = {
                id: 1,
                worker_id: "worker-1",
                worker_name: "Worker 1",
                worker_type: "frontend",
                host: "127.0.0.1",
                port: 8080,
                status: "running",
                last_heartbeat_ts: 1234567890,
                started_ts: 1234560000,
            };

            transport.request = vi.fn().mockResolvedValue(worker);

            await workerManager.getWorker("worker-1");

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("/_synapse/worker");
            expect(opts!.prefix).toBe("/_synapse/worker");
        });

        it("listWorkers 不应该产生重复前缀的 URL", async () => {
            transport.request = vi.fn().mockResolvedValue({ workers: [] });

            await workerManager.listWorkers();

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("/_synapse/worker");
            expect(opts!.prefix).toBe("/_synapse/worker");
        });

        it("registerWorker 不应该产生重复前缀的 URL", async () => {
            transport.request = vi.fn().mockResolvedValue({
                id: 1,
                worker_id: "worker-1",
                worker_name: "Worker 1",
                worker_type: "frontend",
                host: "127.0.0.1",
                port: 8080,
                status: "running",
                last_heartbeat_ts: 1234567890,
                started_ts: 1234560000,
            });

            await workerManager.registerWorker({
                worker_id: "worker-1",
                worker_name: "Worker 1",
                worker_type: "frontend",
                host: "127.0.0.1",
                port: 8080,
            });

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("/_synapse/worker");
            expect(opts!.prefix).toBe("/_synapse/worker");
        });

        it("sendCommand 不应该产生重复前缀的 URL", async () => {
            transport.request = vi.fn().mockResolvedValue({});

            await workerManager.sendCommand("worker-1", {
                command_type: "test",
                command_data: {},
            });

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("/_synapse/worker");
            expect(opts!.prefix).toBe("/_synapse/worker");
        });

        it("assignTask 不应该产生重复前缀的 URL", async () => {
            transport.request = vi.fn().mockResolvedValue({
                task_id: "task-1",
                task_type: "http",
                status: "assigned",
                assigned_worker_id: "worker-1",
            });

            await workerManager.assignTask({
                task_type: "http",
                task_data: {},
            });

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("/_synapse/worker");
            expect(opts!.prefix).toBe("/_synapse/worker");
        });

        it("claimNextTask 不应该产生重复前缀的 URL", async () => {
            transport.request = vi.fn().mockResolvedValue({
                task_id: "task-1",
                task_type: "http",
                status: "claimed",
                assigned_worker_id: "worker-1",
            });

            await workerManager.claimNextTask("worker-1");

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("/_synapse/worker");
            expect(opts!.prefix).toBe("/_synapse/worker");
        });

        it("getTopology 不应该产生重复前缀的 URL", async () => {
            transport.request = vi.fn().mockResolvedValue({
                worker_enabled: true,
                instance_name: "master",
                known_instances: [],
                replication_enabled: true,
                replication_http_enabled: true,
                validation: { valid: true },
                stream_writers: [],
                route_owner_expectations: [],
            });

            await workerManager.getTopology();

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("/_synapse/worker");
            expect(opts!.prefix).toBe("/_synapse/worker");
        });

        it("getStatistics 不应该产生重复前缀的 URL", async () => {
            transport.request = vi.fn().mockResolvedValue([]);

            await workerManager.getStatistics();

            const call = (transport.request as ReturnType<typeof vi.fn>).mock.calls[0];
            const path = call[1];
            const opts = call[4];

            expect(path).not.toContain("/_synapse/worker");
            expect(opts!.prefix).toBe("/_synapse/worker");
        });
    });

    // =========================================================================
    // 传递正确参数测试
    // =========================================================================

    describe("正确传递请求参数", () => {
        it("registerWorker 应该传递正确的 body", async () => {
            const workerInfo = {
                worker_id: "worker-1",
                worker_name: "Worker One",
                worker_type: "frontend" as const,
                host: "127.0.0.1",
                port: 8080,
                config: { thread_count: 4 },
                metadata: { region: "us-east" },
                version: "1.0.0",
            };

            const mockWorker = {
                id: 1,
                worker_id: "worker-1",
                worker_name: "Worker One",
                worker_type: "frontend",
                host: "127.0.0.1",
                port: 8080,
                status: "running",
                last_heartbeat_ts: 1234567890,
                started_ts: 1234560000,
            };

            transport.request = vi.fn().mockResolvedValue(mockWorker);

            await workerManager.registerWorker(workerInfo);

            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/v1/register",
                undefined,
                workerInfo,
                expect.objectContaining({ prefix: "/_synapse/worker" }),
            );
        });

        it("sendCommand 应该传递正确的 body", async () => {
            transport.request = vi.fn().mockResolvedValue({});

            await workerManager.sendCommand("worker-1", {
                command_type: "custom_command",
                command_data: { key: "value" },
                priority: 5,
                max_retries: 3,
            });

            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/v1/workers/worker-1/commands",
                undefined,
                {
                    command_type: "custom_command",
                    command_data: { key: "value" },
                    priority: 5,
                    max_retries: 3,
                },
                expect.objectContaining({ prefix: "/_synapse/worker" }),
            );
        });

        it("assignTask 应该传递正确的 body", async () => {
            transport.request = vi.fn().mockResolvedValue({
                task_id: "task-1",
                task_type: "http",
                status: "assigned",
                assigned_worker_id: "worker-1",
            });

            await workerManager.assignTask({
                task_type: "http",
                task_data: { path: "/sync" },
                priority: 10,
                preferred_worker_id: "worker-1",
            });

            expect(transport.request).toHaveBeenCalledWith(
                Method.Post,
                "/v1/tasks",
                undefined,
                {
                    task_type: "http",
                    task_data: { path: "/sync" },
                    priority: 10,
                    preferred_worker_id: "worker-1",
                },
                expect.objectContaining({ prefix: "/_synapse/worker" }),
            );
        });
    });
});