import { describe, expect, it, beforeEach } from "vitest";

import { SendingQueueManager, type IQueuedEvent } from "../../src/sending-queue/index";
import { MatrixEvent } from "../../src/models/event";

function makeEvent(eventId: string): MatrixEvent {
    return new MatrixEvent({ event_id: eventId, type: "m.room.message", content: {} });
}

describe("SendingQueueManager", () => {
    let manager: SendingQueueManager;
    let client: { sendingQueue?: IQueuedEvent[] };

    beforeEach(() => {
        client = { sendingQueue: [] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manager = new SendingQueueManager(client as any);
    });

    describe("getSendingQueue", () => {
        it("returns the client sending queue", () => {
            client.sendingQueue = [{ event: makeEvent("e1"), priority: 0, retries: 0 }];
            expect(manager.getSendingQueue()).toBe(client.sendingQueue);
        });

        it("returns empty array when queue is undefined", () => {
            client.sendingQueue = undefined;
            expect(manager.getSendingQueue()).toEqual([]);
        });
    });

    describe("addToSendingQueue", () => {
        it("adds an event with default priority 0", () => {
            const event = makeEvent("ev1");
            manager.addToSendingQueue(event);
            expect(client.sendingQueue).toHaveLength(1);
            expect(client.sendingQueue![0].event).toBe(event);
            expect(client.sendingQueue![0].priority).toBe(0);
            expect(client.sendingQueue![0].retries).toBe(0);
        });

        it("adds an event with custom priority", () => {
            const event = makeEvent("ev2");
            manager.addToSendingQueue(event, 5);
            expect(client.sendingQueue![0].priority).toBe(5);
        });

        it("initializes queue if undefined", () => {
            client.sendingQueue = undefined;
            const event = makeEvent("ev3");
            manager.addToSendingQueue(event);
            expect(client.sendingQueue).toHaveLength(1);
        });
    });

    describe("removeFromSendingQueue", () => {
        it("removes an event by ID", () => {
            const e1 = makeEvent("ev1");
            const e2 = makeEvent("ev2");
            client.sendingQueue = [
                { event: e1, priority: 0, retries: 0 },
                { event: e2, priority: 0, retries: 0 },
            ];
            manager.removeFromSendingQueue("ev1");
            expect(client.sendingQueue).toHaveLength(1);
            expect(client.sendingQueue![0].event.getId()).toBe("ev2");
        });

        it("is a no-op when event is not in queue", () => {
            client.sendingQueue = [{ event: makeEvent("ev1"), priority: 0, retries: 0 }];
            expect(() => manager.removeFromSendingQueue("nonexistent")).not.toThrow();
            expect(client.sendingQueue).toHaveLength(1);
        });

        it("is a no-op when queue is empty", () => {
            client.sendingQueue = [];
            expect(() => manager.removeFromSendingQueue("ev1")).not.toThrow();
        });
    });

    describe("clearSendingQueue", () => {
        it("clears all queued events", () => {
            client.sendingQueue = [{ event: makeEvent("e1"), priority: 0, retries: 0 }];
            manager.clearSendingQueue();
            expect(client.sendingQueue).toEqual([]);
        });
    });

    describe("isSendingQueueEmpty", () => {
        it("returns true when queue is empty", () => {
            client.sendingQueue = [];
            expect(manager.isSendingQueueEmpty()).toBe(true);
        });

        it("returns true when queue is undefined", () => {
            client.sendingQueue = undefined;
            expect(manager.isSendingQueueEmpty()).toBe(true);
        });

        it("returns false when queue has items", () => {
            client.sendingQueue = [{ event: makeEvent("e1"), priority: 0, retries: 0 }];
            expect(manager.isSendingQueueEmpty()).toBe(false);
        });
    });
});
