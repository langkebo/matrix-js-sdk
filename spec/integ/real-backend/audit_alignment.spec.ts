import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import {
    BurnAfterReadManager,
    extendMatrixClient as extendBurnAfterReadClient,
} from "../../../src/burn-after-read/index";
import { extendMatrixClient as extendFriendClient, FriendRelationshipStatus } from "../../../src/friend/index";
import { extendMatrixClient as extendRoomListClient } from "../../../src/room-list/index";
import { extendMatrixClient as extendRoomSummaryClient } from "../../../src/room-summary/index";
import { extendMatrixClient as extendSyncClient } from "../../../src/sync-management/index";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

extendFriendClient();
extendBurnAfterReadClient();
extendRoomListClient();
extendRoomSummaryClient();
extendSyncClient();

const ALLOWED_FRIEND_STATUSES = new Set<string>(Object.values(FriendRelationshipStatus));

async function login(): Promise<MatrixClient> {
    return loginAsConfiguredUser();
}

describe("SDK 与后端对齐审计自动化测试套件", () => {
    let client: MatrixClient;
    let roomId: string;
    let backendAvailable = false;

    beforeAll(async () => {
        try {
            client = await login();
            const room = await client.createRoom({
                name: `SDK Audit ${Date.now()}`,
                topic: "SDK audit alignment validation",
            });
            roomId = room.room_id;
            backendAvailable = true;
        } catch {
            backendAvailable = false;
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        await client?.logout?.().catch(() => undefined);
    });

    it(
        "should send message with standard Matrix content structure",
        async () => {
            if (!backendAvailable) return;
            const content = { msgtype: "m.text", body: "Hello World" };
            const response = await (client as any).sendEvent(roomId, "m.room.message", content);
            expect(response.event_id).toBeTruthy();
        },
        TestConfig.timeout.medium,
    );

    it(
        "should fetch room summary members",
        async () => {
            if (!backendAvailable) return;
            const members = await client.getRoomSummaryManager().getRoomSummaryMembers(roomId);
            expect(Array.isArray(members)).toBe(true);
        },
        TestConfig.timeout.medium,
    );

    it(
        "should normalize friend statuses through FriendManager",
        async () => {
            if (!backendAvailable) return;
            const friendManager = client.getFriendManager();
            const friends = await friendManager.getFriends();
            expect(Array.isArray(friends)).toBe(true);
            expect(friends.every((friend) => !friend.status || ALLOWED_FRIEND_STATUSES.has(friend.status))).toBe(true);
            expect(friendManager.getFriendCount()).toBe(friends.length);
        },
        TestConfig.timeout.medium,
    );

    it(
        "should keep burn-after-read default timeout aligned to 60s",
        async () => {
            const burnManager = backendAvailable
                ? client.getBurnAfterReadManager()
                : new BurnAfterReadManager({} as any);
            const config = burnManager.getBurnConfig();
            expect(config.default_expire_time).toBe(60000);
            if (!backendAvailable) return;
            const settings = await burnManager.enableBurn(roomId);
            expect(settings.burn_after_ms).toBe(60000);
            await burnManager.disableBurn(roomId);
        },
        TestConfig.timeout.medium,
    );

    it(
        "should expose my_rooms through RoomListManager",
        async () => {
            if (!backendAvailable) return;
            const roomListManager = client.getRoomListManager();
            const result = await roomListManager.getMyRooms();
            expect(Array.isArray(result.rooms)).toBe(true);
            expect(typeof result.total).toBe("number");
        },
        TestConfig.timeout.medium,
    );
});
