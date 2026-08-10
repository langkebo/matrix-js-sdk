import { logger } from "../logger";
import type { IEvent } from "../models/event";

/**
 * ISSUE-08c: 待发事件队列落盘前 AES-GCM 加密。
 * 无 key 时拒绝持久化（仅内存），防止明文待发消息泄露。
 */
export class PendingEventsCipher {
    public constructor(private readonly key: CryptoKey | null) {}

    public async encryptEvents(events: Partial<IEvent>[]): Promise<Uint8Array> {
        if (!this.key) {
            throw new Error("Cannot persist pending events: no key material (storagePassword) provided");
        }
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plaintext = new TextEncoder().encode(JSON.stringify(events));
        const ciphertext = new Uint8Array(
            await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, plaintext),
        );
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
