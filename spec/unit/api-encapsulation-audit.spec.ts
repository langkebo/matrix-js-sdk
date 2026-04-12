import { describe, expect, it, vi } from "vitest";

import { AuthManager } from "../../src/auth/index";
import { ApplicationServiceManager } from "../../src/appservice/index";
import { DeviceManager } from "../../src/device/index";
import { DiscoveryManager } from "../../src/discovery/index";
import { ExternalServiceManager } from "../../src/external-service/index";
import { FederationManager } from "../../src/federation/index";
import { GuestManager } from "../../src/guest/index";
import { PresenceManager } from "../../src/presence/index";
import { RoomSummaryManager } from "../../src/room-summary/index";
import { SamlAuthManager } from "../../src/saml/index";
import { SpaceManager } from "../../src/space/index";
import { VoiceMessageManager } from "../../src/voice/index";
import { AdminPrefix, ClientPrefix, Method } from "../../src/http-api";

describe("API encapsulation audit", () => {
    it("uses a public request for auth login flows", async () => {
        const request = vi.fn();
        const authedRequest = vi.fn().mockResolvedValue({ flows: [] });
        const manager = new AuthManager({ http: { request, authedRequest } } as any);

        await manager.getSupportedLoginFlows();

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/login", undefined, undefined, { prefix: undefined });
        expect(request).not.toHaveBeenCalled();
    });

    it("uses relative device paths with the v3 client prefix", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ devices: [] });
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

    it("uses the admin prefix for federation blacklist requests", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ blacklist: [] });
        const manager = new FederationManager({
            http: { authedRequest },
            getUserId: () => "@admin:test",
        } as any);

        await manager.getBlacklist();

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/federation/blacklist", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });

    it("uses relative public rooms paths for federation room discovery", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ chunk: [] });
        const manager = new FederationManager({
            http: { authedRequest },
            getUserId: () => "@admin:test",
        } as any);

        await manager.getPublicRoomsOnServer("example.com", 20, "s123");

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/publicRooms",
            { limit: 20, since: "s123" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("uses the admin prefix for appservice registration", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ application_services: [] });
        const manager = new ApplicationServiceManager({
            http: { authedRequest },
            getDomain: () => "test",
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
        const manager = new DiscoveryManager({ http: { request, authedRequest }, baseUrl: "https://hs" } as any);

        await manager.getServerDiscoveryInfo();

        expect(request).toHaveBeenCalledWith(Method.Get, "/.well-known/matrix/client", undefined, undefined, {
            prefix: "",
        });
        expect(authedRequest).not.toHaveBeenCalled();
    });

    it("uses the directory lookup endpoint for guest join probes on aliases", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ room_id: "!room:test" });
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

    it("uses relative saml login paths with the v3 client prefix", async () => {
        const request = vi.fn().mockResolvedValue({
            saml_request: "REQ",
            saml_request_id: "REQ_ID",
            redirect_url: "https://idp/redirect",
        });
        const manager = new SamlAuthManager({ http: { request } } as any);

        await manager.initiateLogin();

        expect(request).toHaveBeenCalledWith(
            Method.Post,
            "/login/saml/redirect",
            undefined,
            { redirect_url: undefined },
            {
                prefix: ClientPrefix.V3,
            },
        );
    });

    it("uses relative voice api paths with the r0 client prefix", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ url: "mxc://x/y", duration: 1, confidence: 0.5 });
        const manager = new VoiceMessageManager({
            http: { authedRequest },
            mxcToHttp: vi.fn().mockReturnValue("http://example.com/mxc/x/y"),
        } as any);

        await manager.convertVoiceMessage({ messageId: "$event123" });

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Post,
            "/voice/convert",
            undefined,
            {
                message_id: "$event123",
                target_format: "mp3",
                quality: 128,
                bitrate: 128000,
            },
            {
                prefix: "/_matrix/client/r0",
            },
        );
    });

    it("uses relative spaces endpoints with the v3 client prefix", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ spaces: [] });
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

    it("uses relative admin paths for external service requests", async () => {
        const authedRequest = vi.fn().mockResolvedValue([]);
        const manager = new ExternalServiceManager({ http: { authedRequest } } as any);

        await manager.listServices();

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/external_services", undefined, undefined, {
            prefix: AdminPrefix.V1,
        });
    });
});
