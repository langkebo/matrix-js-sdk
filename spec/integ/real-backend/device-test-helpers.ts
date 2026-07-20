// @ts-nocheck
import { createClient, type MatrixClient } from "../../../src/matrix";
import { TestConfig } from "./TestConfig";
import { localpartFromMxid, withRateLimitRetry } from "./auth-test-helpers";

function getErrorCandidates(error: unknown): unknown[] {
    const candidates = [error];
    if (error && typeof error === "object" && "cause" in error) {
        candidates.push((error as { cause?: unknown }).cause);
    }
    return candidates;
}

function isUnauthorized(error: unknown): boolean {
    return getErrorCandidates(error).some((candidate) => {
        if (!candidate || typeof candidate !== "object") {
            return false;
        }

        const record = candidate as Record<string, unknown>;
        return (
            record.statusCode === 401 ||
            record.httpStatus === 401 ||
            record.errorCode === "M_UNAUTHORIZED" ||
            record.errcode === "M_UNAUTHORIZED"
        );
    });
}

export async function loginWithDevice(deviceId: string): Promise<{ client: MatrixClient; userId: string }> {
    const client = createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
        deviceId,
    });

    const username = localpartFromMxid(TestConfig.testUser.userId);
    const result = await withRateLimitRetry(async () => {
        return await client.loginRequest({
            type: "m.login.password",
            user: username,
            password: TestConfig.testUser.password,
            device_id: deviceId,
        });
    });

    client.setAccessToken(result.access_token);

    return {
        client,
        userId: result.user_id,
    };
}

export async function safeLogout(client: MatrixClient | null): Promise<void> {
    if (!client) {
        return;
    }

    try {
        await client.logout();
    } catch (error) {
        if (!isUnauthorized(error)) {
            throw error;
        }
    }
}
