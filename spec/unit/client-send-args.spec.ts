import { describe, expect, it } from "vitest";

import {
    normalizeRedactEventArgs,
    normalizeSendEventArgs,
    normalizeThreadBodyTxnArgs,
    normalizeThreadHtmlArgs,
    normalizeThreadMediaArgs,
} from "../../src/client-send-args.ts";

describe("client send args helpers", () => {
    it("normalizes sendEvent overload without threadId", () => {
        const args = normalizeSendEventArgs("m.room.message", { body: "hi" }, "txn-1", undefined, "$");
        expect(args).toEqual({
            threadId: null,
            eventType: "m.room.message",
            content: { body: "hi" },
            txnId: "txn-1",
        });
    });

    it("normalizes sendEvent overload with threadId", () => {
        const args = normalizeSendEventArgs("$thread", "m.room.message", { body: "hi" }, "txn-2", "$");
        expect(args).toEqual({
            threadId: "$thread",
            eventType: "m.room.message",
            content: { body: "hi" },
            txnId: "txn-2",
        });
    });

    it("normalizes legacy redactEvent overload", () => {
        const args = normalizeRedactEventArgs("$event", "txn-3", { reason: "spam" }, undefined, "$");
        expect(args).toEqual({
            threadId: null,
            eventId: "$event",
            txnId: "txn-3",
            opts: { reason: "spam" },
        });
    });

    it("normalizes threaded body+txn overload", () => {
        const args = normalizeThreadBodyTxnArgs("hello", "txn-4", undefined, "$");
        expect(args).toEqual({
            threadId: null,
            body: "hello",
            txnId: "txn-4",
        });
    });

    it("normalizes html overload", () => {
        const args = normalizeThreadHtmlArgs("plain body", "<b>ignored</b>", undefined, "$");
        expect(args).toEqual({
            threadId: null,
            body: "plain body",
            htmlBody: "<b>ignored</b>",
        });
    });

    it("normalizes media overload", () => {
        const info = { mimetype: "image/png" };
        const args = normalizeThreadMediaArgs("mxc://img", info, "cover", undefined, "Image", "$");
        expect(args).toEqual({
            threadId: null,
            url: "mxc://img",
            info,
            text: "cover",
        });
    });
});
