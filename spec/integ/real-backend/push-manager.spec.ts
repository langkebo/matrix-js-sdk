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

/**
 * Push Manager Real-Backend Tests
 *
 * Validates pusher CRUD and push rules against a live synapse-rust backend.
 *
 * Prerequisites:
 *   - synapse-rust running at TestConfig.baseUrl
 *   - TestConfig.testUser provisioned
 *
 * Run with: pnpm run test:real-backend:batch -- spec/integ/real-backend/push-manager.spec.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendPushClient } from "../../../src/push/index";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

extendPushClient();

describe("PushManager — real backend", () => {
    let client: MatrixClient;
    let backendAvailable = false;

    beforeAll(async () => {
        try {
            client = await loginAsConfiguredUser();
            backendAvailable = true;
        } catch (e) {
            console.warn("Backend not reachable, skipping push real-backend tests:", (e as Error).message);
        }
    }, TestConfig.timeout.long);

    afterAll(() => {
        client?.stopClient();
    });

    describe("pushers", () => {
        it("lists pushers via getPushers", async () => {
            if (!backendAvailable) return;
            const push = client.getPushManager();
            const pushers = await push.getPushers(true);
            expect(Array.isArray(pushers)).toBe(true);
        });

        it("sets and removes a pusher", async () => {
            if (!backendAvailable) return;
            const push = client.getPushManager();
            const testPushkey = `test_pushkey_${Date.now()}`;

            await push.setPusher({
                pushkey: testPushkey,
                kind: "http",
                app_id: "test.app.id",
                app_display_name: "Test Pusher",
                device_display_name: "Test Device",
                lang: "en",
                data: { url: "https://example.com/push" },
            });

            const pushersAfterSet = await push.getPushers(true);
            const created = pushersAfterSet.find((p) => p.pushkey === testPushkey);
            expect(created).toBeDefined();

            await push.removePusher(testPushkey, "test.app.id");

            const pushersAfterRemove = await push.getPushers(true);
            const removed = pushersAfterRemove.find((p) => p.pushkey === testPushkey);
            expect(removed).toBeUndefined();
        });
    });

    describe("push rules", () => {
        it("lists all push rules via getPushRules", async () => {
            if (!backendAvailable) return;
            const push = client.getPushManager();
            const rules = await push.getPushRules(true);
            expect(rules).toHaveProperty("global");
        });

        it("lists push rules by scope", async () => {
            if (!backendAvailable) return;
            const push = client.getPushManager();
            const rules = await push.getPushRulesByScope("global");
            expect(rules).toBeDefined();
            expect(rules).toHaveProperty("override");
            expect(rules).toHaveProperty("content");
            expect(rules).toHaveProperty("underride");
        });
    });
});
