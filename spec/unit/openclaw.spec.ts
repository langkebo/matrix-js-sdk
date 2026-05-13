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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatrixClient } from "../../src/client.ts";
import { OpenClawManager } from "../../src/openclaw/index.ts";
import { Method } from "../../src/http-api/method.ts";
import { ClientPrefix } from "../../src/http-api/prefix.ts";

describe("OpenClawManager", () => {
    let mockClient: any;
    let manager: OpenClawManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        manager = new OpenClawManager(mockClient as MatrixClient);
    });

    describe("Connections", () => {
        it("should list connections", async () => {
            mockClient.http.authedRequest.mockResolvedValue([]);
            const result = await manager.listConnections();
            expect(result).toEqual([]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/org.synapse_rust.openclaw/connections",
                undefined,
                undefined,
                { prefix: ClientPrefix.Unstable },
            );
        });

        it("should create a connection", async () => {
            const request = { name: "test", provider: "openai", base_url: "http://test" };
            mockClient.http.authedRequest.mockResolvedValue({ id: 1, ...request });
            const result = await manager.createConnection(request);
            expect(result.id).toBe(1);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/org.synapse_rust.openclaw/connections",
                undefined,
                request,
                { prefix: ClientPrefix.Unstable },
            );
        });

        it("should get a connection", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ id: 1 });
            const result = await manager.getConnection(1);
            expect(result.id).toBe(1);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/org.synapse_rust.openclaw/connections/1",
                undefined,
                undefined,
                { prefix: ClientPrefix.Unstable },
            );
        });
    });

    describe("Conversations", () => {
        it("should create a conversation", async () => {
            const request = { title: "test conversation" };
            mockClient.http.authedRequest.mockResolvedValue({ id: 1, ...request });
            const result = await manager.createConversation(request);
            expect(result.id).toBe(1);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/org.synapse_rust.openclaw/conversations",
                undefined,
                request,
                { prefix: ClientPrefix.Unstable },
            );
        });
    });

    describe("Messages", () => {
        it("should list messages for a conversation", async () => {
            mockClient.http.authedRequest.mockResolvedValue([]);
            const result = await manager.listMessages(1);
            expect(result).toEqual([]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/org.synapse_rust.openclaw/conversations/1/messages",
                undefined,
                undefined,
                { prefix: ClientPrefix.Unstable },
            );
        });

        it("should send a message", async () => {
            const request = { content: "hello" };
            mockClient.http.authedRequest.mockResolvedValue({ id: 1, ...request });
            const result = await manager.sendMessage(1, request);
            expect(result.id).toBe(1);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/org.synapse_rust.openclaw/conversations/1/messages",
                undefined,
                request,
                { prefix: ClientPrefix.Unstable },
            );
        });
    });

    describe("Generations", () => {
        it("should create a generation", async () => {
            const request = { conversation_id: 1, model_id: "gpt-4", prompt: "hi" };
            mockClient.http.authedRequest.mockResolvedValue({ id: 1, ...request });
            const result = await manager.createGeneration(request);
            expect(result.id).toBe(1);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/org.synapse_rust.openclaw/generations",
                undefined,
                request,
                { prefix: ClientPrefix.Unstable },
            );
        });
    });

    describe("Roles", () => {
        it("should list roles", async () => {
            mockClient.http.authedRequest.mockResolvedValue([]);
            const result = await manager.listRoles();
            expect(result).toEqual([]);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/org.synapse_rust.openclaw/roles",
                undefined,
                undefined,
                { prefix: ClientPrefix.Unstable },
            );
        });
    });
});
