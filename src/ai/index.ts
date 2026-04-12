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

/**
 * AI Module - AI 集成模块
 *
 * 提供 MCP (Model Context Protocol) 协议集成，支持 AI 工具调用
 * 主要用于 TrendRadar 等 AI 服务集成
 */

export interface AITool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export interface AINewsItem {
    title: string;
    url: string;
    platform: string;
    publishTime?: string;
    summary?: string;
}

export interface AINewsResult {
    news: AINewsItem[];
    total: number;
}

export interface McpRpcRequest {
    jsonrpc: "2.0";
    method: string;
    params?: {
        name?: string;
        arguments?: Record<string, unknown>;
    };
    id: number | string;
}

export interface McpRpcResponse {
    jsonrpc: "2.0";
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
    id: number | string;
}

const DEFAULT_MCP_ENDPOINT = "http://127.0.0.1:3333/mcp";
const DEFAULT_TIMEOUT = 30000;

export class AIModule {
    private mcpEndpoint: string = DEFAULT_MCP_ENDPOINT;
    private requestId: number = 0;
    private _isConnected: boolean = false;

    public constructor() {}

    public get isConnected(): boolean {
        return this._isConnected;
    }

    public setEndpoint(endpoint: string): void {
        this.mcpEndpoint = endpoint;
    }

    public getEndpoint(): string {
        return this.mcpEndpoint;
    }

    private async callMcp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
        const id = ++this.requestId;

        const request: McpRpcRequest = {
            jsonrpc: "2.0",
            method,
            params: params ? { arguments: params } : undefined,
            id,
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

        try {
            const response = await fetch(this.mcpEndpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(request),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data: McpRpcResponse = await response.json();

            if (data.error) {
                throw new Error(`MCP Error ${data.error.code}: ${data.error.message}`);
            }

            this._isConnected = true;
            return data.result as T;
        } catch (err) {
            clearTimeout(timeoutId);
            this._isConnected = false;

            if (err instanceof Error && err.name === "AbortError") {
                throw new Error("MCP request timeout");
            }
            throw err;
        }
    }

    public async listTools(): Promise<AITool[]> {
        const result = await this.callMcp<{ tools: AITool[] }>("tools/list");
        return result.tools || [];
    }

    public async callTool(toolName: string, args?: Record<string, unknown>): Promise<unknown> {
        return this.callMcp<unknown>("tools/call", {
            name: toolName,
            arguments: args || {},
        });
    }

    public async getLatestNews(platforms?: string[], limit: number = 10): Promise<AINewsResult> {
        const result = await this.callTool("get_latest_news", {
            platforms: platforms || ["知乎", "今日头条", "百度热搜"],
            limit,
        });

        if (typeof result === "object" && result !== null && "news" in result) {
            const r = result as { news: AINewsItem[]; total?: number };
            return {
                news: r.news || [],
                total: r.total || r.news?.length || 0,
            };
        }

        return {
            news: Array.isArray(result) ? (result as AINewsItem[]) : [],
            total: Array.isArray(result) ? (result as AINewsItem[]).length : 0,
        };
    }

    public async searchNews(keyword: string, limit: number = 10): Promise<AINewsResult> {
        const result = await this.callTool("search_news", {
            keyword,
            limit,
        });

        if (typeof result === "object" && result !== null && "news" in result) {
            const r = result as { news: AINewsItem[]; total?: number };
            return {
                news: r.news || [],
                total: r.total || r.news?.length || 0,
            };
        }

        return {
            news: Array.isArray(result) ? (result as AINewsItem[]) : [],
            total: Array.isArray(result) ? (result as AINewsItem[]).length : 0,
        };
    }

    public async getTrendingTopics(limit: number = 10): Promise<unknown[]> {
        const result = await this.callTool("get_trending_topics", { limit });
        if (typeof result === "object" && result !== null && "topics" in result) {
            const r = result as { topics: unknown[] };
            return r.topics || [];
        }
        return Array.isArray(result) ? result : [];
    }

    public async getLatestRss(feeds?: string[], limit: number = 10): Promise<unknown[]> {
        const result = await this.callTool("get_latest_rss", {
            feeds: feeds || [],
            limit,
        });
        if (typeof result === "object" && result !== null && "articles" in result) {
            const r = result as { articles: unknown[] };
            return r.articles || [];
        }
        return Array.isArray(result) ? result : [];
    }

    public async analyzeTopicTrend(topic: string): Promise<unknown> {
        return this.callTool("analyze_topic_trend", { topic });
    }

    public async healthCheck(): Promise<boolean> {
        try {
            await this.listTools();
            this._isConnected = true;
            return true;
        } catch {
            this._isConnected = false;
            return false;
        }
    }
}

let defaultAIModule: AIModule | null = null;

export function getAIModule(): AIModule {
    if (!defaultAIModule) {
        defaultAIModule = new AIModule();
    }
    return defaultAIModule;
}

export function createAIModule(endpoint?: string): AIModule {
    const module = new AIModule();
    if (endpoint) {
        module.setEndpoint(endpoint);
    }
    return module;
}

export default AIModule;
