import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { AIConnectionManager, AIConnectionEvent } from "../../src/ai-connection/index";
import type { AiApiVersion } from "../../src/ai-connection/index";
import { AI_CONNECTION_ROUTES } from "../../src/ai-connection/__generated__/route-table";

type MockAIConnectionClient = {
    http: {
        authedRequest: ReturnType<typeof vi.fn>;
    };
    doesServerAdvertiseSynapseRustFeature?: ReturnType<typeof vi.fn>;
};

describe("AIConnectionManager", () => {
    let mockClient: MockAIConnectionClient;
    let manager: AIConnectionManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new AIConnectionManager(
            mockClient as unknown as ConstructorParameters<typeof AIConnectionManager>[0],
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("route table alignment", () => {
        it("should have 12 routes in the generated route table", () => {
            expect(AI_CONNECTION_ROUTES).toHaveLength(12);
        });

        it("should cover v1 and v3 paths", () => {
            const v1Paths = AI_CONNECTION_ROUTES.filter((r) => r.path.startsWith("/_matrix/client/v1/ai"));
            const v3Paths = AI_CONNECTION_ROUTES.filter((r) => r.path.startsWith("/_matrix/client/v3/ai"));
            expect(v1Paths).toHaveLength(6);
            expect(v3Paths).toHaveLength(6);
        });
    });

    describe("listConnections", () => {
        it("should call GET /connections with v1 prefix by default", async () => {
            mockClient.http.authedRequest.mockResolvedValue([]);
            await manager.listConnections();
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/connections", undefined, undefined, {
                prefix: "/_matrix/client/v1/ai",
            });
        });

        it("should call GET /connections with v3 prefix when specified", async () => {
            mockClient.http.authedRequest.mockResolvedValue([]);
            await manager.listConnections("v3");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/connections", undefined, undefined, {
                prefix: "/_matrix/client/v3/ai",
            });
        });
    });

    describe("createConnection", () => {
        it("should call POST /connections with request body", async () => {
            const req = { provider: "openai", config: { apiKey: "sk-xxx" } };
            const mockResponse = {
                id: "conn1",
                user_id: "user1",
                provider: "openai",
                is_active: true,
                created_ts: 1000,
            };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);
            const result = await manager.createConnection(req);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("POST", "/connections", undefined, req, {
                prefix: "/_matrix/client/v1/ai",
            });
            expect(result).toEqual(mockResponse);
        });

        it("should emit ConnectionCreated event", async () => {
            const req = { provider: "openai" };
            const mockResponse = {
                id: "conn1",
                user_id: "user1",
                provider: "openai",
                is_active: true,
                created_ts: 1000,
            };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);
            const listener = vi.fn();
            manager.on(AIConnectionEvent.ConnectionCreated, listener);
            await manager.createConnection(req);
            expect(listener).toHaveBeenCalledWith(mockResponse);
        });

        it("should throw on empty provider", async () => {
            await expect(manager.createConnection({ provider: "" })).rejects.toThrow();
        });
    });

    describe("getConnection", () => {
        it("should call GET /connections/{id}", async () => {
            const mockResponse = {
                id: "conn1",
                user_id: "user1",
                provider: "openai",
                is_active: true,
                created_ts: 1000,
            };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);
            const result = await manager.getConnection("conn1");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/connections/conn1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1/ai" },
            );
            expect(result).toEqual(mockResponse);
        });

        it("should throw on empty id", async () => {
            await expect(manager.getConnection("")).rejects.toThrow();
        });

        it("should use v3 prefix when specified", async () => {
            mockClient.http.authedRequest.mockResolvedValue({});
            await manager.getConnection("conn1", "v3");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/connections/conn1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3/ai" },
            );
        });
    });

    describe("deleteConnection", () => {
        it("should call DELETE /connections/{id}", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);
            await manager.deleteConnection("conn1");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "DELETE",
                "/connections/conn1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1/ai" },
            );
        });

        it("should emit ConnectionDeleted event", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);
            const listener = vi.fn();
            manager.on(AIConnectionEvent.ConnectionDeleted, listener);
            await manager.deleteConnection("conn1");
            expect(listener).toHaveBeenCalledWith("conn1");
        });
    });

    describe("listMcpTools", () => {
        it("should call GET /mcp/tools with provider query param", async () => {
            const mockResponse = { tools: [{ name: "search", description: "Search the web" }] };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);
            const result = await manager.listMcpTools("openai");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                "/mcp/tools",
                { provider: "openai" },
                undefined,
                { prefix: "/_matrix/client/v1/ai" },
            );
            expect(result).toEqual(mockResponse);
        });

        it("should throw on empty provider", async () => {
            await expect(manager.listMcpTools("")).rejects.toThrow();
        });
    });

    describe("callMcpTool", () => {
        it("should call POST /mcp/tools/call with request body", async () => {
            const req = { provider: "openai", tool_name: "search", arguments: { query: "test" } };
            const mockResponse = { result: { answer: "42" } };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);
            const result = await manager.callMcpTool(req);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("POST", "/mcp/tools/call", undefined, req, {
                prefix: "/_matrix/client/v1/ai",
            });
            expect(result).toEqual(mockResponse);
        });

        it("should emit ToolCalled event", async () => {
            const req = { provider: "openai", tool_name: "search", arguments: {} };
            const mockResponse = { result: {} };
            mockClient.http.authedRequest.mockResolvedValue(mockResponse);
            const listener = vi.fn();
            manager.on(AIConnectionEvent.ToolCalled, listener);
            await manager.callMcpTool(req);
            expect(listener).toHaveBeenCalledWith(mockResponse);
        });

        it("should throw on empty provider or tool_name", async () => {
            await expect(manager.callMcpTool({ provider: "", tool_name: "search", arguments: {} })).rejects.toThrow();
            await expect(manager.callMcpTool({ provider: "openai", tool_name: "", arguments: {} })).rejects.toThrow();
        });
    });

    describe("API version support", () => {
        const versions: AiApiVersion[] = ["v1", "v3"];
        const expectedPrefixes: Record<AiApiVersion, string> = {
            v1: "/_matrix/client/v1/ai",
            v3: "/_matrix/client/v3/ai",
        };

        for (const version of versions) {
            describe(`version=${version}`, () => {
                it("should use correct prefix for listConnections", async () => {
                    mockClient.http.authedRequest.mockResolvedValue([]);
                    await manager.listConnections(version);
                    const lastCall =
                        mockClient.http.authedRequest.mock.calls[mockClient.http.authedRequest.mock.calls.length - 1];
                    expect(lastCall[4]).toEqual({ prefix: expectedPrefixes[version] });
                });

                it("should use correct prefix for createConnection", async () => {
                    mockClient.http.authedRequest.mockResolvedValue({ id: "1" });
                    await manager.createConnection({ provider: "test" }, version);
                    const lastCall =
                        mockClient.http.authedRequest.mock.calls[mockClient.http.authedRequest.mock.calls.length - 1];
                    expect(lastCall[4]).toEqual({ prefix: expectedPrefixes[version] });
                });

                it("should use correct prefix for listMcpTools", async () => {
                    mockClient.http.authedRequest.mockResolvedValue({ tools: [] });
                    await manager.listMcpTools("test", version);
                    const lastCall =
                        mockClient.http.authedRequest.mock.calls[mockClient.http.authedRequest.mock.calls.length - 1];
                    expect(lastCall[4]).toEqual({ prefix: expectedPrefixes[version] });
                });
            });
        }

        it("prefers the v3 route when centralized discovery advertises ai-connection support", async () => {
            mockClient.doesServerAdvertiseSynapseRustFeature = vi.fn().mockResolvedValue(true);
            mockClient.http.authedRequest.mockResolvedValue([]);

            await manager.listConnections();

            expect(mockClient.doesServerAdvertiseSynapseRustFeature).toHaveBeenCalledWith("ai_connection");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/connections", undefined, undefined, {
                prefix: "/_matrix/client/v3/ai",
            });
        });

        it("keeps the v1 route when discovery is unavailable or not advertised", async () => {
            mockClient.doesServerAdvertiseSynapseRustFeature = vi.fn().mockResolvedValue(false);
            mockClient.http.authedRequest.mockResolvedValue([]);

            await manager.listConnections();

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/connections", undefined, undefined, {
                prefix: "/_matrix/client/v1/ai",
            });
        });
    });
});
