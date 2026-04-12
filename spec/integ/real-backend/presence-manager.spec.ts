import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, type MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendPresenceClient } from "../../../src/presence/index";
import { TestConfig } from "./TestConfig";

extendPresenceClient();

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

describe("PresenceManager real backend integration", () => {
    let client: MatrixClient;
    let backendAvailable = false;
    let setupError: unknown;

    beforeAll(async () => {
        try {
            client = await registerUser(createTestUser("presence"));
            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        await client?.logout?.().catch(() => undefined);
    });

    it(
        "should set and read back my presence state",
        async () => {
            if (!backendAvailable) {
                throw new Error(`Backend unavailable: ${String(setupError)}`);
            }

            const manager = client.getPresenceManager();
            await manager.setPresence("online", "presence test");

            const me = client.getUserId();
            const state = await manager.getPresence(me);
            expect(state).toBeTruthy();
            expect(state?.presence).toBe("online");
            expect(state?.status_msg).toBe("presence test");
        },
        TestConfig.timeout.medium,
    );

    it(
        "should subscribe and unsubscribe presence list",
        async () => {
            if (!backendAvailable) {
                throw new Error(`Backend unavailable: ${String(setupError)}`);
            }

            const manager = client.getPresenceManager();
            const me = client.getUserId();

            await manager.subscribeToPresence([me]);
            expect(manager.isSubscribed(me)).toBe(true);

            await manager.unsubscribeFromPresence([me]);
            expect(manager.isSubscribed(me)).toBe(false);
        },
        TestConfig.timeout.medium,
    );
});
