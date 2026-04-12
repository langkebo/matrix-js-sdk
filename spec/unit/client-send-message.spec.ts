import { describe, expect, it } from "vitest";

import { MsgType } from "../../src/@types/event.ts";
import type { RoomMessageEventContent } from "../../src/@types/events.ts";
import {
    buildEmoteMessagePayload,
    buildHtmlMessagePayload,
    buildImageMessagePayload,
    buildNoticeMessagePayload,
    buildStickerMessagePayload,
    buildTextMessagePayload,
    normalizeSendMessageArgs,
} from "../../src/client-send-message.ts";

describe("client send message helper", () => {
    it("normalizes sendMessage overload without threadId", () => {
        const content = { body: "hello", msgtype: MsgType.Text } as RoomMessageEventContent;
        expect(normalizeSendMessageArgs(content, "txn-1")).toEqual({
            threadId: null,
            content,
            txnId: "txn-1",
        });
    });

    it("normalizes sendMessage overload with threadId", () => {
        const content = { body: "hello", msgtype: MsgType.Text } as RoomMessageEventContent;
        expect(normalizeSendMessageArgs("$thread", content, "txn-2")).toEqual({
            threadId: "$thread",
            content,
            txnId: "txn-2",
        });
    });

    it("builds text, notice and emote payloads with legacy overload normalization", () => {
        expect(buildTextMessagePayload("hello", "txn-3", undefined, "$")).toEqual({
            threadId: null,
            content: { body: "hello", msgtype: "m.text" },
            txnId: "txn-3",
        });
        expect(buildNoticeMessagePayload("notice", "txn-4", undefined, "$")).toEqual({
            threadId: null,
            content: { body: "notice", msgtype: "m.notice" },
            txnId: "txn-4",
        });
        expect(buildEmoteMessagePayload("waves", "txn-5", undefined, "$")).toEqual({
            threadId: null,
            content: { body: "waves", msgtype: "m.emote" },
            txnId: "txn-5",
        });
    });

    it("builds html payloads and keeps thread ids", () => {
        expect(buildHtmlMessagePayload("$thread", "plain", "<b>plain</b>", "$")).toEqual({
            threadId: "$thread",
            content: {
                body: "plain",
                format: "org.matrix.custom.html",
                formatted_body: "<b>plain</b>",
                msgtype: "m.text",
            },
        });
    });

    it("builds image and sticker payloads from legacy overloads", () => {
        const info = { mimetype: "image/png" };
        expect(buildImageMessagePayload("mxc://image", info, "cover", "Image", "$")).toEqual({
            threadId: null,
            content: {
                msgtype: "m.image",
                url: "mxc://image",
                info,
                body: "cover",
            },
        });
        expect(buildStickerMessagePayload("mxc://sticker", info, "fun", "Sticker", "$")).toEqual({
            threadId: null,
            content: {
                url: "mxc://sticker",
                info,
                body: "fun",
            },
        });
    });
});
