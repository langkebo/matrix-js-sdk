import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendE2EEClient } from "../../../src/e2ee/index";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

extendE2EEClient();

describe("Secure backup scoped restore real backend integration", () => {
    let client: MatrixClient;
    let backendAvailable = false;
    let setupError: unknown;
    let backupId = "";

    const roomA = `!recover-scope-a-${Date.now()}:matrix.test`;
    const roomB = `!recover-scope-b-${Date.now()}:matrix.test`;
    // The backend removed passphrase mode: the caller derives the backup key
    // client-side and supplies the algorithm plus the corresponding auth_data.
    const algorithm = "m.megolm_backup.v1.curve25519-aes-sha2";
    const authData = { public_key: `scoped-restore-backup-key-${Date.now()}` };

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

            const created = await client.createSecureBackup({ algorithm, auth_data: authData });
            backupId = created.backup_id;

            const storeResult = await client.storeSecureBackupKeys(backupId, [
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

            const recovered = await client.getE2EEManager().restoreSecureBackup(backupId, {
                rooms: [roomA],
            });
            expect(recovered.total_keys).toBe(2);
            expect(recovered.sessions).toHaveLength(1);
            expect(recovered.sessions[0].room_id).toBe(roomA);
        },
        TestConfig.timeout.long,
    );
});
