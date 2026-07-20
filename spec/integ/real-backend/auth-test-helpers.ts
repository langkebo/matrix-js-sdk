/// <reference lib="es2015" />
import { createClient, type MatrixClient } from "../../../src/matrix";
import { TestConfig } from "./TestConfig";

export type TestUserConfig = {
    localpart: string;
    password: string;
};

let nextAuthAllowedAt = 0;

export function localpartFromMxid(userId: string): string {
    return userId.replace("@", "").split(":")[0];
}

export function createTestUser(localpartPrefix: string): TestUserConfig {
    return {
        localpart: `${localpartPrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        password: "Test@123",
    };
}

function getErrorCandidates(error: unknown): unknown[] {
    const candidates: unknown[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;

    while (current !== undefined && !seen.has(current)) {
        candidates.push(current);
        seen.add(current);

        if (!current || typeof current !== "object" || !("cause" in current)) {
            break;
        }

        current = (current as { cause?: unknown }).cause;
    }

    return candidates;
}

function isRateLimited(error: unknown): boolean {
    return getErrorCandidates(error).some((candidate) => {
        if (!candidate || typeof candidate !== "object") {
            return typeof candidate === "string" && (candidate.includes("429") || candidate.includes("Rate limited"));
        }

        const record = candidate as Record<string, unknown>;
        const message = typeof record.message === "string" ? record.message : "";
        const retryAfter = typeof record.retryAfter === "number" ? record.retryAfter : undefined;
        return (
            record.statusCode === 429 ||
            record.httpStatus === 429 ||
            (record.isRetryable === true && retryAfter !== undefined) ||
            record.errorCode === "M_LIMIT_EXCEEDED" ||
            record.errcode === "M_LIMIT_EXCEEDED" ||
            message.includes("429") ||
            message.includes("Rate limited")
        );
    });
}

function isTransientConnectionError(error: unknown): boolean {
    return getErrorCandidates(error).some((candidate) => {
        if (!candidate || typeof candidate !== "object") {
            return typeof candidate === "string" && candidate.includes("fetch failed");
        }

        const record = candidate as Record<string, unknown>;
        const message = typeof record.message === "string" ? record.message : "";
        const code = typeof record.code === "string" ? record.code : "";

        return (
            (record.isRetryable === true && message.includes("fetch failed")) ||
            record.statusCode === 0 ||
            record.httpStatus === 0 ||
            code === "ECONNRESET" ||
            code === "ECONNREFUSED" ||
            code === "ETIMEDOUT" ||
            code === "ENOTFOUND" ||
            message.includes("fetch failed") ||
            message.includes("network error")
        );
    });
}

function getRetryAfterMs(error: unknown, fallbackMs: number): number {
    for (const candidate of getErrorCandidates(error)) {
        if (!candidate || typeof candidate !== "object") {
            continue;
        }

        const record = candidate as Record<string, unknown>;
        if (typeof record.retryAfter === "number" && isFinite(record.retryAfter) && record.retryAfter > 0) {
            return record.retryAfter;
        }

        const getRetryAfter = record.getRetryAfterMs;
        if (typeof getRetryAfter === "function") {
            const value = getRetryAfter.call(candidate);
            if (typeof value === "number" && isFinite(value) && value > 0) {
                return value;
            }
        }

        if (record.data && typeof record.data === "object") {
            const retryAfterMs = (record.data as Record<string, unknown>).retry_after_ms;
            if (typeof retryAfterMs === "number" && isFinite(retryAfterMs) && retryAfterMs > 0) {
                return retryAfterMs;
            }
        }
    }

    return fallbackMs;
}

export async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAuthWindow(): Promise<void> {
    const delay = nextAuthAllowedAt - Date.now();
    if (delay > 0) {
        await sleep(delay);
    }
}

export async function withRateLimitRetry<T>(operation: () => Promise<T>, maxAttempts = 6): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await waitForAuthWindow();
            const result = await operation();
            nextAuthAllowedAt = Date.now() + 1500;
            return result;
        } catch (error) {
            const retryable = isRateLimited(error) || isTransientConnectionError(error);
            if (!retryable || attempt === maxAttempts) {
                throw error;
            }

            const retryDelay = Math.max(getRetryAfterMs(error, 1500 * attempt), 1500);
            nextAuthAllowedAt = Date.now() + retryDelay;
            await sleep(retryDelay);
        }
    }

    throw new Error("Failed after retry budget was exhausted.");
}

export async function loginAsConfiguredUser(
    user: { userId: string; password: string; deviceId?: string } = TestConfig.testUser,
): Promise<MatrixClient> {
    const client = createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
        deviceId: user.deviceId,
    });
    const username = localpartFromMxid(user.userId);

    const result = await withRateLimitRetry(async () => {
        return await client.loginRequest({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: username },
            password: user.password,
            device_id: user.deviceId,
        });
    });

    client.setAccessToken(result.access_token);
    return client;
}

export async function registerTestUser(user: TestUserConfig): Promise<MatrixClient> {
    const registrationClient = createClient({ baseUrl: TestConfig.baseUrl, allowInsecureHttp: true });

    const result = await withRateLimitRetry(async () => {
        return await registrationClient.registerRequest({
            username: user.localpart,
            password: user.password,
            auth: { type: "m.login.dummy" },
        });
    });

    return createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
        accessToken: result.access_token,
        userId: result.user_id,
        deviceId: result.device_id,
    });
}
