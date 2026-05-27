import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../src/matrix";
import { extendMatrixClient as extendKeyVerificationClient } from "../../../src/key-verification/index";
import { type KeyVerificationManager } from "../../../src/key-verification/index";
import { TestConfig } from "./TestConfig";
import { loginAsConfiguredUser } from "./auth-test-helpers";

extendKeyVerificationClient();

async function waitForVerificationRequest(
    manager: KeyVerificationManager,
    transactionId: string,
): Promise<Awaited<ReturnType<KeyVerificationManager["getVerificationRequests"]>>["requests"][number]> {
    const deadline = Date.now() + TestConfig.timeout.short;

    while (Date.now() < deadline) {
        let response: Awaited<ReturnType<KeyVerificationManager["getVerificationRequests"]>>;
        try {
            response = await manager.getVerificationRequests();
        } catch (error) {
            throw new Error(`Live backend does not expose verification request listing endpoint: ${String(error)}`);
        }
        const match = response.requests.find((request) => request.transaction_id === transactionId);
        if (match) {
            return match;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for verification request ${transactionId}`);
}

async function waitForVerificationRemoval(manager: KeyVerificationManager, transactionId: string): Promise<void> {
    const deadline = Date.now() + TestConfig.timeout.short;

    while (Date.now() < deadline) {
        let response: Awaited<ReturnType<KeyVerificationManager["getVerificationRequests"]>>;
        try {
            response = await manager.getVerificationRequests();
        } catch (error) {
            throw new Error(`Live backend does not expose verification request listing endpoint: ${String(error)}`);
        }
        if (!response.requests.some((request) => request.transaction_id === transactionId)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for verification request removal ${transactionId}`);
}

describe("KeyVerificationManager real backend integration", () => {
    let primaryClient: MatrixClient;
    let secondaryClient: MatrixClient;
    let backendAvailable = false;
    let secondaryUserId: string;
    let setupError: unknown;

    beforeAll(async () => {
        try {
            primaryClient = await loginAsConfiguredUser(TestConfig.testUser);
            secondaryClient = await loginAsConfiguredUser(TestConfig.secondaryUser);
            secondaryUserId = secondaryClient.getSafeUserId();
            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, TestConfig.timeout.long);

    afterAll(async () => {
        await primaryClient?.logout?.().catch(() => undefined);
        await secondaryClient?.logout?.().catch(() => undefined);
    });

    it(
        "should round-trip verification requests and cancellation through backend HTTP routes",
        async () => {
            expect(
                backendAvailable,
                `real backend should be reachable for this integration test: ${String(setupError)}`,
            ).toBe(true);

            const primaryManager = primaryClient.getKeyVerificationManager();
            const secondaryManager = secondaryClient.getKeyVerificationManager();

            const startResponse = await primaryManager.requestVerification(secondaryUserId, ["m.sas.v1"]);
            expect(startResponse.transaction_id).toBeTruthy();
            expect(startResponse.method).toBe("m.sas.v1");

            const pending = await waitForVerificationRequest(secondaryManager, startResponse.transaction_id);
            expect(pending.transaction_id).toBe(startResponse.transaction_id);
            expect(pending.from_user).toBe(primaryClient.getUserId());
            expect(pending.to_user).toBe(secondaryUserId);
            expect(pending.state).toBe("requested");

            const listed = await secondaryManager.getVerificationRequests();
            expect(listed.requests.some((request) => request.transaction_id === startResponse.transaction_id)).toBe(
                true,
            );

            let cancelResponse;
            try {
                cancelResponse = await secondaryManager.cancelKeyVerification(
                    startResponse.transaction_id,
                    "Cancelled by real backend integration test",
                );
            } catch (error) {
                throw new Error(`Live backend does not expose verification cancel endpoint: ${String(error)}`);
            }
            expect(cancelResponse.transaction_id).toBe(startResponse.transaction_id);
            expect(cancelResponse.state).toBe("cancelled");
            expect(cancelResponse.code).toBe("m.user");

            await waitForVerificationRemoval(secondaryManager, startResponse.transaction_id);
        },
        TestConfig.timeout.medium,
    );
});
