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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { AIModule, getAIModule, createAIModule, type AITool } from "../../../src/ai/index";

describe("AIModule", () => {
    let module: AIModule;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        module = new AIModule();
        fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("constructor", () => {
        it("should create an instance with default endpoint", () => {
            expect(module.getEndpoint()).toBe("http://127.0.0.1:3333/mcp");
        });

        it("should have isConnected as false initially", () => {
            expect(module.isConnected).toBe(false);
        });
    });

    describe("setEndpoint", () => {
        it("should set custom endpoint", () => {
            module.setEndpoint("http://custom.endpoint:8080/mcp");
            expect(module.getEndpoint()).toBe("http://custom.endpoint:8080/mcp");
        });
    });

    describe("getEndpoint", () => {
        it("should return current endpoint", () => {
            expect(module.getEndpoint()).toBe("http://127.0.0.1:3333/mcp");
        });
    });

    describe("listTools", () => {
        it("should return list of tools", async () => {
            const mockTools: AITool[] = [
                { name: "tool1", description: "desc1", inputSchema: {} },
                { name: "tool2", description: "desc2", inputSchema: {} },
            ];

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: { tools: mockTools }, id: 1 }),
            });

            const tools = await module.listTools();
            expect(tools).toEqual(mockTools);
        });

        it("should return empty array when no tools", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: { tools: [] }, id: 1 }),
            });

            const tools = await module.listTools();
            expect(tools).toEqual([]);
        });
    });

    describe("callTool", () => {
        it("should call a tool with arguments", async () => {
            const mockResult = { success: true };

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: mockResult, id: 1 }),
            });

            const result = await module.callTool("test_tool", { arg1: "value1" });

            expect(result).toEqual(mockResult);
            expect(fetchMock).toHaveBeenCalledWith(
                "http://127.0.0.1:3333/mcp",
                expect.objectContaining({
                    method: "POST",
                    body: expect.stringContaining('"name":"test_tool"'),
                }),
            );
        });

        it("should throw error on MCP error response", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () =>
                    Promise.resolve({
                        jsonrpc: "2.0",
                        error: { code: -32600, message: "Invalid Request" },
                        id: 1,
                    }),
            });

            await expect(module.callTool("test_tool")).rejects.toThrow("MCP Error -32600: Invalid Request");
        });

        it("should throw error on HTTP error", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
            });

            await expect(module.callTool("test_tool")).rejects.toThrow("HTTP 500: Internal Server Error");
        });
    });

    describe("getLatestNews", () => {
        it("should return news with default platforms", async () => {
            const mockResult = {
                news: [
                    { title: "News 1", url: "http://example.com/1", platform: "知乎" },
                    { title: "News 2", url: "http://example.com/2", platform: "今日头条" },
                ],
                total: 2,
            };

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: mockResult, id: 1 }),
            });

            const result = await module.getLatestNews();

            expect(result.news).toHaveLength(2);
            expect(result.total).toBe(2);
        });

        it("should return news with custom platforms and limit", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: { news: [], total: 0 }, id: 1 }),
            });

            await module.getLatestNews(["微博", "Twitter"], 20);

            expect(fetchMock).toHaveBeenCalledWith(
                "http://127.0.0.1:3333/mcp",
                expect.objectContaining({
                    body: expect.stringContaining("get_latest_news"),
                }),
            );
        });

        it("should handle array result", async () => {
            const mockArray = [{ title: "News 1" }, { title: "News 2" }];

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: mockArray, id: 1 }),
            });

            const result = await module.getLatestNews();

            expect(result.news).toHaveLength(2);
            expect(result.total).toBe(2);
        });
    });

    describe("searchNews", () => {
        it("should search news with keyword", async () => {
            const mockResult = {
                news: [{ title: "Search Result", url: "http://example.com", platform: "知乎" }],
                total: 1,
            };

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: mockResult, id: 1 }),
            });

            const result = await module.searchNews("test keyword");

            expect(result.news).toHaveLength(1);
            expect(fetchMock).toHaveBeenCalledWith(
                "http://127.0.0.1:3333/mcp",
                expect.objectContaining({
                    body: expect.stringContaining('"keyword":"test keyword"'),
                }),
            );
        });
    });

    describe("getTrendingTopics", () => {
        it("should return trending topics", async () => {
            const mockResult = { topics: ["Topic1", "Topic2", "Topic3"] };

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: mockResult, id: 1 }),
            });

            const topics = await module.getTrendingTopics(10);

            expect(topics).toEqual(["Topic1", "Topic2", "Topic3"]);
        });

        it("should handle array result", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: ["Topic1", "Topic2"], id: 1 }),
            });

            const topics = await module.getTrendingTopics();

            expect(topics).toEqual(["Topic1", "Topic2"]);
        });
    });

    describe("getLatestRss", () => {
        it("should return RSS articles", async () => {
            const mockResult = { articles: [{ title: "Article 1" }, { title: "Article 2" }] };

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: mockResult, id: 1 }),
            });

            const articles = await module.getLatestRss(["http://feed.example.com"], 10);

            expect(articles).toHaveLength(2);
        });
    });

    describe("analyzeTopicTrend", () => {
        it("should analyze topic trend", async () => {
            const mockResult = { trend: "rising", score: 0.85 };

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: mockResult, id: 1 }),
            });

            const result = await module.analyzeTopicTrend("AI");

            expect(result).toEqual(mockResult);
        });
    });

    describe("healthCheck", () => {
        it("should return true when connected", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ jsonrpc: "2.0", result: { tools: [] }, id: 1 }),
            });

            const result = await module.healthCheck();

            expect(result).toBe(true);
            expect(module.isConnected).toBe(true);
        });

        it("should return false when not connected", async () => {
            fetchMock.mockRejectedValueOnce(new Error("Connection failed"));

            const result = await module.healthCheck();

            expect(result).toBe(false);
            expect(module.isConnected).toBe(false);
        });
    });

    describe("request timeout", () => {
        it("should handle request timeout", async () => {
            const abortError = new Error("The operation was aborted");
            abortError.name = "AbortError";
            fetchMock.mockRejectedValueOnce(abortError);

            await expect(module.listTools()).rejects.toThrow("MCP request timeout");
        });
    });
});

describe("getAIModule", () => {
    it("should return singleton instance", () => {
        const instance1 = getAIModule();
        const instance2 = getAIModule();

        expect(instance1).toBe(instance2);
    });
});

describe("createAIModule", () => {
    it("should create new instance with custom endpoint", () => {
        const instance = createAIModule("http://custom:8080/mcp");

        expect(instance.getEndpoint()).toBe("http://custom:8080/mcp");
    });

    it("should create instance without endpoint", () => {
        const instance = createAIModule();

        expect(instance.getEndpoint()).toBe("http://127.0.0.1:3333/mcp");
    });
});
