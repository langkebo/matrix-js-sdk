import { describe, it, expect, vi, beforeEach } from "vitest";

// 模拟 ISSUE-08b 门禁 + RustCrypto 最小 stub（不引入真实 wasm）。
// storePrefix 为 null 且未显式 allowInMemoryStore 时抛错，以便端到端验证
// MatrixClient.initRustCrypto 的转发行为是否符合生产安全意图。
vi.mock("../../src/rust-crypto/index", () => ({
    initRustCrypto: vi.fn(async (args: { storePrefix: string | null; allowInMemoryStore?: boolean }) => {
        if (args.storePrefix === null && !args.allowInMemoryStore) {
            throw new Error(
                "Refusing to open unencrypted in-memory crypto store; provide storeKey/storePassphrase " +
                    "(derived from system keychain) or explicitly set allowInMemoryStore for tests.",
            );
        }
        return {
            setSupportedVerificationMethods: vi.fn(),
            // RustCrypto 最小 stub，供 client 装配（client.ts:1358-1387 调用路径）
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn(),
            stop: vi.fn(),
            onRoomMembership: vi.fn(),
            onLiveEventFromSync: vi.fn(),
        };
    }),
}));

describe("ISSUE-08b A1b: MatrixClient.initRustCrypto forwards allowInMemoryStore", () => {
    beforeEach(() => vi.clearAllMocks());

    it("forwards allowInMemoryStore: true to initRustCrypto when useIndexedDB:false", async () => {
        const { initRustCrypto } = await import("../../src/rust-crypto/index");
        const { createClient } = await import("../../src/matrix");
        // pickleKey 用于通过 ISSUE-08 legacy-store 门禁（client.ts:1330），不影响被测字段
        const client = createClient({
            baseUrl: "https://x.org",
            userId: "@a:b",
            deviceId: "DEV",
            pickleKey: "test-pickle-key",
        });
        await client.initRustCrypto({ useIndexedDB: false, allowInMemoryStore: true });
        expect(initRustCrypto).toHaveBeenCalledWith(
            expect.objectContaining({ allowInMemoryStore: true, storePrefix: null }),
        );
    });

    it("does NOT auto-imply allowInMemoryStore when useIndexedDB:false without explicit opt-in", async () => {
        const { initRustCrypto } = await import("../../src/rust-crypto/index");
        const { createClient } = await import("../../src/matrix");
        const client = createClient({
            baseUrl: "https://x.org",
            userId: "@a:b",
            deviceId: "DEV",
            pickleKey: "test-pickle-key",
        });
        // 不显式 allowInMemoryStore：转发 undefined，让底层门禁抛错（生产安全）
        await expect(client.initRustCrypto({ useIndexedDB: false })).rejects.toThrow(
            /unencrypted in-memory crypto store/,
        );
        expect(initRustCrypto).toHaveBeenCalledWith(expect.objectContaining({ allowInMemoryStore: undefined }));
    });
});
