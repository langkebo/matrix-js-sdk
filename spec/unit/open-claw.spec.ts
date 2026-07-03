import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { OpenClawManager, OpenClawEvent } from "../../src/open-claw/index";
import { Method } from "../../src/http-api/method";
import { ValidationError } from "../../src/errors";

describe("OpenClawManager", () => {
    let transport: FakeTransport;
    let manager: OpenClawManager;

    beforeEach(() => {
        transport = new FakeTransport();
        manager = new OpenClawManager({} as any, { transport });
    });

    const OPENCLAW_PREFIX = "/_matrix/client/unstable/org.synapse_rust.openclaw";

    // ============ Connections ============

    describe("connections", () => {
        it("should list connections", async () => {
            const connections = [
                {
                    id: 1,
                    name: "OpenAI",
                    provider: "openai",
                    base_url: "https://api.openai.com",
                    has_api_key: true,
                    is_default: true,
                    is_active: true,
                    created_ts: 1000,
                    updated_ts: 1000,
                },
            ];
            transport.respondWith(connections);

            const result = await manager.listConnections();

            expect(result).toEqual(connections);
            transport.expectCalledWith(Method.Get, "/connections");
        });

        it("should create a connection and emit event", async () => {
            const connection = {
                id: 1,
                name: "Anthropic",
                provider: "anthropic",
                base_url: "https://api.anthropic.com",
                has_api_key: true,
                is_default: false,
                is_active: true,
                created_ts: 1000,
                updated_ts: 1000,
            };
            transport.respondWith(connection);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.createConnection({
                name: "Anthropic",
                provider: "anthropic",
                base_url: "https://api.anthropic.com",
            });

            expect(result.id).toBe(1);
            expect(result.name).toBe("Anthropic");
            transport.expectCalledWith(Method.Post, "/connections");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.ConnectionCreated, connection);
        });

        it("should reject creating a connection with empty name", async () => {
            await expect(
                manager.createConnection({ name: "", provider: "openai", base_url: "https://example.com" }),
            ).rejects.toThrow(ValidationError);
        });

        it("should reject creating a connection with empty provider", async () => {
            await expect(
                manager.createConnection({ name: "Test", provider: "", base_url: "https://example.com" }),
            ).rejects.toThrow(ValidationError);
        });

        it("should reject creating a connection with empty base_url", async () => {
            await expect(manager.createConnection({ name: "Test", provider: "openai", base_url: "" })).rejects.toThrow(
                ValidationError,
            );
        });

        it("should get a connection by id", async () => {
            const connection = {
                id: 5,
                name: "Local",
                provider: "ollama",
                base_url: "http://localhost:11434",
                has_api_key: false,
                is_default: false,
                is_active: true,
                created_ts: 2000,
                updated_ts: 2000,
            };
            transport.respondWith(connection);

            const result = await manager.getConnection(5);

            expect(result).toEqual(connection);
            transport.expectCalledWith(Method.Get, "/connections/5");
        });

        it("should reject getConnection with non-positive id", async () => {
            await expect(manager.getConnection(0)).rejects.toThrow(ValidationError);
            await expect(manager.getConnection(-1)).rejects.toThrow(ValidationError);
        });

        it("should update a connection and emit event", async () => {
            const updated = {
                id: 1,
                name: "OpenAI Updated",
                provider: "openai",
                base_url: "https://api.openai.com",
                has_api_key: true,
                is_default: true,
                is_active: true,
                created_ts: 1000,
                updated_ts: 2000,
            };
            transport.respondWith(updated);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.updateConnection(1, { name: "OpenAI Updated" });

            expect(result.name).toBe("OpenAI Updated");
            transport.expectCalledWith(Method.Put, "/connections/1");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.ConnectionUpdated, updated);
        });

        it("should delete a connection and emit event", async () => {
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.deleteConnection(3);

            transport.expectCalledWith(Method.Delete, "/connections/3");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.ConnectionDeleted, 3);
        });

        it("should test a connection and emit event", async () => {
            const testResult = { success: true, message: "Connected", latency_ms: 150 };
            transport.respondWith(testResult);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.testConnection(1);

            expect(result.success).toBe(true);
            expect(result.latency_ms).toBe(150);
            transport.expectCalledWith(Method.Post, "/connections/1/test");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.ConnectionTested, testResult);
        });
    });

    // ============ Conversations ============

    describe("conversations", () => {
        it("should list conversations with pagination", async () => {
            const paginated = {
                items: [
                    { id: 10, connection_id: 1, title: "Chat 1", is_pinned: false, created_ts: 3000, updated_ts: 3000 },
                ],
                total: 1,
                has_more: false,
            };
            transport.respondWith(paginated);

            const result = await manager.listConversations({ limit: 10, offset: 0 });

            expect(result.items).toHaveLength(1);
            expect(result.total).toBe(1);
            transport.expectCalledWith(Method.Get, "/conversations");
        });

        it("should create a conversation and emit event", async () => {
            const conversation = {
                id: 10,
                connection_id: 1,
                title: "New Chat",
                is_pinned: false,
                created_ts: 4000,
                updated_ts: 4000,
            };
            transport.respondWith(conversation);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.createConversation({ title: "New Chat" });

            expect(result.id).toBe(10);
            transport.expectCalledWith(Method.Post, "/conversations");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.ConversationCreated, conversation);
        });

        it("should get a conversation by id", async () => {
            const conversation = {
                id: 10,
                connection_id: 1,
                title: "Existing Chat",
                is_pinned: true,
                created_ts: 5000,
                updated_ts: 5000,
            };
            transport.respondWith(conversation);

            const result = await manager.getConversation(10);

            expect(result.title).toBe("Existing Chat");
            expect(result.is_pinned).toBe(true);
            transport.expectCalledWith(Method.Get, "/conversations/10");
        });

        it("should update a conversation and emit event", async () => {
            const updated = {
                id: 10,
                connection_id: 1,
                title: "Renamed Chat",
                is_pinned: true,
                created_ts: 5000,
                updated_ts: 6000,
            };
            transport.respondWith(updated);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.updateConversation(10, { title: "Renamed Chat", is_pinned: true });

            expect(result.title).toBe("Renamed Chat");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.ConversationUpdated, updated);
        });

        it("should delete a conversation and emit event", async () => {
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.deleteConversation(10);

            transport.expectCalledWith(Method.Delete, "/conversations/10");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.ConversationDeleted, 10);
        });
    });

    // ============ Messages ============

    describe("messages", () => {
        it("should list messages for a conversation", async () => {
            const paginated = {
                items: [{ id: 100, conversation_id: 10, role: "user", content: "Hello", created_ts: 6000 }],
                total: 1,
                has_more: false,
            };
            transport.respondWith(paginated);

            const result = await manager.listMessages(10, { limit: 50 });

            expect(result.items).toHaveLength(1);
            transport.expectCalledWith(Method.Get, "/conversations/10/messages");
        });

        it("should reject listMessages with non-positive conversation id", async () => {
            await expect(manager.listMessages(0)).rejects.toThrow(ValidationError);
        });

        it("should send a message and emit event", async () => {
            const message = { id: 100, conversation_id: 10, role: "assistant", content: "Hi there!", created_ts: 7000 };
            transport.respondWith(message);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.sendMessage(10, { content: "Hi there!" });

            expect(result.content).toBe("Hi there!");
            transport.expectCalledWith(Method.Post, "/conversations/10/messages");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.MessageSent, message);
        });

        it("should reject sending a message with empty content", async () => {
            await expect(manager.sendMessage(10, { content: "" })).rejects.toThrow(ValidationError);
        });

        it("should send a conversation message via shorthand", async () => {
            const message = { id: 101, conversation_id: 10, role: "user", content: "Quick message", created_ts: 8000 };
            transport.respondWith(message);

            const result = await manager.sendConversationMessage(10, "Quick message");

            expect(result.content).toBe("Quick message");
            transport.expectCalledWith(Method.Post, "/conversations/10/messages");
        });

        it("should delete a message and emit event", async () => {
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.deleteMessage(42);

            transport.expectCalledWith(Method.Delete, "/messages/42");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.MessageDeleted, 42);
        });
    });

    // ============ Generations ============

    describe("generations", () => {
        it("should list generations with pagination", async () => {
            const paginated = {
                items: [
                    {
                        id: 200,
                        type: "image",
                        prompt: "A cat",
                        status: "completed",
                        created_ts: 9000,
                        updated_ts: 9000,
                    },
                ],
                total: 1,
                has_more: false,
            };
            transport.respondWith(paginated);

            const result = await manager.listGenerations({ type: "image" });

            expect(result.items).toHaveLength(1);
            transport.expectCalledWith(Method.Get, "/generations");
        });

        it("should create a generation and emit event", async () => {
            const generation = {
                id: 200,
                type: "text",
                prompt: "Write a poem",
                status: "pending",
                created_ts: 10000,
                updated_ts: 10000,
            };
            transport.respondWith(generation);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.createGeneration({ type: "text", prompt: "Write a poem" });

            expect(result.id).toBe(200);
            transport.expectCalledWith(Method.Post, "/generations");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.GenerationCreated, generation);
        });

        it("should reject creating a generation with empty type", async () => {
            await expect(manager.createGeneration({ type: "", prompt: "prompt" })).rejects.toThrow(ValidationError);
        });

        it("should reject creating a generation with empty prompt", async () => {
            await expect(manager.createGeneration({ type: "text", prompt: "" })).rejects.toThrow(ValidationError);
        });

        it("should get a generation by id", async () => {
            const generation = {
                id: 200,
                type: "text",
                prompt: "Poem",
                status: "completed",
                created_ts: 11000,
                updated_ts: 11000,
            };
            transport.respondWith(generation);

            const result = await manager.getGeneration(200);

            expect(result.status).toBe("completed");
            transport.expectCalledWith(Method.Get, "/generations/200");
        });

        it("should delete a generation and emit event", async () => {
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.deleteGeneration(200);

            transport.expectCalledWith(Method.Delete, "/generations/200");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.GenerationDeleted, 200);
        });
    });

    // ============ Chat Roles ============

    describe("chat roles", () => {
        it("should list chat roles", async () => {
            const roles = [
                {
                    id: 1,
                    name: "Assistant",
                    system_message: "You are helpful",
                    is_public: true,
                    created_ts: 12000,
                    updated_ts: 12000,
                },
            ];
            transport.respondWith(roles);

            const result = await manager.listChatRoles();

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("Assistant");
            transport.expectCalledWith(Method.Get, "/roles");
        });

        it("should create a chat role and emit event", async () => {
            const role = {
                id: 2,
                name: "Translator",
                system_message: "Translate text",
                is_public: true,
                created_ts: 13000,
                updated_ts: 13000,
            };
            transport.respondWith(role);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.createChatRole({ name: "Translator", system_message: "Translate text" });

            expect(result.name).toBe("Translator");
            transport.expectCalledWith(Method.Post, "/roles");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.RoleCreated, role);
        });

        it("should reject creating a chat role with empty name", async () => {
            await expect(manager.createChatRole({ name: "", system_message: "msg" })).rejects.toThrow(ValidationError);
        });

        it("should reject creating a chat role with empty system_message", async () => {
            await expect(manager.createChatRole({ name: "Role", system_message: "" })).rejects.toThrow(ValidationError);
        });

        it("should get a chat role by id", async () => {
            const role = {
                id: 3,
                name: "Critic",
                system_message: "Be critical",
                is_public: false,
                created_ts: 14000,
                updated_ts: 14000,
            };
            transport.respondWith(role);

            const result = await manager.getChatRole(3);

            expect(result.name).toBe("Critic");
            transport.expectCalledWith(Method.Get, "/roles/3");
        });

        it("should update a chat role and emit event", async () => {
            const updated = {
                id: 1,
                name: "Assistant v2",
                system_message: "You are helpful",
                is_public: true,
                created_ts: 12000,
                updated_ts: 15000,
            };
            transport.respondWith(updated);
            const emitSpy = vi.spyOn(manager, "emit");

            const result = await manager.updateChatRole(1, { name: "Assistant v2" });

            expect(result.name).toBe("Assistant v2");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.RoleUpdated, updated);
        });

        it("should delete a chat role and emit event", async () => {
            transport.respondWith(undefined as any);
            const emitSpy = vi.spyOn(manager, "emit");

            await manager.deleteChatRole(7);

            transport.expectCalledWith(Method.Delete, "/roles/7");
            expect(emitSpy).toHaveBeenCalledWith(OpenClawEvent.RoleDeleted, 7);
        });
    });

    // ============ Validation ============

    describe("validation", () => {
        it("should reject getConnection with non-integer id", async () => {
            await expect(manager.getConnection(1.5 as any)).rejects.toThrow(ValidationError);
        });

        it("should reject getConversation with non-positive id", async () => {
            await expect(manager.getConversation(-5)).rejects.toThrow(ValidationError);
        });

        it("should reject sendMessage with non-positive conversationId", async () => {
            await expect(manager.sendMessage(-1, { content: "hello" })).rejects.toThrow(ValidationError);
        });

        it("should reject deleteMessage with non-positive id", async () => {
            await expect(manager.deleteMessage(0)).rejects.toThrow(ValidationError);
        });
    });

    // ============ Prefix verification ============

    describe("prefix verification", () => {
        it("should use correct OpenClaw prefix for all requests", async () => {
            transport.respondWith([]);

            await manager.listConnections();

            const call = transport.request.mock.calls[0];
            const opts = call[4];
            expect(opts?.prefix).toBe(OPENCLAW_PREFIX);
        });

        it("should include retry config in requests", async () => {
            transport.respondWith({ id: 1 } as any);

            await manager.getConnection(1);

            const call = transport.request.mock.calls[0];
            const opts = call[4];
            expect(opts?.prefix).toBe(OPENCLAW_PREFIX);
        });
    });
});
