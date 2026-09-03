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

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createClient, type MatrixClient } from "../../../src/matrix";
import { TestConfig } from "./TestConfig";
import { createTestUser, withRateLimitRetry } from "./auth-test-helpers";

/**
 * ISSUE-05 验证方案（L2 real-backend）：
 *
 * 后端 /login、/register、/refresh 响应携带 `expires_in`（秒，OAuth2 习惯），
 * 而 SDK 类型契约是 `expires_in_ms`（毫秒）。此前类型注释声称"SDK自动转换"
 * 但全库无转换点——应用层按契约读 `expires_in_ms` 只能得到 undefined。
 *
 * 修复后（`src/auth/normalize-expires.ts`）在响应边界做显式归一化：
 * 缺失 `expires_in_ms` 且存在数值型 `expires_in` 时，按秒→毫秒换算补齐。
 *
 * 验证步骤：
 * 1. register：断言响应含 expires_in_ms 且 === expires_in * 1000
 * 2. login：断言响应含 expires_in_ms 且 === expires_in * 1000
 * 3. refresh：断言响应含 expires_in_ms 且 === expires_in * 1000
 *
 * 注意：后端必须启用 refresh_token 配置才会返回 expires_in 字段。
 * 若后端未返回 expires_in，测试将跳过（标记为预期行为）。
 */
describe("ISSUE-05 login expires_in mapping (real backend)", () => {
    let client: MatrixClient | null = null;
    let backendAvailable = false;
    let setupError: unknown;

    let registeredUser: { localpart: string; password: string };
    let registerResponse: { expires_in?: number; expires_in_ms?: number } | null = null;
    let loginRefreshToken: string | null = null;

    beforeAll(async () => {
        try {
            registeredUser = createTestUser("expires_map");
            // registerTestUser 返回已配置 accessToken/userId 的 MatrixClient
            // 我们需要原始响应，所以直接用 registrationClient
            const registrationClient = createClient({
                baseUrl: TestConfig.baseUrl,
                allowInsecureHttp: true,
            });

            const rawRegisterResp = await withRateLimitRetry(async () => {
                return await registrationClient.registerRequest({
                    username: registeredUser.localpart,
                    password: registeredUser.password,
                    auth: { type: "m.login.dummy" },
                });
            });
            registerResponse = rawRegisterResp as { expires_in?: number; expires_in_ms?: number };

            // 用注册返回的 token 创建 client 用于后续 login/refresh 测试
            client = createClient({
                baseUrl: TestConfig.baseUrl,
                allowInsecureHttp: true,
            });

            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, 60_000);

    afterAll(async () => {
        client?.stopClient();
        await client?.logout?.().catch(() => undefined);
    });

    it("register response normalizes expires_in to expires_in_ms", async () => {
        if (!backendAvailable) throw new Error(`Backend unavailable: ${String(setupError)}`);
        if (!registerResponse) throw new Error("registerResponse is null");

        console.log(
            `ISSUE-05: register response expires_in=${registerResponse.expires_in}, ` +
                `expires_in_ms=${registerResponse.expires_in_ms}`,
        );

        // 后端可能不返回 expires_in（未启用 refresh_token）——此场景下跳过
        if (registerResponse.expires_in === undefined && registerResponse.expires_in_ms === undefined) {
            console.log("ISSUE-05: backend did not return expires_in, skipping (refresh_token disabled)");
            return;
        }

        // 核心断言：expires_in_ms 存在且 === expires_in * 1000
        expect(registerResponse.expires_in).toBeDefined();
        expect(registerResponse.expires_in_ms).toBeDefined();
        expect(registerResponse.expires_in_ms).toBe(registerResponse.expires_in! * 1000);
    }, 30_000);

    it("login response normalizes expires_in to expires_in_ms", async () => {
        if (!backendAvailable) throw new Error(`Backend unavailable: ${String(setupError)}`);

        const loginResp = await withRateLimitRetry(async () => {
            return await client!.loginRequest({
                type: "m.login.password",
                identifier: { type: "m.id.user", user: registeredUser.localpart },
                password: registeredUser.password,
            });
        });
        const login = loginResp as { expires_in?: number; expires_in_ms?: number; refresh_token?: string };

        console.log(
            `ISSUE-05: login response expires_in=${login.expires_in}, ` + `expires_in_ms=${login.expires_in_ms}`,
        );

        // 后端可能不返回 expires_in——此场景下跳过
        if (login.expires_in === undefined && login.expires_in_ms === undefined) {
            console.log("ISSUE-05: backend did not return expires_in, skipping (refresh_token disabled)");
            return;
        }

        // 核心断言：expires_in_ms 存在且 === expires_in * 1000
        expect(login.expires_in).toBeDefined();
        expect(login.expires_in_ms).toBeDefined();
        expect(login.expires_in_ms).toBe(login.expires_in! * 1000);

        // 设置 token 用于 refresh 测试
        client!.setAccessToken((loginResp as { access_token: string }).access_token);
        loginRefreshToken = login.refresh_token ?? null;
    }, 30_000);

    it("refresh response normalizes expires_in to expires_in_ms", async () => {
        if (!backendAvailable) throw new Error(`Backend unavailable: ${String(setupError)}`);

        // 需要 refresh_token 才能测试 refresh
        if (!loginRefreshToken) {
            console.log("ISSUE-05: no refresh_token available, skipping refresh test");
            return;
        }

        try {
            const refreshResp = await withRateLimitRetry(async () => {
                return await client!.refreshToken(loginRefreshToken!);
            });
            const refresh = refreshResp as { expires_in?: number; expires_in_ms?: number };

            console.log(
                `ISSUE-05: refresh response expires_in=${refresh.expires_in}, ` +
                    `expires_in_ms=${refresh.expires_in_ms}`,
            );

            // 后端可能不返回 expires_in——此场景下跳过
            if (refresh.expires_in === undefined && refresh.expires_in_ms === undefined) {
                console.log("ISSUE-05: backend did not return expires_in on refresh, skipping");
                return;
            }

            // 核心断言：expires_in_ms 存在且 === expires_in * 1000
            expect(refresh.expires_in).toBeDefined();
            expect(refresh.expires_in_ms).toBeDefined();
            expect(refresh.expires_in_ms).toBe(refresh.expires_in! * 1000);
        } catch (error) {
            // 后端可能不支持 /refresh（返回 M_UNRECOGNIZED）——此场景下跳过
            const errcode = (error as { errcode?: string }).errcode;
            if (errcode === "M_UNRECOGNIZED" || errcode === "M_UNKNOWN") {
                console.log(`ISSUE-05: refresh not supported (${errcode}), skipping`);
                return;
            }
            throw error;
        }
    }, 30_000);
});
