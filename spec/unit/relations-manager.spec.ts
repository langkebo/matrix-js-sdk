import { describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/method.ts";
import { ClientPrefix } from "../../src/http-api/prefix.ts";
import { RelationsManager } from "../../src/relations/index.ts";
import { logger } from "../../src/logger";

describe("RelationsManager", () => {
    it("fetches relations through the dedicated relations route", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            chunk: [],
            prev_batch: "prev",
            next_batch: "next",
        });

        const manager = new RelationsManager({
            http: { authedRequest },
            canSupport: new Map(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await expect(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            manager.fetchRelations("!room:example.org", "$ctx", "m.reference", "m.room.message", { limit: 5 } as any),
        ).resolves.toEqual({
            chunk: [],
            prev_batch: "prev",
            next_batch: "next",
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.org/relations/%24ctx/m.reference/m.room.message?limit=5",
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    });

    it("fetches aggregations through the dedicated aggregations route", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            chunk: [{ type: "m.reaction", key: "👍", count: 2 }],
        });

        const manager = new RelationsManager({
            http: { authedRequest },
            canSupport: new Map(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await expect(manager.getAggregations("!room:example.org", "$ctx", "m.annotation")).resolves.toEqual({
            chunk: [{ type: "m.reaction", key: "👍", count: 2 }],
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.org/aggregations/%24ctx/m.annotation",
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    });

    it("sends relation events through the dedicated relations route", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            event_id: "$new",
            room_id: "!room:example.org",
            relates_to: {
                event_id: "$target",
                rel_type: "m.replace",
            },
        });
        const emit = vi.fn();

        const manager = new RelationsManager({
            http: { authedRequest },
            canSupport: new Map(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(manager as any, "emit").mockImplementation(emit);

        await expect(
            manager.sendRelation("!room:example.org", "$ctx", "m.replace", "$target", {
                content: { body: "edited", msgtype: "m.text" },
                "m.new_content": { body: "edited", msgtype: "m.text" },
            }),
        ).resolves.toEqual({
            event_id: "$new",
            room_id: "!room:example.org",
            relates_to: {
                event_id: "$target",
                rel_type: "m.replace",
            },
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/rooms/!room%3Aexample.org/relations/%24ctx/m.replace/%24target",
            undefined,
            {
                content: { body: "edited", msgtype: "m.text" },
                "m.new_content": { body: "edited", msgtype: "m.text" },
            },
            { prefix: ClientPrefix.V1 },
        );
        expect(emit).toHaveBeenCalledWith("RelationsUpdated", "!room:example.org", "$ctx");
    });

    it("normalizes relation send errors", async () => {
        const authedRequest = vi.fn().mockRejectedValue(new Error("boom"));
        const emit = vi.fn();
        const manager = new RelationsManager({
            http: { authedRequest },
            canSupport: new Map(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(manager as any, "emit").mockImplementation(emit);

        await expect(
            manager.sendRelation("!room:example.org", "$ctx", "m.annotation", "$target", { key: "👍" }),
        ).rejects.toThrow();
        expect(emit).toHaveBeenCalledWith("RelationsError", expect.any(Error));
    });

    // FT-097: sendRelationViaSendRelation 此前未显式传 prefix，依赖 defaultPrefix
    it("sendRelationViaSendRelation should use V3 prefix explicitly, not defaultPrefix (FT-097)", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ event_id: "$new" });
        // 设置 defaultPrefix 为 V1，验证方法仍使用 V3（显式 prefix）
        const manager = new RelationsManager(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { http: { authedRequest }, canSupport: new Map() } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { defaultPrefix: ClientPrefix.V1 } as any,
        );

        await manager.sendRelationViaSendRelation(
            "!room:example.org",
            "$ctx",
            "m.replace",
            "$txn1",
            "m.room.message",
            { body: "edited", msgtype: "m.text" },
        );

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Put,
            "/rooms/!room%3Aexample.org/relations/%24ctx/m.replace/%24txn1",
            undefined,
            expect.objectContaining({ body: "edited", msgtype: "m.text", type: "m.room.message" }),
            { prefix: ClientPrefix.V3 },
        );
    });

    // ---------- Helper aggregations ----------

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const identityMapper = (event: any) => event;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function makeManager(resolvedValue: any, options: { reject?: boolean } = {}) {
        const authedRequest = options.reject
            ? vi.fn().mockRejectedValue(resolvedValue)
            : vi.fn().mockResolvedValue(resolvedValue);
        const manager = new RelationsManager({
            http: { authedRequest },
            canSupport: new Map(),
            getEventMapper: () => identityMapper,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        return { manager, authedRequest };
    }

    it("getAnnotations maps chunk through the event mapper", async () => {
        const { manager, authedRequest } = makeManager({
            chunk: [{ event_id: "$a" }, { event_id: "$b" }],
            next_batch: "next",
            total: 2,
        });

        const result = await manager.getAnnotations("!room:example.org", "$ctx");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(result.events.map((e: any) => e.event_id)).toEqual(["$a", "$b"]);
        expect(result.nextBatch).toBe("next");
        expect(result.total).toBe(2);
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.org/relations/%24ctx/m.annotation/m.room.message?dir=b",
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    });

    it("getAnnotations returns an empty list when the HTTP call rejects", async () => {
        const { manager } = makeManager(new Error("boom"), { reject: true });
        await expect(manager.getAnnotations("!room:example.org", "$ctx")).resolves.toEqual({ events: [] });
    });

    it("getRelationCount returns the total field from the backend", async () => {
        const { manager } = makeManager({ chunk: [], total: 7 });
        await expect(manager.getRelationCount("!room:example.org", "$ctx", "m.reference")).resolves.toBe(7);
    });

    it("getRelationCount falls back to 0 on rejection", async () => {
        const { manager } = makeManager(new Error("down"), { reject: true });
        await expect(manager.getRelationCount("!room:example.org", "$ctx", "m.reference")).resolves.toBe(0);
    });

    it("getLatestRelation returns the first chunk entry mapped to an event", async () => {
        const { manager } = makeManager({ chunk: [{ event_id: "$latest" }, { event_id: "$older" }] });
        const latest = await manager.getLatestRelation("!room:example.org", "$ctx", "m.replace");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((latest as any)?.event_id).toBe("$latest");
    });

    it("getLatestRelation returns null for an empty chunk", async () => {
        const { manager } = makeManager({ chunk: [] });
        await expect(manager.getLatestRelation("!room:example.org", "$ctx", "m.replace")).resolves.toBeNull();
    });

    it("getLatestRelation returns null on rejection", async () => {
        const { manager } = makeManager(new Error("down"), { reject: true });
        await expect(manager.getLatestRelation("!room:example.org", "$ctx", "m.replace")).resolves.toBeNull();
    });

    it("getRelationCount logs a warning (not debug) on rejection", async () => {
        const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
        const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
        const { manager } = makeManager(new Error("down"), { reject: true });

        await expect(manager.getRelationCount("!room:example.org", "$ctx", "m.reference")).resolves.toBe(0);
        expect(warnSpy).toHaveBeenCalledWith("RelationsManager.getRelationCount failed", expect.any(Error));
        expect(debugSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
        debugSpy.mockRestore();
    });

    it("getLatestRelation logs a warning (not debug) on rejection", async () => {
        const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
        const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
        const { manager } = makeManager(new Error("down"), { reject: true });

        await expect(manager.getLatestRelation("!room:example.org", "$ctx", "m.replace")).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalledWith("RelationsManager.getLatestRelation failed", expect.any(Error));
        expect(debugSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
        debugSpy.mockRestore();
    });

    it("hasReference is true when at least one m.reference event comes back", async () => {
        const { manager, authedRequest } = makeManager({ chunk: [{ event_id: "$ref" }] });
        await expect(manager.hasReference("!room:example.org", "$ctx")).resolves.toBe(true);
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.org/relations/%24ctx/m.reference?dir=b",
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    });

    it("hasReference is false when the chunk is empty", async () => {
        const { manager } = makeManager({ chunk: [] });
        await expect(manager.hasReference("!room:example.org", "$ctx")).resolves.toBe(false);
    });

    it("hasThread is true when a thread relation exists", async () => {
        const { manager, authedRequest } = makeManager({ chunk: [{ event_id: "$t" }] });
        await expect(manager.hasThread("!room:example.org", "$ctx")).resolves.toBe(true);
        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/rooms/!room%3Aexample.org/relations/%24ctx/m.thread?dir=b",
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    });

    it("getRelationTypes reports each rel-type whose count is non-zero", async () => {
        // Responses are returned in iteration order of the hard-coded list
        // ["m.reference", "m.annotation", "m.replace", "m.thread"].
        const authedRequest = vi
            .fn()
            .mockResolvedValueOnce({ chunk: [], total: 0 }) // m.reference
            .mockResolvedValueOnce({ chunk: [], total: 2 }) // m.annotation
            .mockResolvedValueOnce({ chunk: [], total: 0 }) // m.replace
            .mockResolvedValueOnce({ chunk: [], total: 5 }); // m.thread

        const manager = new RelationsManager({
            http: { authedRequest },
            canSupport: new Map(),
            getEventMapper: () => identityMapper,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await expect(manager.getRelationTypes("!room:example.org", "$ctx")).resolves.toEqual([
            "m.annotation",
            "m.thread",
        ]);
        expect(authedRequest).toHaveBeenCalledTimes(4);
    });

    it("fetchRelations drops eventType when relationType is null", async () => {
        const { manager, authedRequest } = makeManager({ chunk: [] });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            await manager.fetchRelations("!room:example.org", "$ctx", null, "m.room.message");
            // Null relationType strips the /$relationType/$eventType suffix entirely;
            // the eventType is ignored with a warning.
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.org/relations/%24ctx?dir=b",
                undefined,
                undefined,
                { prefix: ClientPrefix.V1 },
            );
        } finally {
            warn.mockRestore();
        }
    });
});
