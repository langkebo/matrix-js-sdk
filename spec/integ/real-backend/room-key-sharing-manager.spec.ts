import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendRoomKeySharingClient } from "../../../src/room-key-sharing/index";
import { TestConfig } from "./TestConfig";

extendRoomKeySharingClient();

type TestUserConfig = {
    localpart: string;
    password: string;
};

function createTestUser(localpartPrefix: string): TestUserConfig {
    return {
        localpart: `${localpartPrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        password: "Test@123",
    };
}

async function registerUser(user: TestUserConfig): Promise<MatrixClient> {
    const registrationClient = createClient({ baseUrl: TestConfig.baseUrl, allowInsecureHttp: true });
    const result = await registrationClient.registerRequest({
        username: user.localpart,
        password: user.password,
        auth: { type: "m.login.dummy" },
    });

    return createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
        accessToken: result.access_token,
        userId: result.user_id,
        deviceId: result.device_id,
    });
}

describe("RoomKeySharingManager real backend integration", () => {
    let client: MatrixClient;
    let backendAvailable = false;
    let setupError: unknown;
    let roomId: string;

    beforeAll(async () => {
        try {
            client = await registerUser(createTestUser("rk_primary"));
            const room = await client.createRoom({ name: `rk_test_${Date.now()}` });
            roomId = room.room_id;
            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        await client?.logout?.().catch(() => undefined);
    });

    it("should round-trip room key request listing and cancellation through backend HTTP routes", async () => {
        expect(
            backendAvailable,
            `real backend should be reachable for this integration test: ${String(setupError)}`,
        ).toBe(true);

        const manager = client.getRoomKeySharingManager();
        const sessionId = `rk_session_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

        const created = await manager.requestRoomKey(roomId, sessionId);
        expect(created.request_id).toBeTruthy();

        const listed = await manager.getRoomKeyRequests({ room_id: roomId, session_id: sessionId, status: "all" });
        const pending = listed.requests.find((request) => request.request_id === created.request_id);
        expect(pending).toBeTruthy();
        expect(pending?.room_id).toBe(roomId);
        expect(pending?.session_id).toBe(sessionId);
        expect(pending?.status).toBe("pending");

        await manager.deleteRoomKeyRequest(created.request_id);

        const cancelled = await manager.getRoomKeyRequests({
            room_id: roomId,
            session_id: sessionId,
            status: "cancelled",
        });
        const cancelledRequest = cancelled.requests.find((request) => request.request_id === created.request_id);
        expect(cancelledRequest).toBeTruthy();
        expect(cancelledRequest?.status).toBe("cancelled");
    }, TestConfig.timeout.medium);
});

