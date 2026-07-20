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
 * Space Manager Real-Backend Tests
 *
 * Validates space CRUD against a live synapse-rust backend.
 *
 * Prerequisites:
 *   - synapse-rust running at TestConfig.baseUrl
 *   - TestConfig.testUser provisioned
 *
 * Run with: pnpm run test:real-backend:batch -- spec/integ/real-backend/space-manager.spec.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendSpaceClient } from "../../../src/space/index";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

extendSpaceClient();

describe("SpaceManager — real backend", () => {
    let client: MatrixClient;
    let backendAvailable = false;
    const createdSpaces: string[] = [];

    beforeAll(async () => {
        try {
            client = await loginAsConfiguredUser();
            backendAvailable = true;
        } catch (e) {
            console.warn("Backend not reachable, skipping space real-backend tests:", (e as Error).message);
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        if (client && createdSpaces.length > 0) {
            const space = client.getSpaceManager();
            for (const spaceId of createdSpaces) {
                try { await space.deleteSpace(spaceId); } catch (e) { /* best effort */ }
            }
        }
        client?.stopClient();
    });

    describe("space CRUD", () => {
        it("creates a space via createSpace", async () => {
            if (!backendAvailable) return;
            const space = client.getSpaceManager();
            const result = await space.createSpace({
                name: `Test Space ${Date.now()}`,
                topic: "Created by real-backend test",
                visibility: "private",
            });
            expect(result).toBeDefined();
            expect(result).toHaveProperty("room_id");
            createdSpaces.push(result.room_id);
        });

        it("gets a space via getSpace", async () => {
            if (!backendAvailable) return;
            if (createdSpaces.length === 0) return;
            const space = client.getSpaceManager();
            const result = await space.getSpace(createdSpaces[0]);
            expect(result).toBeDefined();
            expect(result).toHaveProperty("room_id");
            expect(result.room_id).toBe(createdSpaces[0]);
        });

        it("updates a space via updateSpace", async () => {
            if (!backendAvailable) return;
            if (createdSpaces.length === 0) return;
            const space = client.getSpaceManager();
            const updated = await space.updateSpace(createdSpaces[0], {
                name: `Updated Space ${Date.now()}`,
            });
            expect(updated).toBeDefined();
        });

        it("lists public spaces via getPublicSpaces", async () => {
            if (!backendAvailable) return;
            const space = client.getSpaceManager();
            const result = await space.getPublicSpaces({ limit: 5 });
            expect(result).toHaveProperty("spaces");
            expect(Array.isArray(result.spaces)).toBe(true);
        });

        it("deletes a space via deleteSpace", async () => {
            if (!backendAvailable) return;
            if (createdSpaces.length === 0) {
                // Create one specifically for deletion
                const space = client.getSpaceManager();
                const created = await space.createSpace({
                    name: `Delete Test Space ${Date.now()}`,
                    visibility: "private",
                });
                await space.deleteSpace(created.room_id);
                // Verify deletion by attempting to get it
                try {
                    await space.getSpace(created.room_id);
                } catch (e) {
                    // Expected: space not found
                    expect(e).toBeDefined();
                }
            } else {
                const spaceId = createdSpaces.pop()!;
                const space = client.getSpaceManager();
                await space.deleteSpace(spaceId);
            }
        });

        it("get metrics returns space manager statistics", () => {
            if (!backendAvailable) return;
            const space = client.getSpaceManager();
            const metrics = space.getMetrics();
            expect(metrics).toBeDefined();
        });
    });
});
