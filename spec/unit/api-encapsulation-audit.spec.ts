import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { AuthManager } from "../../src/auth/index";
import { ApplicationServiceManager } from "../../src/app-service/index";
import { DeviceManager } from "../../src/device/index";
import { DiscoveryManager } from "../../src/discovery/index";
import { FederationManager } from "../../src/federation/index";
import { FriendManager } from "../../src/friend/index";
import { GuestManager } from "../../src/guest/index";
import { MediaManager } from "../../src/media/index";
import { PresenceManager } from "../../src/presence/index";
import { RoomSummaryManager } from "../../src/room-summary/index";
import { SpaceManager } from "../../src/space/index";
import { ThreadingManager } from "../../src/threading/index";
import { AdminPrefix, ClientPrefix, MediaPrefix, Method } from "../../src/http-api";

describe("API encapsulation audit", () => {
    const auditScriptPath = fileURLToPath(new URL("../../scripts/api-contract-audit.cjs", import.meta.url));

    it("uses a public request for auth login flows", async () => {
        const request = vi.fn().mockResolvedValue({ flows: [] });
        const authedRequest = vi.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new AuthManager({ http: { request, authedRequest } } as any);

        await manager.getSupportedLoginFlows();

        expect(request).toHaveBeenCalledWith(Method.Get, "/login", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("uses relative device paths with the v3 client prefix", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ devices: [] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new DeviceManager({ http: { authedRequest }, deviceId: "DEVICE" } as any);

        await manager.getDevices();

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/devices", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("uses relative presence paths with the v3 client prefix", async () => {
        const authedRequest = vi.fn().mockResolvedValue(undefined);
        const manager = new PresenceManager({
            http: { authedRequest },
            getUserId: () => "@alice:test",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await manager.setPresence("online", "ready");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Put,
            `/presence/${encodeURIComponent("@alice:test")}/status`,
            {},
            { presence: "online", status_msg: "ready" },
            { prefix: ClientPrefix.V3, priority: undefined },
        );
    });

    it("uses the v3 presence list contract for subscribe, unsubscribe, and fetch", async () => {
        const authedRequest = vi
            .fn()
            .mockResolvedValueOnce({ presences: [] })
            .mockResolvedValueOnce({ presences: [] })
            .mockResolvedValueOnce({ presences: [] })
            .mockResolvedValueOnce({ presences: [] });
        const manager = new PresenceManager({
            http: { authedRequest },
            getUserId: () => "@alice:test",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await manager.subscribeToPresence(["@bob:test"]);
        await manager.unsubscribeFromPresence(["@bob:test"]);
        await manager.getSubscribedPresence();
        await manager.getPresenceList("@alice:test");

        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Post,
            "/presence/list",
            {},
            { subscribe: ["@bob:test"] },
            { prefix: ClientPrefix.V3, priority: undefined },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Post,
            "/presence/list",
            {},
            { unsubscribe: ["@bob:test"] },
            { prefix: ClientPrefix.V3, priority: undefined },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            3,
            Method.Post,
            "/presence/list",
            {},
            {},
            { prefix: ClientPrefix.V3, priority: undefined },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            4,
            Method.Get,
            `/presence/list/${encodeURIComponent("@alice:test")}`,
            {},
            undefined,
            { prefix: ClientPrefix.V3, priority: undefined },
        );
    });

    it("uses relative media paths with the media prefixes", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ content_uri: "mxc://test/media" });
        const manager = new MediaManager({
            http: { authedRequest },
            baseUrl: "https://hs.example.com",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await manager.uploadContentWithId("test", "media", new Blob(["data"]), "text/plain");
        await manager.deleteMedia("test", "media");
        await manager.previewUrl("https://example.com", 123);

        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Put,
            "/upload/test/media",
            undefined,
            expect.any(Blob),
            {
                prefix: MediaPrefix.V3,
                headers: { "Content-Type": "text/plain" },
            },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(2, Method.Post, "/delete/test/media", undefined, undefined, {
            prefix: MediaPrefix.V1,
        });
        expect(authedRequest).toHaveBeenNthCalledWith(
            3,
            Method.Get,
            "/preview_url",
            { url: "https://example.com", ts: 123 },
            undefined,
            {
                prefix: MediaPrefix.V3,
            },
        );
        expect(manager.getDownloadUrl("mxc://test/media")).toBe(
            "https://hs.example.com/_matrix/media/v3/download/test/media",
        );
        expect(manager.getThumbnailUrl("mxc://test/media", { width: 64, height: 64, method: "crop" })).toBe(
            "https://hs.example.com/_matrix/media/v3/thumbnail/test/media?width=64&height=64&method=crop",
        );
    });

    it("uses the v3 friends list contract and v1 friend request contract", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ friends: [], room_id: "!friends:test" });
        const manager = new FriendManager({
            http: { authedRequest },
            getUserId: () => "@alice:test",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await manager.getFriends();
        await manager.sendFriendRequest("@bob:test", "hello");

        expect(authedRequest).toHaveBeenNthCalledWith(1, Method.Get, "/friends", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Post,
            "/friends/request",
            undefined,
            { user_id: "@bob:test", message: "hello" },
            { prefix: ClientPrefix.V1 },
        );
    });

    it("uses the admin prefix for federation blacklist requests", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ blacklist: [] });
        const manager = new FederationManager({
            http: { authedRequest },
            getUserId: () => "@admin:test",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await manager.blacklist.getBlacklist();

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/federation/blacklist", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("uses relative public rooms paths for federation room discovery", async () => {
        const request = vi.fn().mockResolvedValue({ chunk: [] });
        const manager = new FederationManager({
            http: { authedRequest: vi.fn(), request },
            getUserId: () => "@admin:test",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await manager.query.getPublicRoomsOnServer("example.com", 20, "s123");

        expect(request).toHaveBeenCalledWith(
            Method.Get,
            "/_matrix/federation/v1/publicRooms",
            { limit: 20, server_name: "example.com", since: "s123" },
            undefined,
            { prefix: "" },
        );
    });

    it("uses the admin prefix for appservice registration", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ application_services: [] });
        const manager = new ApplicationServiceManager({
            http: { authedRequest },
            getDomain: () => "test",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await manager.listApplicationServices();

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/application_services", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("uses relative guest register/login paths with the v3 client prefix", async () => {
        const request = vi.fn().mockResolvedValue({
            user_id: "@guest:test",
            device_id: "DEVICE",
            access_token: "TOKEN",
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new GuestManager({ http: { request } } as any, "http://example");

        await manager.registerGuest();

        expect(request).toHaveBeenCalledWith(
            Method.Post,
            "/register",
            undefined,
            { kind: "guest" },
            { prefix: ClientPrefix.V3 },
        );
    });

    it("uses public well-known discovery without inheriting the client prefix", async () => {
        const request = vi.fn().mockResolvedValue({ "m.homeserver": { base_url: "https://hs" } });
        const authedRequest = vi.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new DiscoveryManager({ http: { request, authedRequest }, baseUrl: "https://hs" } as any);

        await manager.getServerDiscoveryInfo();

        expect(request).toHaveBeenCalledWith(Method.Get, "/.well-known/matrix/client", undefined, undefined, {
            prefix: "",
        });
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("uses the directory lookup endpoint for guest join probes on aliases", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ room_id: "!room:test" });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new GuestManager({ http: { authedRequest }, getRoom: vi.fn() } as any, "http://example");

        await manager.canJoinRoom("#room:test");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            `/directory/room/${encodeURIComponent("#room:test")}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("uses the v1 thread list endpoint with include_all query mapping", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ threads: [], next_batch: null, total: 0 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new ThreadingManager({ http: { authedRequest } } as any);

        await manager.getRoomThreadList("!room:test", {
            limit: 20,
            from: "batch-1",
            includeAll: true,
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            `/rooms/${encodeURIComponent("!room:test")}/threads`,
            {
                limit: 20,
                from: "batch-1",
                include_all: true,
            },
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    });

    it("uses the v1 global and room thread creation endpoints", async () => {
        const authedRequest = vi
            .fn()
            .mockResolvedValueOnce({
                thread_id: "$global",
                root_event_id: "$root1",
                room_id: "!room:test",
                sender: "@alice:test",
                reply_count: 0,
                last_reply_event_id: null,
                last_reply_sender: null,
                last_reply_ts: null,
                participants: null,
                is_fetched: true,
                created_ts: 123,
            })
            .mockResolvedValueOnce({
                thread_id: "$room",
                root_event_id: "$root2",
                room_id: "!room:test",
                sender: "@alice:test",
                reply_count: 0,
                last_reply_event_id: null,
                last_reply_sender: null,
                last_reply_ts: null,
                participants: null,
                is_fetched: true,
                created_ts: 456,
            });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new ThreadingManager({ http: { authedRequest } } as any);

        const globalResult = await manager.createGlobalThread({
            roomId: "!room:test",
            rootEventId: "$root1",
            content: { body: "global thread" },
            originServerTs: 123,
        });
        const roomResult = await manager.createRoomThread("!room:test", "$root2", {
            content: { body: "room thread" },
            originServerTs: 456,
        });

        expect(globalResult).toEqual({
            thread_id: "$global",
            root_event_id: "$root1",
            room_id: "!room:test",
            sender: "@alice:test",
            reply_count: 0,
            last_reply_event_id: null,
            last_reply_sender: null,
            last_reply_ts: null,
            participants: null,
            is_fetched: true,
            created_ts: 123,
        });
        expect(roomResult).toEqual({
            thread_id: "$room",
            root_event_id: "$root2",
            room_id: "!room:test",
            sender: "@alice:test",
            reply_count: 0,
            last_reply_event_id: null,
            last_reply_sender: null,
            last_reply_ts: null,
            participants: null,
            is_fetched: true,
            created_ts: 456,
        });

        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Post,
            "/threads",
            undefined,
            {
                room_id: "!room:test",
                root_event_id: "$root1",
                content: { body: "global thread" },
                origin_server_ts: 123,
            },
            { prefix: ClientPrefix.V1 },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Post,
            `/rooms/${encodeURIComponent("!room:test")}/threads`,
            undefined,
            {
                root_event_id: "$root2",
                content: { body: "room thread" },
                origin_server_ts: 456,
            },
            { prefix: ClientPrefix.V1 },
        );
    });

    it("adds a default empty content object when creating threads without explicit content", async () => {
        const authedRequest = vi
            .fn()
            .mockResolvedValueOnce({
                thread_id: "$global",
                root_event_id: "$root1",
                room_id: "!room:test",
                sender: "@alice:test",
            })
            .mockResolvedValueOnce({
                thread_id: "$room",
                root_event_id: "$root2",
                room_id: "!room:test",
                sender: "@alice:test",
            });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new ThreadingManager({ http: { authedRequest } } as any);

        await manager.createGlobalThread({ roomId: "!room:test", rootEventId: "$root1" });
        await manager.createRoomThread("!room:test", "$root2");

        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Post,
            "/threads",
            undefined,
            {
                room_id: "!room:test",
                root_event_id: "$root1",
                content: {},
                origin_server_ts: undefined,
            },
            { prefix: ClientPrefix.V1 },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Post,
            `/rooms/${encodeURIComponent("!room:test")}/threads`,
            undefined,
            {
                root_event_id: "$root2",
                content: {},
                origin_server_ts: undefined,
            },
            { prefix: ClientPrefix.V1 },
        );
    });

    it("uses the v1 thread search and replies endpoints", async () => {
        const authedRequest = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new ThreadingManager({ http: { authedRequest } } as any);

        await manager.searchRoomThreads("!room:test", { q: "hello", limit: 5 });
        await manager.getThreadReplies("!room:test", "$thread", { limit: 10, from: "reply-batch" });

        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Get,
            `/rooms/${encodeURIComponent("!room:test")}/threads/search`,
            {
                q: "hello",
                limit: 5,
            },
            undefined,
            { prefix: ClientPrefix.V1 },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Get,
            `/rooms/${encodeURIComponent("!room:test")}/threads/${encodeURIComponent("$thread")}/replies`,
            {
                limit: 10,
                from: "reply-batch",
            },
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    });

    it("uses the v1 thread subscription endpoint with notification_level", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            id: 1,
            room_id: "!room:test",
            thread_id: "$thread",
            user_id: "@alice:test",
            notification_level: "mentions",
            is_muted: false,
            subscribed_ts: 1,
            updated_ts: 1,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new ThreadingManager({ http: { authedRequest } } as any);

        await manager.subscribeToThread("!room:test", "$thread", "mentions");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            `/rooms/${encodeURIComponent("!room:test")}/threads/${encodeURIComponent("$thread")}/subscribe`,
            undefined,
            { notification_level: "mentions" },
            { prefix: ClientPrefix.V1 },
        );
    });

    it("uses the v1 thread lifecycle endpoints for delete freeze unfreeze and redact", async () => {
        const authedRequest = vi.fn().mockResolvedValue(undefined);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new ThreadingManager({ http: { authedRequest } } as any);

        await manager.deleteRoomThread("!room:test", "$thread");
        await manager.freezeThread("!room:test", "$thread");
        await manager.unfreezeThread("!room:test", "$thread");
        await manager.redactThreadReply("!room:test", "$reply");

        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Delete,
            `/rooms/${encodeURIComponent("!room:test")}/threads/${encodeURIComponent("$thread")}`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Post,
            `/rooms/${encodeURIComponent("!room:test")}/threads/${encodeURIComponent("$thread")}/freeze`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            3,
            Method.Post,
            `/rooms/${encodeURIComponent("!room:test")}/threads/${encodeURIComponent("$thread")}/unfreeze`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            4,
            Method.Post,
            `/rooms/${encodeURIComponent("!room:test")}/replies/${encodeURIComponent("$reply")}/redact`,
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    });

    it("uses the v1 thread reply and read endpoints with contract bodies", async () => {
        const authedRequest = vi.fn().mockResolvedValueOnce({ event_id: "$reply" }).mockResolvedValueOnce({
            id: 1,
            room_id: "!room:test",
            thread_id: "$thread",
            user_id: "@alice:test",
            last_read_event_id: "$event",
            last_read_ts: 123,
            unread_count: 0,
            updated_ts: 123,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new ThreadingManager({ http: { authedRequest } } as any);

        await manager.addThreadReply("!room:test", "$thread", {
            eventId: "$reply",
            rootEventId: "$root",
            content: { body: "hi" },
            inReplyToEventId: "$prev",
            originServerTs: 123,
        });
        await manager.markThreadRead("!room:test", "$thread", "$event", 123);

        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Post,
            `/rooms/${encodeURIComponent("!room:test")}/threads/${encodeURIComponent("$thread")}/replies`,
            undefined,
            {
                event_id: "$reply",
                root_event_id: "$root",
                content: { body: "hi" },
                in_reply_to_event_id: "$prev",
                origin_server_ts: 123,
            },
            { prefix: ClientPrefix.V1 },
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Post,
            `/rooms/${encodeURIComponent("!room:test")}/threads/${encodeURIComponent("$thread")}/read`,
            undefined,
            {
                event_id: "$event",
                origin_server_ts: 123,
            },
            { prefix: ClientPrefix.V1 },
        );
    });

    it("uses the v3 legacy thread search endpoint", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ chunk: [], next_batch: null });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new ThreadingManager({ http: { authedRequest } } as any);

        await manager.getLegacyRoomThreadList("@alice:test", "!room:test", {
            limit: 10,
            from: "legacy-batch",
            includeAll: true,
        });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            `/user/${encodeURIComponent("@alice:test")}/rooms/${encodeURIComponent("!room:test")}/threads`,
            {
                limit: 10,
                from: "legacy-batch",
                include_all: true,
            },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("uses relative spaces endpoints with the v3 client prefix", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ spaces: [] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const manager = new SpaceManager({ http: { authedRequest } } as any);

        await manager.getUserSpaces(true);

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/spaces/user", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("uses relative room summary sync paths with the v3 client prefix", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ ok: true });
        const manager = new RoomSummaryManager({
            http: { authedRequest },
            getRoomSummary: vi.fn(),
            getRoomSummaryMembers: vi.fn(),
            getRoomSummaryStats: vi.fn(),
            getRoomHierarchy: vi.fn(),
            publicRooms: vi.fn(),
            getRooms: vi.fn().mockReturnValue([]),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        await manager.syncSummary("!room:test");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            `/rooms/${encodeURIComponent("!room:test")}/summary/sync`,
            undefined,
            {},
            { prefix: ClientPrefix.V3 },
        );
    });

    it("includes markdown code-block endpoints in the contract audit", () => {
        const output = execFileSync(process.execPath, [auditScriptPath], {
            cwd: fileURLToPath(new URL("../..", import.meta.url)),
            encoding: "utf8",
        });
        const report = JSON.parse(output);

        const rendezvousContract = report.contracts.byFile.find((item: { file: string; endpoints: number }) => {
            return item.file === "rendezvous.md";
        });

        expect(rendezvousContract?.endpoints).toBeGreaterThan(0);
    });

    it("detects helper-level request wrappers in the contract audit", () => {
        const output = execFileSync(process.execPath, [auditScriptPath], {
            cwd: fileURLToPath(new URL("../..", import.meta.url)),
            encoding: "utf8",
        });
        const report = JSON.parse(output);
        const missingEndpoints = new Set(report.source.coverage.missingEndpoints as string[]);

        expect(missingEndpoints.has("GET /_matrix/client/{}/joined_rooms")).toBe(false);
        expect(missingEndpoints.has("GET /_matrix/client/{}/my_rooms")).toBe(false);
    });

    it("keeps manager declarations and default extension modules aligned with runtime implementations", () => {
        const output = execFileSync(process.execPath, [auditScriptPath], {
            cwd: fileURLToPath(new URL("../..", import.meta.url)),
            encoding: "utf8",
        });
        const report = JSON.parse(output);

        expect(report.managers.implementedOnlyManagers).toEqual([]);
        expect(report.managers.defaultManagerModules).toEqual(
            expect.arrayContaining(["secure-backup", "oidc/manager", "telemetry", "rendezvous/RendezvousManager"]),
        );
    });
});
