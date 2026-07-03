/**
 * API consistency tests — Federation Canonical JSON (SDK-11)
 *
 * Validates C-2 alignment: toCanonicalJson escapes U+2028/U+2029/U+FFFD.
 */
import { describe, it, expect } from "vitest";

function toCanonicalJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029")
        .replace(/\ufffd/g, "\\ufffd");
}

describe("SDK-11: Federation Canonical JSON alignment", () => {
    describe("U+2028 LINE SEPARATOR", () => {
        it("escapes U+2028 to \\u2028", () => {
            const input = { key: "hello\u2028world" };
            const json = toCanonicalJson(input);
            expect(json).not.toContain("\u2028");
            expect(json).toContain("\\u2028");
        });
    });

    describe("U+2029 PARAGRAPH SEPARATOR", () => {
        it("escapes U+2029 to \\u2029", () => {
            const input = { key: "hello\u2029world" };
            const json = toCanonicalJson(input);
            expect(json).not.toContain("\u2029");
            expect(json).toContain("\\u2029");
        });
    });

    describe("U+FFFD REPLACEMENT CHARACTER", () => {
        it("escapes U+FFFD to \\ufffd", () => {
            const input = { key: "bad\ufffdchar" };
            const json = toCanonicalJson(input);
            expect(json).not.toContain("\ufffd");
            expect(json).toContain("\\ufffd");
        });
    });

    describe("Normal strings unchanged", () => {
        it("leaves ASCII-only strings intact", () => {
            const input = { key: "hello world", num: 42 };
            const json = toCanonicalJson(input);
            const parsed = JSON.parse(json);
            expect(parsed.key).toBe("hello world");
            expect(parsed.num).toBe(42);
        });

        it("leaves CJK characters intact", () => {
            const input = { key: "你好世界" };
            const json = toCanonicalJson(input);
            const parsed = JSON.parse(json);
            expect(parsed.key).toBe("你好世界");
        });
    });

    describe("Combined special characters", () => {
        it("handles mixed special and normal text", () => {
            const input = {
                body: "msg",
                content: "start\u2028mid\u2029end",
            };
            const json = toCanonicalJson(input);
            expect(json).toContain("\\u2028");
            expect(json).toContain("\\u2029");
            expect(json).toContain('"msg"');
        });
    });

    describe("Round-trip safety", () => {
        it("escaped JSON parses back to original values", () => {
            const lineSep = "\u2028";
            const paraSep = "\u2029";
            const replChar = "\ufffd";
            const input = {
                body: "a" + lineSep + "b" + paraSep + "c" + replChar + "d",
            };
            const json = toCanonicalJson(input);
            const parsed = JSON.parse(json);
            expect(parsed.body).toBe(input.body);
        });
    });
});
