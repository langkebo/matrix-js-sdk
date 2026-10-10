import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

describe("Secure backup lifecycle real backend integration", () => {
    let client: MatrixClient;
    let backendAvailable = false;
    let setupError: unknown;
    let backupId: string | null = null;

    // The backend removed passphrase mode: the caller derives the backup key
    // client-side and supplies the algorithm plus the corresponding auth_data.
    const algorithm = "m.megolm_backup.v1.curve25519-aes-sha2";
    const authData = { public_key: `real-backend-backup-key-${Date.now()}` };

    beforeAll(async () => {
        try {
            client = await loginAsConfiguredUser({
                ...TestConfig.testUser,
                deviceId: "REAL_BACKEND_SECURE_BACKUP",
            });
            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        if (backupId) {
            await client?.deleteSecureBackup?.(backupId).catch(() => undefined);
        }
        await client?.logout?.(true).catch(() => undefined);
    });

    it(
        "should create, fetch, restore, and delete a secure backup through backend routes",
        async () => {
            expect(
                backendAvailable,
                `real backend should be reachable for this integration test: ${String(setupError)}`,
            ).toBe(true);

            const created = await client.createSecureBackup({ algorithm, auth_data: authData });
            backupId = created.backup_id;

            expect(created.backup_id).toBeTruthy();
            expect(created.version).toBeTruthy();
            expect(created.algorithm).toBeTruthy();

            const fetched = await client.getSecureBackup(created.backup_id);
            expect(fetched.backup_id).toBe(created.backup_id);
            expect(fetched.version).toBe(created.version);
            expect(fetched.algorithm).toBe(created.algorithm);

            const storeResult = await client.storeSecureBackupKeys(created.backup_id, [
                {
                    room_id: `!secure-backup-room-${Date.now()}:matrix.test`,
                    session_id: `session-${Date.now()}`,
                    session_key: "secure-backup-session-key",
                    first_message_index: 0,
                    forwarded_count: 0,
                    is_verified: true,
                },
            ]);
            expect(storeResult.key_count).toBeGreaterThan(0);

            const restored = await client.restoreSecureBackup(created.backup_id);
            expect(restored.total_keys).toBeGreaterThan(0);
            expect(restored.sessions.length).toBeGreaterThan(0);
            expect(restored.total_keys).toBeGreaterThanOrEqual(restored.sessions.length);

            await client.deleteSecureBackup(created.backup_id);

            await expect(client.getSecureBackup(created.backup_id)).rejects.toThrow();
            backupId = null;
        },
        TestConfig.timeout.long,
    );
});
