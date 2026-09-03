import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createClient } from "../../src/matrix";
import { MatrixEvent } from "../../src/models/event";
import { MsgType, RelationType } from "../../src/@types/event";
import type { MatrixClient } from "../../src/client";

describe("MatrixClient reply/edit relations", () => {
    let client: MatrixClient;

    beforeEach(() => {
        client = createClient({
            baseUrl: "https://example.com",
            accessToken: "tok",
            userId: "@alice:example.com",
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function makeEvent(): MatrixEvent {
        return new MatrixEvent({
            type: "m.room.message",
            event_id: "$original",
            room_id: "!room:example.com",
            content: { msgtype: MsgType.Text, body: "original body" },
        });
    }

    it("replyToEvent builds m.in_reply_to and delegates to sendMessage", async () => {
        const event = makeEvent();
        const sendSpy = vi.spyOn(client, "sendMessage").mockResolvedValue({ event_id: "$reply" });

        await client.replyToEvent("!room:example.com", event, { msgtype: MsgType.Text, body: "reply body" });

        expect(sendSpy).toHaveBeenCalledWith(
            "!room:example.com",
            null,
            expect.objectContaining({
                "m.relates_to": { "m.in_reply_to": { event_id: "$original" } },
            }),
            undefined,
        );
    });

    it("replyToEvent throws for an event in a different room", () => {
        const event = makeEvent();
        expect(() =>
            client.replyToEvent("!other:example.com", event, { msgtype: MsgType.Text, body: "x" }),
        ).toThrow("different room");
    });

    it("editEvent builds m.replace + m.new_content and delegates to sendMessage", async () => {
        const event = makeEvent();
        const sendSpy = vi.spyOn(client, "sendMessage").mockResolvedValue({ event_id: "$edit" });

        await client.editEvent("!room:example.com", event, { msgtype: MsgType.Text, body: "edited body" });

        expect(sendSpy).toHaveBeenCalledWith(
            "!room:example.com",
            null,
            expect.objectContaining({
                "m.new_content": expect.objectContaining({ body: "edited body" }),
                "m.relates_to": { rel_type: RelationType.Replace, event_id: "$original" },
            }),
            undefined,
        );
    });

    it("editEvent throws for an event in a different room", () => {
        const event = makeEvent();
        expect(() => client.editEvent("!other:example.com", event, { msgtype: MsgType.Text, body: "x" })).toThrow(
            "different room",
        );
    });
});
