import { describe, it, expect, beforeEach, vi } from "vitest";
import { SendingManager } from "../../src/sending/index";
import { MsgType } from "../../src/@types/event";
import type { ISendEventResponse } from "../../src/@types/requests";

function mockResolvedEvent(eventId = "$event"): ISendEventResponse {
    return { event_id: eventId };
}

const MOCK_TXN_ID = "txn-fixed-1";

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
            makeTxnId: vi.fn().mockReturnValue(MOCK_TXN_ID),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager = new SendingManager(mockClient as any);
    });

    // ─── sendEvent ──────────────────────────────────────────────────

    it("sendEvent should delegate to client.sendEvent with eventType and content", async () => {
        mockClient.sendEvent.mockResolvedValue(mockResolvedEvent("$abc"));
        const result = await manager.sendEvent("!room:example.com", "m.room.message", { body: "hello" });
        expect(result.event_id).toBe("$abc");
        expect(mockClient.sendEvent).toHaveBeenCalledWith(
            "!room:example.com",
            "m.room.message",
            { body: "hello" },
            MOCK_TXN_ID,
        );
    });

    it("sendEvent should pass threadId when provided as first optional param", async () => {
        await manager.sendEvent("!room:example.com", "$thread123", "m.room.message", { body: "in thread" });
        expect(mockClient.sendEvent).toHaveBeenCalledWith(
            "!room:example.com",
            "$thread123",
            "m.room.message",
            { body: "in thread" },
            MOCK_TXN_ID,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = { body: "Hello", msgtype: "m.text" } as any;
        mockClient.sendMessage.mockResolvedValue(mockResolvedEvent("$msg1"));
        const result = await manager.sendMessage("!room:example.com", content);
        expect(result.event_id).toBe("$msg1");
        expect(mockClient.sendMessage).toHaveBeenCalledWith("!room:example.com", content, MOCK_TXN_ID);
    });

    it("sendMessage should pass threadId when provided", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = { body: "Hello", msgtype: "m.text" } as any;
        await manager.sendMessage("!room:example.com", "$thread456", content);
        expect(mockClient.sendMessage).toHaveBeenCalledWith("!room:example.com", "$thread456", content, MOCK_TXN_ID);
    });

    it("sendMessage should pass null threadId correctly", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = { body: "Hello", msgtype: "m.text" } as any;
        await manager.sendMessage("!room:example.com", null, content);
        expect(mockClient.sendMessage).toHaveBeenCalledWith("!room:example.com", null, content, MOCK_TXN_ID);
    });

    // ─── sendTextMessage ─────────────────────────────────────────────

    it("sendTextMessage should delegate to client.sendTextMessage", async () => {
        mockClient.sendTextMessage.mockResolvedValue(mockResolvedEvent("$txt1"));
        const result = await manager.sendTextMessage("!room:example.com", "Hello world");
        expect(result.event_id).toBe("$txt1");
        expect(mockClient.sendTextMessage).toHaveBeenCalledWith("!room:example.com", "Hello world", MOCK_TXN_ID);
    });

    it("sendTextMessage should pass threadId when provided", async () => {
        await manager.sendTextMessage("!room:example.com", "$thread789", "In thread");
        expect(mockClient.sendTextMessage).toHaveBeenCalledWith(
            "!room:example.com",
            "$thread789",
            "In thread",
            MOCK_TXN_ID,
        );
    });

    // ─── sendHtmlMessage ─────────────────────────────────────────────

    it("sendHtmlMessage should delegate with html content via sendMessage", async () => {
        mockClient.sendMessage.mockResolvedValue(mockResolvedEvent("$html1"));
        const result = await manager.sendHtmlMessage("!room:example.com", "Hello", "<b>Hello</b>");
        expect(result.event_id).toBe("$html1");
        expect(mockClient.sendMessage).toHaveBeenCalledWith(
            "!room:example.com",
            null,
            {
                msgtype: MsgType.Text,
                body: "Hello",
                format: "org.matrix.custom.html",
                formatted_body: "<b>Hello</b>",
            },
            MOCK_TXN_ID,
        );
    });

    it("sendHtmlMessage should pass threadId when provided", async () => {
        await manager.sendHtmlMessage("!room:example.com", "$thread999", "Hello", "<b>Hello</b>");
        expect(mockClient.sendMessage).toHaveBeenCalledWith(
            "!room:example.com",
            "$thread999",
            {
                msgtype: MsgType.Text,
                body: "Hello",
                format: "org.matrix.custom.html",
                formatted_body: "<b>Hello</b>",
            },
            MOCK_TXN_ID,
        );
    });

    // ─── sendEmote ─────────────────────────────────────────────────

    it("sendEmote should delegate to client.sendEmoteMessage", async () => {
        mockClient.sendEmoteMessage.mockResolvedValue(mockResolvedEvent("$em1"));
        const result = await manager.sendEmote("!room:example.com", "* feels happy");
        expect(result.event_id).toBe("$em1");
        expect(mockClient.sendEmoteMessage).toHaveBeenCalledWith("!room:example.com", "* feels happy", MOCK_TXN_ID);
    });

    it("sendEmote should pass threadId when provided", async () => {
        await manager.sendEmote("!room:example.com", "$t-em", "* waves");
        expect(mockClient.sendEmoteMessage).toHaveBeenCalledWith("!room:example.com", "$t-em", "* waves", MOCK_TXN_ID);
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
        expect(mockClient.sendNotice).toHaveBeenCalledWith("!room:example.com", "System notice", MOCK_TXN_ID);
    });

    it("sendNotice should pass threadId when provided", async () => {
        await manager.sendNotice("!room:example.com", "$t-notice", "Notice in thread");
        expect(mockClient.sendNotice).toHaveBeenCalledWith(
            "!room:example.com",
            "$t-notice",
            "Notice in thread",
            MOCK_TXN_ID,
        );
    });

    it("sendNotice should propagate client errors", async () => {
        mockClient.sendNotice.mockRejectedValue(new Error("Notice failed"));
        await expect(manager.sendNotice("!room:example.com", "notice")).rejects.toThrow("Notice failed");
    });

    // ─── sendImage ──────────────────────────────────────────────────

    it("sendImage should delegate with image content via sendMessage", async () => {
        mockClient.sendMessage.mockResolvedValue(mockResolvedEvent("$img1"));
        const info = { w: 800, h: 600, mimetype: "image/png", size: 12345 };
        const result = await manager.sendImage("!room:example.com", "mxc://example.com/img", info, "A photo");
        expect(result.event_id).toBe("$img1");
        expect(mockClient.sendMessage).toHaveBeenCalledWith(
            "!room:example.com",
            null,
            {
                msgtype: MsgType.Image,
                url: "mxc://example.com/img",
                info,
                body: "A photo",
            },
            MOCK_TXN_ID,
        );
    });

    it("sendImage should pass threadId when provided", async () => {
        const info = { w: 100, h: 100 };
        await manager.sendImage("!room:example.com", "$t-img", "mxc://example.com/img", info);
        expect(mockClient.sendMessage).toHaveBeenCalledWith(
            "!room:example.com",
            "$t-img",
            {
                msgtype: MsgType.Image,
                url: "mxc://example.com/img",
                info,
                body: "Image",
            },
            MOCK_TXN_ID,
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
        expect(mockClient.sendMessage).toHaveBeenCalledWith("!room:example.com", null, content, MOCK_TXN_ID);
    });

    it("sendFile should propagate client errors", async () => {
        mockClient.sendMessage.mockRejectedValue(new Error("File send failed"));
        await expect(manager.sendFile("!room:example.com", { body: "test.pdf", msgtype: "m.file" })).rejects.toThrow(
            "File send failed",
        );
    });

    // ─── ISSUE-03: txnId 在整个重试生命周期内复用 ────────────────────

    it("ISSUE-03: retried sendEvent reuses the same txnId and generates it only once", async () => {
        manager.setRetryOptions({ retryDelay: 1, maxRetries: 2 });
        const connError = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
        mockClient.sendEvent.mockRejectedValueOnce(connError).mockResolvedValueOnce(mockResolvedEvent("$ok"));

        const result = await manager.sendEvent("!room:example.com", "m.room.message", { body: "hi" });

        expect(result.event_id).toBe("$ok");
        expect(mockClient.sendEvent).toHaveBeenCalledTimes(2);
        const firstTxnId = mockClient.sendEvent.mock.calls[0][3];
        const secondTxnId = mockClient.sendEvent.mock.calls[1][3];
        expect(firstTxnId).toBe(MOCK_TXN_ID);
        expect(secondTxnId).toBe(MOCK_TXN_ID);
        expect(mockClient.makeTxnId).toHaveBeenCalledTimes(1);
    });

    it("ISSUE-03: caller-provided txnId is preserved across retries without generating a new one", async () => {
        manager.setRetryOptions({ retryDelay: 1, maxRetries: 2 });
        const connError = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
        mockClient.sendMessage.mockRejectedValueOnce(connError).mockResolvedValueOnce(mockResolvedEvent("$ok2"));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = { body: "hi", msgtype: "m.text" } as any;
        const result = await manager.sendMessage("!room:example.com", content, "caller-txn-9");

        expect(result.event_id).toBe("$ok2");
        expect(mockClient.sendMessage).toHaveBeenCalledTimes(2);
        expect(mockClient.sendMessage.mock.calls[0][2]).toBe("caller-txn-9");
        expect(mockClient.sendMessage.mock.calls[1][2]).toBe("caller-txn-9");
        expect(mockClient.makeTxnId).not.toHaveBeenCalled();
    });

    it("ISSUE-03: distinct sends get distinct txnIds", async () => {
        mockClient.makeTxnId.mockReturnValueOnce("txn-a").mockReturnValueOnce("txn-b");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = { body: "hi", msgtype: "m.text" } as any;
        await manager.sendMessage("!room:example.com", content);
        await manager.sendMessage("!room:example.com", content);

        expect(mockClient.sendMessage.mock.calls[0][2]).toBe("txn-a");
        expect(mockClient.sendMessage.mock.calls[1][2]).toBe("txn-b");
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
