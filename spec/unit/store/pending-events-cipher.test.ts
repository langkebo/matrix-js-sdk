import { describe, it, expect } from "vitest";
import { PendingEventsCipher } from "../../../src/store/pending-events-cipher";

describe("ISSUE-08c pending events cipher", () => {
    const sample = [{ type: "m.room.message", content: { body: "secret pending msg" } }];

    async function makeKey(): Promise<CryptoKey> {
        return crypto.subtle.importKey(
            "raw",
            new Uint8Array(32),
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"],
        );
    }

    it("encrypts then decrypts round-trips to original", async () => {
        const cipher = new PendingEventsCipher(await makeKey());
        const blob = await cipher.encryptEvents(sample as any);
        // 密文不含明文
        expect(new TextDecoder().decode(blob)).not.toContain("secret pending msg");
        const back = await cipher.decryptEvents(blob);
        expect(back).toEqual(sample);
    });

    it("refuses to persist (encrypt) without key material", async () => {
        const cipher = new PendingEventsCipher(null);
        await expect(cipher.encryptEvents(sample as any)).rejects.toThrow(/no key material/);
    });

    it("decrypt returns [] without key material (memory-only)", async () => {
        const cipher = new PendingEventsCipher(null);
        await expect(cipher.decryptEvents(new Uint8Array(0))).resolves.toEqual([]);
    });

    it("decrypt returns [] on tampered/corrupt blob (no throw)", async () => {
        const cipher = new PendingEventsCipher(await makeKey());
        const tampered = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 255, 255]);
        await expect(cipher.decryptEvents(tampered)).resolves.toEqual([]);
    });
});
