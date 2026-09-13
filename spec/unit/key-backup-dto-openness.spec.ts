/*
 * ADR-0005 / DTO-1 的类型级断言：生成 DTO 的开放性必须"具名键保留真实类型 + 未知键可扩展"。
 *
 * 这里的关键断言是**编译期**的（`const key: string = info.auth_data.public_key`）—— 由
 * `pnpm lint:types` 强制执行；运行期断言只是让这个文件在 vitest 里有意义。
 *
 * 背景（实测）：改造前 `auth_data: AuthData | Record<string, unknown>` 两处都亏 ——
 *   `info.auth_data.public_key` 推断为 `unknown`（TS2322），而 `info.auth_data.anything`
 *   报 TS2339（并集里 `AuthData` 没有索引签名，开放性没拿到）。见 ADR-0005。
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { AuthData, BackupVersionInfo, EncryptedData, SessionData } from "../../src/key-backup/__generated__/dto";

describe("key-backup 生成 DTO 的开放性（ADR-0005 / DTO-1）", () => {
    it("具名键保留真实类型，不再退化成 unknown", () => {
        const info: BackupVersionInfo = {
            version: "1",
            algorithm: "m.megolm_backup.v1.curve25519-aes-sha2",
            auth_data: { public_key: "curve25519-public-key" },
        };

        // 编译期断言：若 auth_data 仍是 `AuthData | Record<string, unknown>`，这一行会 TS2322
        const publicKey: string = info.auth_data.public_key;
        const signatures: Record<string, Record<string, string>> | undefined = info.auth_data.signatures;

        expect(publicKey).toBe("curve25519-public-key");
        expect(signatures).toBeUndefined();
    });

    it("session_data 的具名键同样是真实类型", () => {
        const session: SessionData = {
            first_message_index: 0,
            forwarded_count: 0,
            is_verified: true,
            session_data: { ciphertext: "c", ephemeral: "e", mac: "m" },
        };

        const ciphertext: string = session.session_data.ciphertext;

        expect(ciphertext).toBe("c");
    });

    it("未知键可读写（算法/实现新增字段不会被类型层拒绝）", () => {
        const authData: AuthData = {
            public_key: "k",
            // 未来算法新增的字段：字面量里带出来必须合法
            future_algorithm_field: "v",
        };
        const encrypted: EncryptedData = { ciphertext: "c", ephemeral: "e", mac: "m" };

        // 索引签名让未知键可读，类型为 unknown（调用方必须自己收窄）
        const unknownRead: unknown = authData.anything_at_all;
        authData.anything_at_all = 123;

        expect(unknownRead).toBeUndefined();
        expect(authData.anything_at_all).toBe(123);
        expect(encrypted.mac).toBe("m");
    });

    it("反面：Record<string, unknown> 不能再冒充 AuthData（形式变更是有意的）", () => {
        const bag: Record<string, unknown> = { public_key: "k" };

        // 并集写法允许这种赋值，代价是具名键全部退化为 unknown。改成索引签名接口后
        // 必须显式说明形状 —— 这正是 ADR-0005 想要的：开放性保留，但不牺牲具名类型。
        // @ts-expect-error Record<string, unknown> 缺少 AuthData 的具名约束，不能直接赋值
        const notAllowed: AuthData = bag;

        expect(notAllowed).toBe(bag);
    });

    it("生成物里不再出现「具名类型 | Record<string, unknown>」并集", () => {
        const dtoPath = path.resolve("src/key-backup/__generated__/dto.ts");
        const content = fs.readFileSync(dtoPath, "utf8");

        expect(content).not.toMatch(/AuthData \| Record<string, unknown>/);
        expect(content).not.toMatch(/EncryptedData \| Record<string, unknown>/);
        // 索引签名必须在（否则开放性又丢了）
        expect(content).toMatch(/\[key: string\]: unknown;/);
    });
});
