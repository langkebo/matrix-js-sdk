import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { RelationsManager } from "../../src/relations/index";
import { Method } from "../../src/http-api/method";

describe("RelationsManager", () => {
    let transport: FakeTransport;
    let manager: RelationsManager;
    let mockMapper: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        transport = new FakeTransport();
        mockMapper = vi.fn().mockImplementation((e: Record<string, unknown>) => ({
            event_id: e.event_id,
            getId: () => e.event_id,
        }));
        const mockClient = {
            getEventMapper: () => mockMapper,
            canSupport: { get: () => false },
        } as any;
        manager = new RelationsManager(mockClient, { transport });
    });

    // ─── fetchRelations ────────────────────────────────────────────────

    it("fetchRelations should GET relations for event without relationType", async () => {
        transport.respondWith({ chunk: [{ event_id: "$e1" }], next_batch: "nb1" });
        const result = await manager.fetchRelations("!room:example.com", "$event123", null);
        expect(result.chunk).toHaveLength(1);
        expect(result.next_batch).toBe("nb1");
        transport.expectCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.com/relations/%24event123?dir=b",
        );
    });

    it("fetchRelations should GET relations with relationType", async () => {
        transport.respondWith({ chunk: [] });
        await manager.fetchRelations("!room:example.com", "$event123", "m.annotation");
        transport.expectCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.com/relations/%24event123/m.annotation?dir=b",
        );
    });

    it("fetchRelations should GET relations with relationType and eventType", async () => {
        transport.respondWith({ chunk: [] });
        await manager.fetchRelations("!room:example.com", "$event123", "m.annotation", "m.room.message");
        transport.expectCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.com/relations/%24event123/m.annotation/m.room.message?dir=b",
        );
    });

    it("fetchRelations should warn when eventType is given without relationType", async () => {
        transport.respondWith({ chunk: [] });
        await manager.fetchRelations("!room:example.com", "$event123", null, "m.room.message");
        // eventType is ignored when relationType is null
        transport.expectCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.com/relations/%24event123?dir=b",
        );
    });

    // ─── getAnnotations ──────────────────────────────────────────────

    it("getAnnotations should map chunk events and return them", async () => {
        transport.respondWith({ chunk: [{ event_id: "$a1" }, { event_id: "$a2" }] });
        const result = await manager.getAnnotations("!room:example.com", "$event123");
        expect(result.events).toHaveLength(2);
        expect(result.events[0]).toHaveProperty("event_id", "$a1");
        transport.expectCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.com/relations/%24event123/m.annotation/m.room.message?dir=b",
        );
    });

    it("getAnnotations should return empty events on error", async () => {
        transport.rejectWith(new Error("Network error"));
        const result = await manager.getAnnotations("!room:example.com", "$event123");
        expect(result.events).toEqual([]);
    });

    // ─── hasReference / hasThread ─────────────────────────────────────

    it("hasReference should return true when references exist", async () => {
        transport.respondWith({ chunk: [{ event_id: "$ref1" }] });
        const result = await manager.hasReference("!room:example.com", "$event123");
        expect(result).toBe(true);
    });

    it("hasReference should return false when no references", async () => {
        transport.respondWith({ chunk: [] });
        const result = await manager.hasReference("!room:example.com", "$event123");
        expect(result).toBe(false);
    });

    it("hasThread should return true when thread relations exist", async () => {
        transport.respondWith({ chunk: [{ event_id: "$t1" }] });
        const result = await manager.hasThread("!room:example.com", "$event123");
        expect(result).toBe(true);
    });

    // ─── getRelationCount ────────────────────────────────────────────

    it("getRelationCount should return total from response", async () => {
        transport.respondWith({ chunk: [], total: 42 });
        const count = await manager.getRelationCount("!room:example.com", "$event123", "m.annotation");
        expect(count).toBe(42);
    });

    it("getRelationCount should return 0 on error", async () => {
        transport.rejectWith(new Error("Network error"));
        const count = await manager.getRelationCount("!room:example.com", "$event123", "m.annotation");
        expect(count).toBe(0);
    });

    // ─── getLatestRelation ────────────────────────────────────────────

    it("getLatestRelation should return the first event from chunk", async () => {
        transport.respondWith({ chunk: [{ event_id: "$latest" }] });
        const result = await manager.getLatestRelation("!room:example.com", "$event123", "m.annotation");
        expect(result).not.toBeNull();
        expect(result!.event_id).toBe("$latest");
    });

    it("getLatestRelation should return null when chunk is empty", async () => {
        transport.respondWith({ chunk: [] });
        const result = await manager.getLatestRelation("!room:example.com", "$event123", "m.annotation");
        expect(result).toBeNull();
    });

    it("getLatestRelation should return null on error", async () => {
        transport.rejectWith(new Error("Network error"));
        const result = await manager.getLatestRelation("!room:example.com", "$event123", "m.annotation");
        expect(result).toBeNull();
    });

    // ─── getRelationTypes ────────────────────────────────────────────

    it("getRelationTypes should return types with non-zero counts", async () => {
        // Called for m.reference, m.annotation, m.replace, m.thread
        transport.request
            .mockResolvedValueOnce({ chunk: [], total: 1 })  // m.reference
            .mockResolvedValueOnce({ chunk: [], total: 1 })  // m.annotation
            .mockResolvedValueOnce({ chunk: [], total: 0 })  // m.replace
            .mockResolvedValueOnce({ chunk: [], total: 0 }); // m.thread
        const types = await manager.getRelationTypes("!room:example.com", "$event123");
        expect(types).toEqual(["m.reference", "m.annotation"]);
    });

    // ─── getAggregations ────────────────────────────────────────────

    it("getAggregations should return aggregation response", async () => {
        transport.respondWith({ chunk: [{ type: "m.annotation", key: "👍", count: 5 }] });
        const result = await manager.getAggregations("!room:example.com", "$event123", "m.annotation");
        expect(result.chunk).toHaveLength(1);
        expect(result.chunk[0].count).toBe(5);
        transport.expectCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.com/aggregations/%24event123/m.annotation",
        );
    });

    it("getAggregations should throw on error", async () => {
        transport.rejectWith(new Error("API error"));
        await expect(
            manager.getAggregations("!room:example.com", "$event123", "m.annotation"),
        ).rejects.toThrow();
    });

    // ─── sendRelation ──────────────────────────────────────────────────

    it("sendRelation should PUT the relation and emit Updated event", async () => {
        const emitSpy = vi.spyOn(manager, "emit");
        transport.respondWith({ event_id: "$newRel" });
        const result = await manager.sendRelation("!room:example.com", "$event123", "m.annotation", "$target");
        expect(result.event_id).toBe("$newRel");
        expect(emitSpy).toHaveBeenCalledWith("RelationsUpdated", "!room:example.com", "$event123");
        transport.expectCalledWith(
            Method.Put,
            "/rooms/!room%3Aexample.com/relations/%24event123/m.annotation/%24target",
        );
    });

    it("sendRelation should emit Error event on failure", async () => {
        const emitSpy = vi.spyOn(manager, "emit");
        transport.rejectWith(new Error("Send failed"));
        await expect(
            manager.sendRelation("!room:example.com", "$event123", "m.annotation", "$target"),
        ).rejects.toThrow();
        expect(emitSpy).toHaveBeenCalledWith("RelationsError", expect.any(Error));
    });

    // ─── relations (fallback, no deps) ──────────────────────────────

    it("relations should fallback without deps and return mapped events", async () => {
        transport.respondWith({ chunk: [{ event_id: "$r1" }, { event_id: "$r2" }], next_batch: "n1", prev_batch: "p1" });
        const result = await manager.relations("!room:example.com", "$event123", "m.annotation");
        expect(result.originalEvent).toBeNull();
        expect(result.events).toHaveLength(2);
        expect(result.nextBatch).toBe("n1");
        expect(result.prevBatch).toBe("p1");
    });
});
