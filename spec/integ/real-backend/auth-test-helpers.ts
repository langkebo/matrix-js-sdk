/// <reference lib="es2015" />
import { createHmac } from "node:crypto";
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

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode a base32 (RFC 4648, no padding required) secret into raw bytes. */
function base32Decode(secret: string): Buffer {
    const normalized = secret.replace(/[\s=]/g, "").toUpperCase();
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (const char of normalized) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index === -1) {
            throw new Error(`Invalid base32 character in TOTP secret: ${char}`);
        }

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}

/**
 * Generate a 6-digit TOTP (RFC 6238, HMAC-SHA1, 30s step) for the given base32 secret.
 * Used to satisfy the deployment stack's `admin_mfa_required` login challenge.
 */
export function generateTotp(secret: string, timestampMs: number = Date.now(), stepSeconds = 30, digits = 6): string {
    const counter = Math.floor(timestampMs / 1000 / stepSeconds);
    const counterBuffer = Buffer.alloc(8);
    const high = Math.floor(counter / 0x100000000);
    const low = counter - high * 0x100000000;
    counterBuffer.writeUInt32BE(high >>> 0, 0);
    counterBuffer.writeUInt32BE(low >>> 0, 4);

    const hmac = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

    return (binary % 10 ** digits).toString().padStart(digits, "0");
}

export async function loginAsConfiguredUser(
    user: { userId: string; password: string; deviceId?: string; mfaSecret?: string } = TestConfig.testUser,
): Promise<MatrixClient> {
    const client = createClient({
        baseUrl: TestConfig.baseUrl,
        allowInsecureHttp: true,
        deviceId: user.deviceId,
    });
    const username = localpartFromMxid(user.userId);

    const result = await withRateLimitRetry(async () => {
        // Regenerate the TOTP inside the retry closure so a retried attempt never
        // replays an expired code.
        const mfaCode = user.mfaSecret ? generateTotp(user.mfaSecret) : undefined;
        return await client.loginRequest({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: username },
            password: user.password,
            device_id: user.deviceId,
            ...(mfaCode ? { mfa_code: mfaCode } : {}),
        });
    });

    client.setAccessToken(result.access_token);
    // loginRequest is a low-level HTTP wrapper that does not populate credentials.
    // Set userId explicitly so client.getUserId() works in downstream tests.
    client.credentials.userId = result.user_id;
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
