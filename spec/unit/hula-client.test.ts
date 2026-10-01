import { describe, it, expect, vi, afterEach } from "vitest";

import { HuLaClient } from "../../src/hula-client";
import { MatrixClient } from "../../src/client";
import { MatrixEvent } from "../../src/models/event";
import { RoomEvent, type Room } from "../../src/models/room";
import type { LoginResponse } from "../../src/@types/auth";

/**
 * The HuLaClient holds its underlying {@link MatrixClient} as a private field.
 * Tests need to drive that client (spies / emits), so this helper casts it out.
 */
function getInnerClient(hula: HuLaClient): MatrixClient {
    return (hula as unknown as { client: MatrixClient }).client;
}

/**
 * Emit a `RoomEvent.Timeline` event on the client, bypassing the strongly-typed
 * `emit` overloads (which demand a fully-populated `IRoomTimelineData` that the
 * HuLaClient callback never inspects). The reference is bound to `inner` so the
 * underlying EventEmitter receives the correct `this` context.
 */
function emitTimeline(inner: MatrixClient, event: MatrixEvent, room: Room | undefined, removed: boolean): void {
    const emit = inner.emit.bind(inner) as unknown as (e: string, ...a: unknown[]) => boolean;
    emit(RoomEvent.Timeline, event, room, false, removed, undefined);
}

describe("HuLaClient", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("constructor", () => {
        it("constructs an underlying MatrixClient for the given homeserver", () => {
            const hula = new HuLaClient("https://example.com");

            expect(hula).toBeDefined();

            const inner = getInnerClient(hula);
            expect(inner).toBeInstanceOf(MatrixClient);
            expect(inner.baseUrl).toBe("https://example.com");
        });
    });

    describe("login", () => {
        it("logs in via the account manager using m.login.password", async () => {
            const hula = new HuLaClient("https://example.com");
            const inner = getInnerClient(hula);
            const accountManager = inner.getAccountManager();
            const loginSpy = vi.spyOn(accountManager, "login").mockResolvedValue({
                access_token: "tok",
                device_id: "DEVICE",
                user_id: "@alice:server",
            } as unknown as LoginResponse);

            await hula.login("alice", "password");

            expect(loginSpy.mock.calls[0]).toEqual(["m.login.password", { user: "alice", password: "password" }]);
        });
    });

    describe("onMessage", () => {
        it("fires the callback for non-removed timeline events", () => {
            const hula = new HuLaClient("https://example.com");
            const inner = getInnerClient(hula);
            const cb = vi.fn();
            hula.onMessage(cb);

            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "hi", msgtype: "m.text" },
                event_id: "$1:server",
                room_id: "!room:server",
            });
            const room = { roomId: "!room:server" } as unknown as Room;

            emitTimeline(inner, event, room, false);

            expect(cb).toHaveBeenCalledWith("!room:server", event);
        });

        it("falls back to the event room id when no room is provided", () => {
            const hula = new HuLaClient("https://example.com");
            const inner = getInnerClient(hula);
            const cb = vi.fn();
            hula.onMessage(cb);

            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "hi", msgtype: "m.text" },
                event_id: "$1:server",
                room_id: "!fallback:server",
            });

            emitTimeline(inner, event, undefined, false);

            expect(cb).toHaveBeenCalledWith("!fallback:server", event);
        });

        it("does not fire the callback for removed events", () => {
            const hula = new HuLaClient("https://example.com");
            const inner = getInnerClient(hula);
            const cb = vi.fn();
            hula.onMessage(cb);

            const event = new MatrixEvent({
                type: "m.room.message",
                content: { body: "hi", msgtype: "m.text" },
                event_id: "$1:server",
                room_id: "!room:server",
            });

            emitTimeline(inner, event, undefined, true);

            expect(cb).not.toHaveBeenCalled();
        });
    });

    describe("sendText", () => {
        it("sends a text message and returns the new event id", async () => {
            const hula = new HuLaClient("https://example.com");
            const inner = getInnerClient(hula);
            const sendSpy = vi.spyOn(inner, "sendMessage").mockResolvedValue({ event_id: "$evt:server" });

            const eventId = await hula.sendText("!room:server", "hello");

            expect(sendSpy.mock.calls[0]).toEqual(["!room:server", { msgtype: "m.text", body: "hello" }]);
            expect(eventId).toBe("$evt:server");
        });
    });

    describe("start/stop lifecycle", () => {
        it("start starts the underlying client", async () => {
            const hula = new HuLaClient("https://example.com");
            const inner = getInnerClient(hula);
            const startSpy = vi.spyOn(inner, "startClient").mockResolvedValue(undefined);

            await hula.start();

            expect(startSpy).toHaveBeenCalled();
        });

        it("stop stops the underlying client", () => {
            const hula = new HuLaClient("https://example.com");
            const inner = getInnerClient(hula);
            const stopSpy = vi.spyOn(inner, "stopClient");

            hula.stop();

            expect(stopSpy).toHaveBeenCalled();
        });
    });
});
