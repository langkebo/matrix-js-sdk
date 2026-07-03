import { describe, it, expect, beforeEach, vi } from "vitest";
import { SendingManager } from "../../src/sending/index";
import type { ISendEventResponse } from "../../src/@types/requests";

function mockResolvedEvent(eventId = "$event"): ISendEventResponse {
    return { event_id: eventId };
}

describe("SendingManager", () => {
    let manager: SendingManager;
    let mockClient: Record<string, ReturnType<typeof vi.fn>>;

    beforeEach(() => {
        mockClient = {
            sendEvent: vi.fn().mockResolvedValue(mockResolvedEvent()),
            sendMessage: vi.fn().mockResolvedValue(mockResolvedEvent()),
            sendTextMessage: vi.fn().mockResolvedValue(mockResolvedEvent()),
            sendHtmlMessage: vi.fn().mockResolvedValue(mockResolvedEvent()),
            sendEmoteMessage: vi.fn().mockResolvedValue(mockResolvedEvent()),
            sendNotice: vi.fn().mockResolvedValue(mockResolvedEvent()),
            sendImageMessage: vi.fn().mockResolvedValue(mockResolvedEvent()),
        };
        manager = new SendingManager(mockClient as any);
    });

    // ─── sendEvent ──────────────────────────────────────────────────

    it("sendEvent should delegate to client.sendEvent with eventType and content", async () => {
        mockClient.sendEvent.mockResolvedValue(mockResolvedEvent("$abc"));
        const result = await manager.sendEvent("!room:example.com", "m.room.message", { body: "hello" });
        expect(result.event_id).toBe("$abc");
        expect(mockClient.sendEvent).toHaveBeenCalled();
    });

    it("sendEvent should pass threadId when provided as first optional param", async () => {
        await manager.sendEvent("!room:example.com", "$thread123", "m.room.message", { body: "in thread" });
        expect(mockClient.sendEvent).toHaveBeenCalledWith(
            "!room:example.com",
            "$thread123",
            "m.room.message",
            { body: "in thread" },
            undefined,
        );
    });

    it("sendEvent should propagate client errors", async () => {
        mockClient.sendEvent.mockRejectedValue(new Error("Send failed"));
        await expect(manager.sendEvent("!room:example.com", "m.room.message", { body: "hello" })).rejects.toThrow(
            "Send failed",
        );
    });

    // ─── sendMessage ──────────────────────────────────────────────────

    it("sendMessage should delegate to client.sendMessage with content", async () => {
        const content = { body: "Hello", msgtype: "m.text" } as any;
        mockClient.sendMessage.mockResolvedValue(mockResolvedEvent("$msg1"));
        const result = await manager.sendMessage("!room:example.com", content);
        expect(result.event_id).toBe("$msg1");
        expect(mockClient.sendMessage).toHaveBeenCalled();
    });

    it("sendMessage should pass threadId when provided", async () => {
        const content = { body: "Hello", msgtype: "m.text" } as any;
        await manager.sendMessage("!room:example.com", "$thread456", content);
        expect(mockClient.sendMessage).toHaveBeenCalledWith("!room:example.com", "$thread456", content, undefined);
    });

    it("sendMessage should pass null threadId correctly", async () => {
        const content = { body: "Hello", msgtype: "m.text" } as any;
        await manager.sendMessage("!room:example.com", null, content);
        expect(mockClient.sendMessage).toHaveBeenCalledWith("!room:example.com", null, content, undefined);
    });

    // ─── sendTextMessage ─────────────────────────────────────────────

    it("sendTextMessage should delegate to client.sendTextMessage", async () => {
        mockClient.sendTextMessage.mockResolvedValue(mockResolvedEvent("$txt1"));
        const result = await manager.sendTextMessage("!room:example.com", "Hello world");
        expect(result.event_id).toBe("$txt1");
        expect(mockClient.sendTextMessage).toHaveBeenCalledWith("!room:example.com", "Hello world", undefined);
    });

    it("sendTextMessage should pass threadId when provided", async () => {
        await manager.sendTextMessage("!room:example.com", "$thread789", "In thread");
        expect(mockClient.sendTextMessage).toHaveBeenCalledWith(
            "!room:example.com",
            "$thread789",
            "In thread",
            undefined,
        );
    });

    // ─── sendHtmlMessage ─────────────────────────────────────────────

    it("sendHtmlMessage should delegate to client.sendHtmlMessage", async () => {
        mockClient.sendHtmlMessage.mockResolvedValue(mockResolvedEvent("$html1"));
        const result = await manager.sendHtmlMessage("!room:example.com", "Hello", "<b>Hello</b>");
        expect(result.event_id).toBe("$html1");
        expect(mockClient.sendHtmlMessage).toHaveBeenCalledWith("!room:example.com", "Hello", "<b>Hello</b>");
    });

    it("sendHtmlMessage should pass threadId when provided", async () => {
        await manager.sendHtmlMessage("!room:example.com", "$thread999", "Hello", "<b>Hello</b>");
        expect(mockClient.sendHtmlMessage).toHaveBeenCalledWith(
            "!room:example.com",
            "$thread999",
            "Hello",
            "<b>Hello</b>",
        );
    });

    // ─── sendEmote ─────────────────────────────────────────────────

    it("sendEmote should delegate to client.sendEmoteMessage", async () => {
        mockClient.sendEmoteMessage.mockResolvedValue(mockResolvedEvent("$em1"));
        const result = await manager.sendEmote("!room:example.com", "* feels happy");
        expect(result.event_id).toBe("$em1");
        expect(mockClient.sendEmoteMessage).toHaveBeenCalledWith("!room:example.com", "* feels happy", undefined);
    });

    it("sendEmote should pass threadId when provided", async () => {
        await manager.sendEmote("!room:example.com", "$t-em", "* waves");
        expect(mockClient.sendEmoteMessage).toHaveBeenCalledWith("!room:example.com", "$t-em", "* waves", undefined);
    });

    it("sendEmote should propagate client errors", async () => {
        mockClient.sendEmoteMessage.mockRejectedValue(new Error("Emote failed"));
        await expect(manager.sendEmote("!room:example.com", "* test")).rejects.toThrow("Emote failed");
    });

    // ─── sendNotice ─────────────────────────────────────────────────

    it("sendNotice should delegate to client.sendNotice", async () => {
        mockClient.sendNotice.mockResolvedValue(mockResolvedEvent("$notice1"));
        const result = await manager.sendNotice("!room:example.com", "System notice");
        expect(result.event_id).toBe("$notice1");
        expect(mockClient.sendNotice).toHaveBeenCalledWith("!room:example.com", "System notice", undefined);
    });

    it("sendNotice should pass threadId when provided", async () => {
        await manager.sendNotice("!room:example.com", "$t-notice", "Notice in thread");
        expect(mockClient.sendNotice).toHaveBeenCalledWith(
            "!room:example.com",
            "$t-notice",
            "Notice in thread",
            undefined,
        );
    });

    it("sendNotice should propagate client errors", async () => {
        mockClient.sendNotice.mockRejectedValue(new Error("Notice failed"));
        await expect(manager.sendNotice("!room:example.com", "notice")).rejects.toThrow("Notice failed");
    });

    // ─── sendImage ──────────────────────────────────────────────────

    it("sendImage should delegate to client.sendImageMessage with url and info", async () => {
        mockClient.sendImageMessage.mockResolvedValue(mockResolvedEvent("$img1"));
        const info = { w: 800, h: 600, mimetype: "image/png", size: 12345 };
        const result = await manager.sendImage("!room:example.com", "mxc://example.com/img", info, "A photo");
        expect(result.event_id).toBe("$img1");
        expect(mockClient.sendImageMessage).toHaveBeenCalledWith(
            "!room:example.com",
            "mxc://example.com/img",
            info,
            "A photo",
        );
    });

    it("sendImage should pass threadId when provided", async () => {
        const info = { w: 100, h: 100 };
        await manager.sendImage("!room:example.com", "$t-img", "mxc://example.com/img", info);
        expect(mockClient.sendImageMessage).toHaveBeenCalledWith(
            "!room:example.com",
            "$t-img",
            "mxc://example.com/img",
            info,
            undefined,
        );
    });

    // ─── sendFile ──────────────────────────────────────────────────

    it("sendFile should delegate to client.sendMessage with file content", async () => {
        mockClient.sendMessage.mockResolvedValue(mockResolvedEvent("$file1"));
        const content = {
            body: "document.pdf",
            msgtype: "m.file",
            info: { mimetype: "application/pdf", size: 999 },
        };
        const result = await manager.sendFile("!room:example.com", content);
        expect(result.event_id).toBe("$file1");
        expect(mockClient.sendMessage).toHaveBeenCalledWith("!room:example.com", null, content, undefined);
    });

    it("sendFile should propagate client errors", async () => {
        mockClient.sendMessage.mockRejectedValue(new Error("File send failed"));
        await expect(manager.sendFile("!room:example.com", { body: "test.pdf", msgtype: "m.file" })).rejects.toThrow(
            "File send failed",
        );
    });

    // ─── extendMatrixClient export ─────────────────────────────────

    it("should export SendingManager class", () => {
        expect(typeof SendingManager).toBe("function");
    });

    it("should have expected prototype methods", () => {
        expect(typeof manager.sendEvent).toBe("function");
        expect(typeof manager.sendMessage).toBe("function");
        expect(typeof manager.sendTextMessage).toBe("function");
        expect(typeof manager.sendHtmlMessage).toBe("function");
        expect(typeof manager.sendEmote).toBe("function");
        expect(typeof manager.sendNotice).toBe("function");
        expect(typeof manager.sendImage).toBe("function");
        expect(typeof manager.sendFile).toBe("function");
    });
});
