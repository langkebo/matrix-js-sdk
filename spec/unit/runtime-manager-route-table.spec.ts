/*
Copyright 2026 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { describe, expect, it, vi } from "vitest";

import { AccountDataManager } from "../../src/account-data";
import { ACCOUNT_DATA_ROUTES } from "../../src/account-data/__generated__/route-table";
import { AuthManager } from "../../src/auth";
import { AUTH_ROUTES } from "../../src/auth/__generated__/route-table";
import { AIConnectionManager } from "../../src/ai-connection";
import { AI_CONNECTION_ROUTES } from "../../src/ai-connection/__generated__/route-table";
import { BurnAfterReadManager } from "../../src/burn-after-read";
import { BURN_AFTER_READ_ROUTES } from "../../src/burn-after-read/__generated__/route-table";
import { CaptchaManager } from "../../src/captcha";
import { CAPTCHA_ROUTES } from "../../src/captcha/__generated__/route-table";
import { CasManager } from "../../src/cas";
import { CAS_ROUTES } from "../../src/cas/__generated__/route-table";
import { E2EE_ROUTES } from "../../src/e2ee/__generated__/route-table";
import { FilterManager } from "../../src/filter/index";
import { FriendManager } from "../../src/friend";
import { FRIEND_ROUTES } from "../../src/friend/__generated__/route-table";
import { Method } from "../../src/http-api/method";
import { ClientPrefix } from "../../src/http-api/prefix";
import { DeviceManager } from "../../src/device";
import { DEVICE_ROUTES } from "../../src/device/__generated__/route-table";
import { KeyVerificationManager } from "../../src/key-verification";
import { MediaManager } from "../../src/media";
import { MEDIA_ROUTES } from "../../src/media/__generated__/route-table";
import { NotificationsManager } from "../../src/notifications";
import { OidcManager } from "../../src/oidc/manager";
import { OIDC_ROUTES } from "../../src/oidc/__generated__/route-table";
import { OpenClawManager } from "../../src/open-claw";
import { OPENCLAW_ROUTES } from "../../src/open-claw/__generated__/route-table";
import { PresenceManager } from "../../src/presence";
import { PRESENCE_ROUTES } from "../../src/presence/__generated__/route-table";
import { PushManager } from "../../src/push";
import { PUSH_ROUTES } from "../../src/push/__generated__/route-table";
import { RelationsManager } from "../../src/relations";
import { RELATIONS_ROUTES } from "../../src/relations/__generated__/route-table";
import { RoomSummaryManager } from "../../src/room-summary";
import { ROOM_SUMMARY_ROUTES } from "../../src/room-summary/__generated__/route-table";
import { RoomManager } from "../../src/room/RoomManager";
import { ROOM_ROUTES } from "../../src/room/__generated__/route-table";
import { SamlAuthManager } from "../../src/saml";
import { SAML_ROUTES } from "../../src/saml/__generated__/route-table";
import { SearchManager } from "../../src/search";
import { SEARCH_ROUTES } from "../../src/search/__generated__/route-table";
import { SecureBackupManager } from "../../src/secure-backup";
import { SLIDING_SYNC_ROUTES } from "../../src/sliding-sync/__generated__/route-table";
import { SpaceManager } from "../../src/space";
import { SPACE_ROUTES } from "../../src/space/__generated__/route-table";
import { TagManager } from "../../src/tags";
import { TAGS_ROUTES } from "../../src/tags/__generated__/route-table";
import { THREAD_ROUTES } from "../../src/thread/__generated__/route-table";
import { ThreadingManager } from "../../src/threading";
import { TypingManager } from "../../src/typing";
import { TYPING_ROUTES } from "../../src/typing/__generated__/route-table";
import { VerificationManager } from "../../src/verification";
import { VERIFICATION_ROUTES } from "../../src/verification/__generated__/route-table";

type RouteTable = readonly { readonly method: string; readonly path: string }[];
type RequestOptions = { prefix?: string };

function routeTemplateToRegExp(template: string): RegExp {
    const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped.replace(/\\\{[^}]+\\\}/g, "[^/]+")}$`);
}

function fullRuntimePath(path: string, options?: RequestOptions, defaultPrefix = ClientPrefix.V3): string {
    if (
        path === "/" ||
        path.startsWith("/_matrix/") ||
        path.startsWith("/.well-known/") ||
        path.startsWith("/_health") ||
        path.startsWith("/health")
    ) {
        return path;
    }

    return `${options?.prefix ?? defaultPrefix}${path}`;
}

function hasRouteTableMatch(routeTable: RouteTable, method: string, path: string): boolean {
    return routeTable.some((route) => {
        return route.method === method && routeTemplateToRegExp(route.path).test(path);
    });
}

describe("runtime manager route-table contract", () => {
    it("keeps AuthManager login flows on the generated auth route-table", async () => {
        const request = vi.fn().mockResolvedValue({ flows: [] });
        const client = { http: { request } } as unknown as ConstructorParameters<typeof AuthManager>[0];
        const manager = new AuthManager(client);

        await manager.getSupportedLoginFlows(true);

        const [method, path, , , options] = request.mock.calls[0] as [string, string, unknown, unknown, RequestOptions];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(AUTH_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps FriendManager requests on the generated friend route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({});
        const client = {
            getUserId: () => "@alice:example.com",
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof FriendManager>[0];
        const manager = new FriendManager(client);

        await manager.sendFriendRequest("@bob:example.com", "hi");

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(FRIEND_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps BurnAfterReadManager settings on the generated burn-after-read route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ enabled: true, burn_after_ms: 60000 });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof BurnAfterReadManager>[0];
        const manager = new BurnAfterReadManager(client);

        await manager.enableBurn("!room:example.com");
        manager.stop();

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(BURN_AFTER_READ_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps sliding-sync runtime calls on the generated sliding-sync route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ pos: "p1", lists: {}, rooms: {}, extensions: {} });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof RoomManager>[0];
        const manager = new RoomManager(client);

        await manager.slidingSync({ timeout: 0, lists: {}, extensions: {} });

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(SLIDING_SYNC_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps RoomManager room version calls on the generated room route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ room_version: "10" });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof RoomManager>[0];
        const manager = new RoomManager(client);

        await manager.getRoomVersion("!room:example.com");

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(ROOM_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps PushManager pusher calls on the generated push route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ pushers: [] });
        const client = {
            doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(false),
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof PushManager>[0];
        const manager = new PushManager(client);

        await manager.getPushers(true);

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(PUSH_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps DeviceManager list calls on the generated device route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ devices: [] });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof DeviceManager>[0];
        const manager = new DeviceManager(client);

        await manager.getDevices(true);

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(DEVICE_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps KeyVerificationManager QR calls on the generated verification route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ qr_code_data: "qr", transaction_id: "txn" });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<
            typeof KeyVerificationManager
        >[0];
        const manager = new KeyVerificationManager(client);

        await manager.showQrCode("txn", "v3");

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(VERIFICATION_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps VerificationManager explicit v3 calls on the generated verification route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ transaction_id: "txn" });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof VerificationManager>[0];
        const manager = new VerificationManager(client);

        await manager.startVerification({ from_device: "DEVICE", to_user: "@alice:example.org" }, "v3");

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(VERIFICATION_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps SecureBackupManager creation on the generated e2ee secure-backup route-table slice", async () => {
        const authedRequest = vi.fn().mockResolvedValue({
            backup_id: "backup-1",
            version: "1",
            algorithm: "m.megolm.v1.aes-sha2",
            auth_data: {},
            key_count: 0,
        });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof SecureBackupManager>[0];
        const manager = new SecureBackupManager(client);

        await manager.createSecureBackup("passphrase");

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        expect(method).toBe(Method.Post);
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(E2EE_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps OpenClawManager connection calls on the generated openclaw route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue([]);
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof OpenClawManager>[0];
        const manager = new OpenClawManager(client);

        await manager.listConnections();

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(OPENCLAW_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps AIConnectionManager discovery-selected calls on the generated ai-connection route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue([]);
        const client = {
            doesServerAdvertiseSynapseRustFeature: vi.fn().mockResolvedValue(true),
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof AIConnectionManager>[0];
        const manager = new AIConnectionManager(client);

        await manager.listConnections();

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(AI_CONNECTION_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps MediaManager preview calls on the generated media route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({});
        const client = {
            baseUrl: "https://hs.example.org",
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof MediaManager>[0];
        const manager = new MediaManager(client);

        await manager.previewUrl("https://example.org");

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(MEDIA_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps OidcManager authorize calls on the generated OIDC route-table", async () => {
        const request = vi.fn().mockResolvedValue({ url: "https://issuer.example.org/authorize" });
        const client = {
            http: { request },
        } as unknown as ConstructorParameters<typeof OidcManager>[0];
        const manager = new OidcManager(client);

        await manager.authorize({
            client_id: "client",
            redirect_uri: "https://app.example.org/callback",
            response_type: "code",
            scope: "openid",
        });

        const [method, path, , , options] = request.mock.calls[0] as [string, string, unknown, unknown, RequestOptions];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(OIDC_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps SamlAuthManager login calls on the generated SAML route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ redirect_url: "https://idp.example.org/sso" });
        const client = {
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof SamlAuthManager>[0];
        const manager = new SamlAuthManager(client);

        await manager.initiateLogin("https://app.example.org/after-login");

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(SAML_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps PresenceManager status calls on the generated presence route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({});
        const client = {
            getUserId: () => "@alice:example.org",
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof PresenceManager>[0];
        const manager = new PresenceManager(client);

        await manager.setPresence("online", "available");

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(PRESENCE_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps TypingManager send calls on the generated typing route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({});
        const client = {
            getUserId: () => "@alice:example.org",
            isGuest: () => false,
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof TypingManager>[0];
        const manager = new TypingManager(client);

        await manager.sendTyping("!room:example.org", true, 30000);

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(TYPING_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps NotificationsManager list calls on the generated push notifications route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ notifications: [] });
        const client = {
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof NotificationsManager>[0];
        const manager = new NotificationsManager(client);

        await manager.getNotifications({ limit: 10 });

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(PUSH_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps TagManager room tag calls on the generated tags route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ tags: {} });
        const client = {
            getUserId: () => "@alice:example.org",
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof TagManager>[0];
        const manager = new TagManager(client);

        await manager.getRoomTags("!room:example.org");

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(TAGS_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps RelationsManager relation calls on the generated relations route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ chunk: [] });
        const client = {
            canSupport: new Map(),
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof RelationsManager>[0];
        const manager = new RelationsManager(client);

        await manager.fetchRelations("!room:example.org", "$event", null, null, {});

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(RELATIONS_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps AccountDataManager list calls on the generated account-data route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ account_data: {} });
        const client = {
            credentials: { userId: "@alice:example.org" },
            http: { authedRequest },
        } as unknown as ConstructorParameters<typeof AccountDataManager>[0];
        const manager = new AccountDataManager(client);

        await manager.listAccountData();

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(ACCOUNT_DATA_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps FilterManager creation calls on the generated account-data filter route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ filter_id: "filter-1" });
        const client = {
            getUserId: () => "@alice:example.org",
            http: { authedRequest },
            store: { storeFilter: vi.fn() },
        } as unknown as ConstructorParameters<typeof FilterManager>[0];
        const manager = new FilterManager(client);

        await manager.createFilter({ room: { timeline: { limit: 10 } } });

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(ACCOUNT_DATA_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps SpaceManager public-space calls on the generated space route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ spaces: [] });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof SpaceManager>[0];
        const manager = new SpaceManager(client);

        await manager.getPublicSpaces({ limit: 10 });

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(SPACE_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps SearchManager message search calls on the generated search route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ search_categories: { room_events: {} } });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof SearchManager>[0];
        const manager = new SearchManager(client);

        await manager.searchMessageText({ term: "hello" });

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(SEARCH_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps ThreadingManager thread list calls on the generated thread route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ threads: [], next_batch: null, total: 0 });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof ThreadingManager>[0];
        const manager = new ThreadingManager(client);

        await manager.getGlobalThreadList({ limit: 10 });

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(THREAD_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps RoomSummaryManager summary reads on the generated room-summary route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ room_id: "!room:example.org", name: "Room" });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof RoomSummaryManager>[0];
        const manager = new RoomSummaryManager(client);

        await manager.getRoomSummary("!room:example.org", undefined, true, true);

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(ROOM_SUMMARY_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps RoomSummaryManager member sub-manager calls on the generated room-summary route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue([]);
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof RoomSummaryManager>[0];
        const manager = new RoomSummaryManager(client);

        await manager.members.getRoomSummaryMembers("!room:example.org", true);

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(ROOM_SUMMARY_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps RoomSummaryManager stats sub-manager calls on the generated room-summary route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ member_count: 0 });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof RoomSummaryManager>[0];
        const manager = new RoomSummaryManager(client);

        await manager.stats.getRoomSummaryStats("!room:example.org", true);

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(ROOM_SUMMARY_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps CaptchaManager explicit r0 calls on the generated captcha route-table", async () => {
        const request = vi.fn().mockResolvedValue({
            captcha_id: "captcha-1",
            expires_in: 300,
            captcha_type: "email",
        });
        const client = { http: { request } } as unknown as ConstructorParameters<typeof CaptchaManager>[0];
        const manager = new CaptchaManager(client);

        await manager.sendCaptcha("email", "alice@example.org", undefined, "r0");

        const [method, path, , , options] = request.mock.calls[0] as [string, string, unknown, unknown, RequestOptions];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(CAPTCHA_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });

    it("keeps CasManager admin calls on the generated CAS route-table", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ services: [] });
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof CasManager>[0];
        const manager = new CasManager(client);

        await manager.listServices();

        const [method, path, , , options] = authedRequest.mock.calls[0] as [
            string,
            string,
            unknown,
            unknown,
            RequestOptions,
        ];
        const runtimePath = fullRuntimePath(path, options);
        expect(hasRouteTableMatch(CAS_ROUTES, method, runtimePath), `${method} ${runtimePath}`).toBe(true);
    });
});
