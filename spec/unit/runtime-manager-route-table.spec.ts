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

import { AuthManager } from "../../src/auth";
import { AUTH_ROUTES } from "../../src/auth/__generated__/route-table";
import { BurnAfterReadManager } from "../../src/burn-after-read";
import { BURN_AFTER_READ_ROUTES } from "../../src/burn-after-read/__generated__/route-table";
import { E2EE_ROUTES } from "../../src/e2ee/__generated__/route-table";
import { FriendManager } from "../../src/friend";
import { FRIEND_ROUTES } from "../../src/friend/__generated__/route-table";
import { Method } from "../../src/http-api/method";
import { ClientPrefix } from "../../src/http-api/prefix";
import { DeviceManager } from "../../src/device";
import { DEVICE_ROUTES } from "../../src/device/__generated__/route-table";
import { KeyVerificationManager } from "../../src/key-verification";
import { PushManager } from "../../src/push";
import { PUSH_ROUTES } from "../../src/push/__generated__/route-table";
import { RoomManager } from "../../src/room/RoomManager";
import { ROOM_ROUTES } from "../../src/room/__generated__/route-table";
import { SecureBackupManager } from "../../src/secure-backup";
import { SLIDING_SYNC_ROUTES } from "../../src/sliding-sync/__generated__/route-table";
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
        const client = { http: { authedRequest } } as unknown as ConstructorParameters<typeof KeyVerificationManager>[0];
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
});
