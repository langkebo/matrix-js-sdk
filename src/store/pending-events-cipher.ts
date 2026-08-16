import { logger } from "../logger";
import type { IEvent } from "../models/event";

/**
 * ISSUE-08c: 待发事件队列落盘前 AES-GCM 加密。
 * 无 key 时拒绝持久化（仅内存），防止明文待发消息泄露。
 */
export class PendingEventsCipher {
    public constructor(private readonly key: CryptoKey | null) {}

    /**
     * 从 32 字节 storageKey 直接派生 AES-GCM CryptoKey（推荐路径）。
     * storageKey 与 crypto store 的 `storageKey` 同一来源（系统 keychain），
     * 保证待发事件队列与密钥库用同一份密钥材料。
     */
    public static async fromStorageKey(storageKey: Uint8Array): Promise<PendingEventsCipher> {
        if (storageKey.length !== 32) {
            throw new Error(`PendingEventsCipher storageKey must be exactly 32 bytes, got ${storageKey.length}`);
        }
        const key = await globalThis.crypto.subtle.importKey(
            "raw",
            storageKey as BufferSource,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"],
        );
        return new PendingEventsCipher(key);
    }

    /**
     * 从口令派生 AES-GCM CryptoKey（备选路径，慢）。
     * salt 由调用方提供（应与 crypto store 的派生盐一致以保证跨会话可复现）。
     */
    public static async fromPassword(
        password: string,
        salt: Uint8Array,
        iterations: number,
    ): Promise<PendingEventsCipher> {
        const baseKey = await globalThis.crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveBits"],
        );
        const bits = await globalThis.crypto.subtle.deriveBits(
            { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-512" },
            baseKey,
            256,
        );
        return PendingEventsCipher.fromStorageKey(new Uint8Array(bits));
    }

    public async encryptEvents(events: Partial<IEvent>[]): Promise<Uint8Array> {
        if (!this.key) {
            throw new Error("Cannot persist pending events: no key material (storagePassword) provided");
        }
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plaintext = new TextEncoder().encode(JSON.stringify(events));
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, plaintext));
        // 拼接 iv || ciphertext
        const out = new Uint8Array(iv.length + ciphertext.length);
        out.set(iv, 0);
        out.set(ciphertext, iv.length);
        return out;
    }

    public async decryptEvents(blob: Uint8Array): Promise<Partial<IEvent>[]> {
        if (!this.key) return [];
        const iv = blob.slice(0, 12);
        const ciphertext = blob.slice(12);
        try {
            const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, this.key, ciphertext);
            return JSON.parse(new TextDecoder().decode(plaintext));
        } catch (err) {
            logger.warn("Failed to decrypt pending events blob, treating as empty", err);
            return [];
        }
    }
}
