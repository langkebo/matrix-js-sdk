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
import { createTestUser, registerTestUser, sleep } from "./auth-test-helpers";
import { syncPromise } from "../../test-utils/test-utils";

/**
 * ISSUE-02 验证方案（L2 real-backend）：
 *
 * 设备 B 初始化 Rust crypto，SDK 自动上传 OTKs（默认 50 个）+ fallback key。
 * 设备 A 通过 /keys/claim 反复 claim B 的 OTK 直到耗尽，
 * 再 claim——若后端 claim SQL 已纳入 fallback key（ISSUE-02 修复），
 * 则返回非空 signed_curve25519 key；若未修复，返回空对象。
 *
 * 策略：不依赖 OTK count 查询（synapse-rust 对空上传不返回计数），
 * 而是利用 OTK 与 fallback key 的核心区别：
 *   - OTK 被 claim 后即消耗，每次 claim 返回不同 key ID
 *   - fallback key 不被消耗，多次 claim 返回同一 key ID
 *
 * 验证步骤：
 * 1. B 注册、初始化加密、startClient + sync（触发 OTK 上传）
 * 2. 轮询 /sync 直到 device_unused_fallback_key_types 包含 signed_curve25519
 *    （SDK 需要第 2 次 sync 才能感知服务端无 fallback key 并上传）
 * 3. B stopClient（冻结服务端 OTK + fallback，防止后续 sync 补传）
 * 4. A 注册
 * 5. A claim 55 次（超过默认 50 个 OTK）
 * 6. 断言最后两次 claim 返回同一非空 key（fallback key 持久性）
 */
describe("ISSUE-02 OTK exhaustion fallback key (real backend)", () => {
    let clientA: MatrixClient | null = null;
    let clientB: MatrixClient | null = null;
    let backendAvailable = false;
    let setupError: unknown;

    let userIdB = "";
    let deviceIdB = "";

    // Rust SDK 默认上传 50 个 OTK，claim 55 次确保耗尽
    const CLAIM_COUNT = 55;

    beforeAll(async () => {
        try {
            // --- B: 注册 + 初始化加密 ---
            const userB = createTestUser("otk_exhaust_b");
            const registeredB = await registerTestUser(userB);

            // 重新创建 client 并传入 pickleKey（ISSUE-08 要求）
            // registerTestUser 不传 pickleKey，但 initRustCrypto 需要
            clientB = createClient({
                baseUrl: TestConfig.baseUrl,
                allowInsecureHttp: true,
                accessToken: registeredB.getAccessToken()!,
                userId: registeredB.getUserId()!,
                deviceId: registeredB.getDeviceId()!,
                pickleKey: `otk_exhaust_b_${Date.now()}`,
            });
            userIdB = clientB.getUserId()!;
            deviceIdB = clientB.getDeviceId()!;

            // 初始化 Rust crypto（内存 store，无 keychain 依赖）
            // SDK 自动上传 device keys + OTKs
            await clientB.initRustCrypto({ useIndexedDB: false, allowInMemoryStore: true } as any);
            clientB.startClient({ initialSyncLimit: 10 });
            // 等待首次 sync（触发 device keys + OTK 上传）
            await syncPromise(clientB, 1);
            // 等待 outgoing requests（OTK 上传）完成
            await sleep(3000);

            // 手动上传 fallback key（Rust SDK 不会自动上传 fallback key，需手动触发）
            // 步骤：
            // 1. 访问 OlmMachine
            // 2. 生成一个随机的 fallback key ID
            // 3. 用 OlmMachine.sign() 对 {"key": "<value>"} 签名
            // 4. 构造 fallback_keys 上传请求
            // 5. 通过 /keys/upload 上传
            const cryptoB = clientB.getCrypto() as any;
            const olmMachine = cryptoB?.olmMachine;
            if (!olmMachine) {
                throw new Error("OlmMachine not accessible — cannot upload fallback key");
            }

            // 生成 fallback key ID（与 OTK key ID 格式一致：base64 编码的序号）
            const fallbackKeyId = "signed_curve25519:AAAAAAAAAAA";
            // 生成一个随机的 32 字节 base64 字符串作为 fallback key 的 "public key"
            // 注意：此 key 仅用于测试 fallback key 的 claim 行为，不需要实际可用
            const randomBytes = new Uint8Array(32);
            crypto.getRandomValues(randomBytes);
            const fallbackPubKey = btoa(String.fromCharCode(...randomBytes));

            // 用 OlmMachine.sign() 对 key 对象签名
            // sign() 返回 Signatures 对象，需用 asJSON() 获取签名 JSON
            const keyObj = { key: fallbackPubKey };
            const signatures: any = await olmMachine.sign(JSON.stringify(keyObj));
            // Signatures 对象的 asJSON() 返回 {"@user:server":{"ed25519:DEVICE_ID":"<sig>"}}
            const sigJsonStr = typeof signatures === "string" ? signatures : signatures.asJSON();
            const sigObj = JSON.parse(sigJsonStr);
            console.log(
                `ISSUE-02 diag: signed fallback key, signatures=${sigJsonStr.substring(0, 100)}...`,
            );

            // 构造完整的 signed_curve25519 fallback key 对象
            const signedFallbackKey = {
                key: fallbackPubKey,
                signatures: sigObj,
            };

            // 构造 fallback key 上传请求
            const fallbackUploadBody = {
                fallback_keys: {
                    [fallbackKeyId]: signedFallbackKey,
                },
            };

            // 通过 /keys/upload 上传 fallback key
            const uploadResp = await clientB.http.authedRequest(
                "POST",
                "/keys/upload",
                undefined,
                fallbackUploadBody,
            );
            console.log(`ISSUE-02 diag: fallback key upload response=${JSON.stringify(uploadResp)}`);

            // 验证 fallback key 已上传：检查 /sync 的 device_unused_fallback_key_types
            await sleep(1000);
            const syncCheckResp = await clientB.http.authedRequest(
                "GET",
                "/sync",
                { timeout: 500, full_state: "false" },
            );
            const fallbackTypes: string[] = syncCheckResp?.device_unused_fallback_key_types ?? [];
            console.log(
                `ISSUE-02 diag: after upload, device_unused_fallback_key_types=${JSON.stringify(fallbackTypes)}`,
            );
            if (!fallbackTypes.includes("signed_curve25519")) {
                throw new Error(
                    `Fallback key upload verification failed: device_unused_fallback_key_types=${JSON.stringify(fallbackTypes)}`,
                );
            }

            // 停止 B 的 client——防止后续 sync 触发更多 OTK 上传
            clientB.stopClient();

            // --- A: 注册 ---
            const userA = createTestUser("otk_exhaust_a");
            clientA = await registerTestUser(userA);

            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, 180_000);

    afterAll(async () => {
        clientA?.stopClient();
        clientB?.stopClient();
        await clientA?.logout?.().catch(() => undefined);
        await clientB?.logout?.().catch(() => undefined);
    });

    it(
        "claim returns fallback key after all OTKs are exhausted",
        async () => {
            if (!backendAvailable) throw new Error(`Backend unavailable: ${String(setupError)}`);

            // A claim B 的 keys 共 CLAIM_COUNT 次
            // 前 50 次消耗 OTK（每次返回不同 key ID），后 5 次返回 fallback key（同一 key ID）
            // 每次 claim 间加 200ms 延迟避免 429 限流
            //
            // 响应结构说明：
            //   one_time_keys.[userId].[deviceId] = {
            //     "signed_curve25519:<keyid>": { key, signatures },  // 有 OTK/fallback
            //     ...（可能多个，但 /keys/claim 每次只返回 1 个）
            //   }
            //   若 OTK 耗尽且无 fallback，则 one_time_keys.[userId].[deviceId] = {}
            const claimedKeyIds: string[] = [];
            for (let i = 0; i < CLAIM_COUNT; i++) {
                let claimResp: any;
                try {
                    claimResp = await clientA!.http.authedRequest(
                        "POST",
                        "/keys/claim",
                        undefined,
                        {
                            one_time_keys: {
                                [userIdB]: { [deviceIdB]: "signed_curve25519" },
                            },
                        },
                    );
                } catch (e: any) {
                    // 429 限流：等待后重试本次 claim
                    if (e?.httpStatus === 429 || e?.errcode === "M_LIMIT_EXCEEDED") {
                        const retryAfter = e?.retryAfterMs ?? 2000;
                        await sleep(Math.max(retryAfter, 1000));
                        i--; // 重试本次，不推进 i
                        continue;
                    }
                    throw e;
                }
                await sleep(200);

                const deviceKeys = claimResp?.one_time_keys?.[userIdB]?.[deviceIdB];
                // key 名格式为 "signed_curve25519:<keyid>"，提取 <keyid>
                const otkKeyNames = deviceKeys
                    ? Object.keys(deviceKeys).filter((k) => k.startsWith("signed_curve25519:"))
                    : [];
                if (otkKeyNames.length > 0) {
                    const keyId = otkKeyNames[0].substring("signed_curve25519:".length);
                    claimedKeyIds.push(keyId);
                } else {
                    // 空 response（OTK 耗尽且无 fallback key）
                    claimedKeyIds.push("");
                }
            }

            console.log(
                `ISSUE-02: claimed ${claimedKeyIds.filter((id) => id).length} non-empty keys out of ${CLAIM_COUNT} claims`,
            );
            console.log(`ISSUE-02: last 6 key IDs = ${claimedKeyIds.slice(-6).join(", ")}`);

            // 断言至少 claim 到了一些 key
            const nonEmptyClaims = claimedKeyIds.filter((id) => id.length > 0);
            expect(nonEmptyClaims.length).toBeGreaterThan(0);

            // ISSUE-02 核心断言：最后两次 claim 应返回同一非空 key（fallback key 持久性）
            // OTK 被消耗后不会重复出现，fallback key 不被消耗会重复返回
            const lastKeyId = claimedKeyIds[CLAIM_COUNT - 1];
            const secondLastKeyId = claimedKeyIds[CLAIM_COUNT - 2];

            expect(lastKeyId.length).toBeGreaterThan(0);
            expect(secondLastKeyId.length).toBeGreaterThan(0);
            expect(lastKeyId).toBe(secondLastKeyId);

            console.log(`ISSUE-02: fallback key ID = ${lastKeyId}`);

            // 统计 fallback key 出现的次数（从后往前数连续相同的 key ID）
            let fallbackRepeats = 1;
            for (let i = CLAIM_COUNT - 2; i >= 0; i--) {
                if (claimedKeyIds[i] === lastKeyId) {
                    fallbackRepeats++;
                } else {
                    break;
                }
            }
            console.log(`ISSUE-02: fallback key repeated ${fallbackRepeats} times at the end`);

            // fallback key 至少重复 2 次（证明它不被消耗）
            expect(fallbackRepeats).toBeGreaterThanOrEqual(2);
        },
        120_000,
    );
});
