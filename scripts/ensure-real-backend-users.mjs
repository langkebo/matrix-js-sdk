const baseUrl = process.env.MATRIX_REAL_BACKEND_BASE_URL ?? "https://matrix.test";

function localpartFromMxid(userId) {
    return userId.replace(/^@/, "").split(":")[0];
}

function getUserConfig(kind) {
    const suffix = kind === "primary" ? "" : "SECONDARY_";
    const defaultUserId = kind === "primary" ? "@sdk_testuser:matrix.test" : "@sdk_testuser2:matrix.test";

    return {
        userId: process.env[`MATRIX_REAL_BACKEND_${suffix}TEST_USER_ID`] ?? defaultUserId,
        password: process.env[`MATRIX_REAL_BACKEND_${suffix}TEST_USER_PASSWORD`] ?? "Test@123",
    };
}

async function parseJson(response) {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return { raw: text };
    }
}

function getRetryAfterMs(body, attempt) {
    const value = body?.retry_after_ms;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
    }

    return 1000 * attempt;
}

async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function matrixRequest(url, init) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        const response = await fetch(url, init);
        const body = await parseJson(response);

        if (response.status !== 429 || attempt === 5) {
            return { ok: response.ok, status: response.status, body };
        }

        await sleep(getRetryAfterMs(body, attempt));
    }

    throw new Error(`Exceeded retry budget for ${url}`);
}

async function login(userId, password) {
    const username = localpartFromMxid(userId);
    return matrixRequest(`${baseUrl}/_matrix/client/v3/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            type: "m.login.password",
            user: username,
            password,
        }),
    });
}

async function checkAvailability(userId) {
    const username = localpartFromMxid(userId);
    return matrixRequest(`${baseUrl}/_matrix/client/v3/register/available?username=${encodeURIComponent(username)}`);
}

async function registerUser(userId, password) {
    const username = localpartFromMxid(userId);
    return matrixRequest(`${baseUrl}/_matrix/client/v3/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            username,
            password,
            auth: { type: "m.login.dummy" },
        }),
    });
}

async function ensureUser(label, userId, password) {
    const loginResult = await login(userId, password);
    if (loginResult.ok) {
        console.log(`[ok] ${label} login: ${userId}`);
        return;
    }

    const availability = await checkAvailability(userId);
    if (!availability.ok) {
        throw new Error(
            `${label} availability check failed (${availability.status}): ${JSON.stringify(availability.body)}`,
        );
    }

    if (availability.body.available !== true) {
        throw new Error(
            `${label} login failed and username is unavailable: ${userId} -> ${JSON.stringify(loginResult.body)}`,
        );
    }

    const registration = await registerUser(userId, password);
    if (!registration.ok) {
        throw new Error(`${label} registration failed (${registration.status}): ${JSON.stringify(registration.body)}`);
    }

    console.log(`[created] ${label}: ${registration.body.user_id}`);
}

async function main() {
    console.log(`Ensuring real-backend users against ${baseUrl}`);

    const primary = getUserConfig("primary");
    const secondary = getUserConfig("secondary");

    await ensureUser("primary", primary.userId, primary.password);
    await ensureUser("secondary", secondary.userId, secondary.password);

    console.log("Real-backend users are ready.");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
