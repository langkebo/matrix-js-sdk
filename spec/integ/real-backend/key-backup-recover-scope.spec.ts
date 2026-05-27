import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendE2EEClient } from "../../../src/e2ee/index";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

extendE2EEClient();

interface ScopedRestoreResponse {
    recovered_keys: number;
    total_keys: number;
}

describe("Secure backup scoped restore real backend integration", () => {
    let client: MatrixClient;
    let backendAvailable = false;
    let setupError: unknown;
    let backupId = "";

    const roomA = `!recover-scope-a-${Date.now()}:matrix.test`;
    const roomB = `!recover-scope-b-${Date.now()}:matrix.test`;
    const passphrase = `ScopedRestore!${Date.now()}`;

    beforeAll(async () => {
        try {
            client = await loginAsConfiguredUser({
                ...TestConfig.testUser,
                deviceId: "REAL_BACKEND_KEY_BACKUP_SCOPE",
            });
            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        await client?.logout?.(true).catch(() => undefined);
    });

    it(
        "restores only the requested rooms when a room scope filter is provided",
        async () => {
            expect(
                backendAvailable,
                `real backend should be reachable for this integration test: ${String(setupError)}`,
            ).toBe(true);

            const created = await client.createSecureBackup(passphrase);
            backupId = created.backup_id;

            const storeResult = await client.storeSecureBackupKeys(backupId, passphrase, [
                {
                    room_id: roomA,
                    session_id: "scope-session-a",
                    session_key: "secure-session-key-a",
                    first_message_index: 0,
                    forwarded_count: 0,
                    is_verified: true,
                },
                {
                    room_id: roomB,
                    session_id: "scope-session-b",
                    session_key: "secure-session-key-b",
                    first_message_index: 1,
                    forwarded_count: 0,
                    is_verified: false,
                },
            ]);
            expect(storeResult.key_count).toBeGreaterThanOrEqual(2);

            const recovered = (await client.getE2EEManager().restoreSecureBackup(backupId, {
                passphrase,
                rooms: [roomA],
            })) as unknown as ScopedRestoreResponse;
            expect(recovered.recovered_keys).toBe(1);
            expect(recovered.total_keys).toBe(2);
        },
        TestConfig.timeout.long,
    );
});
