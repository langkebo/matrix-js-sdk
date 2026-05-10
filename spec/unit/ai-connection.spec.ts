import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { AIConnectionEvent, AIConnectionManager } from "../../src/ai-connection/index.ts";
import { InvalidParamError } from "../../src/common/errors.ts";

describe("AIConnectionManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let manager: AIConnectionManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        manager = new AIConnectionManager({ http: { authedRequest } } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("getConnections", () => {
        it("GETs /connections with root prefix and populates cache", async () => {
            authedRequest.mockResolvedValueOnce([
                {
                    id: "c1",
                    user_id: "u",
                    provider: "openai",
                    config: null,
                    is_active: true,
                    created_ts: 0,
                    updated_ts: null,
                },
            ]);

            const res = await manager.getConnections();

            expect(res).toHaveLength(1);
            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/connections", undefined, undefined, {
                prefix: "",
            });
            expect(manager.getCachedConnection("c1")).toBeDefined();
        });

        it("propagates 401 typed errors", async () => {
            const err = Object.assign(new Error("Unauthorized"), {
                httpStatus: 401,
                errcode: "M_UNKNOWN_TOKEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getConnections()).rejects.toMatchObject({ statusCode: 401 });
        });
    });

    describe("createConnection", () => {
        it("rejects missing provider", async () => {
            await expect(manager.createConnection({ provider: "" })).rejects.toBeInstanceOf(InvalidParamError);
        });

        it("POSTs /connections and emits ConnectionCreated", async () => {
            authedRequest.mockResolvedValueOnce({
                id: "c1",
                user_id: "u",
                provider: "openai",
                config: { mcp_url: "x" },
                is_active: true,
                created_ts: 0,
                updated_ts: null,
            });
            const emitted: unknown[] = [];
            manager.on(AIConnectionEvent.ConnectionCreated, (c) => emitted.push(c));

            await manager.createConnection({ provider: "openai", config: { mcp_url: "x" } });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/connections",
                undefined,
                { provider: "openai", config: { mcp_url: "x" } },
                { prefix: "" },
            );
            expect(emitted).toHaveLength(1);
        });

        it("emits Error and propagates on 403", async () => {
            const err = Object.assign(new Error("Forbidden"), {
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            authedRequest.mockRejectedValueOnce(err);
            const errors: unknown[] = [];
            manager.on(AIConnectionEvent.Error, (e) => errors.push(e));

            await expect(manager.createConnection({ provider: "openai" })).rejects.toMatchObject({ statusCode: 403 });
            expect(errors).toHaveLength(1);
        });
    });

    describe("getConnection", () => {
        it("rejects empty id", async () => {
            await expect(manager.getConnection("")).rejects.toBeInstanceOf(InvalidParamError);
        });

        it("URL-encodes the id", async () => {
            authedRequest.mockResolvedValueOnce({
                id: "c/1",
                user_id: "u",
                provider: "p",
                config: null,
                is_active: true,
                created_ts: 0,
                updated_ts: null,
            });

            await manager.getConnection("c/1");

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/connections/c%2F1", undefined, undefined, {
                prefix: "",
            });
        });

        it("propagates 404", async () => {
            const err = Object.assign(new Error("Not Found"), {
                httpStatus: 404,
                errcode: "M_NOT_FOUND",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.getConnection("c1")).rejects.toMatchObject({ statusCode: 404 });
        });
    });

    describe("deleteConnection", () => {
        it("rejects empty id", async () => {
            await expect(manager.deleteConnection("")).rejects.toBeInstanceOf(InvalidParamError);
        });

        it("DELETEs and emits ConnectionDeleted", async () => {
            authedRequest.mockResolvedValueOnce(undefined);
            const emitted: unknown[] = [];
            manager.on(AIConnectionEvent.ConnectionDeleted, (id) => emitted.push(id));

            await manager.deleteConnection("c1");

            expect(authedRequest).toHaveBeenCalledWith(Method.Delete, "/connections/c1", undefined, undefined, {
                prefix: "",
            });
            expect(emitted).toEqual(["c1"]);
        });
    });

    describe("listMcpTools", () => {
        it("rejects empty provider", async () => {
            await expect(manager.listMcpTools("")).rejects.toBeInstanceOf(InvalidParamError);
        });

        it("GETs /mcp/tools with provider query", async () => {
            authedRequest.mockResolvedValueOnce({ tools: [] });

            await manager.listMcpTools("openai");

            expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/mcp/tools", { provider: "openai" }, undefined, {
                prefix: "",
            });
        });
    });

    describe("callMcpTool", () => {
        it("rejects empty provider / toolName", async () => {
            await expect(manager.callMcpTool({ provider: "", toolName: "t" })).rejects.toBeInstanceOf(
                InvalidParamError,
            );
            await expect(manager.callMcpTool({ provider: "p", toolName: "" })).rejects.toBeInstanceOf(
                InvalidParamError,
            );
        });

        it("POSTs /mcp/tools/call with snake_case body and emits ToolCalled", async () => {
            authedRequest.mockResolvedValueOnce({ ok: true });
            const emitted: unknown[] = [];
            manager.on(AIConnectionEvent.ToolCalled, (name, res) => emitted.push({ name, res }));

            await manager.callMcpTool({ provider: "openai", toolName: "echo", arguments: { a: 1 } });

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/mcp/tools/call",
                undefined,
                { provider: "openai", tool_name: "echo", arguments: { a: 1 } },
                { prefix: "" },
            );
            expect(emitted).toEqual([{ name: "echo", res: { ok: true } }]);
        });
    });
});
