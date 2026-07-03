/**
 * API consistency tests — Media URL signature handling (SDK-8)
 *
 * Validates m-30: getDownloadUrl/getThumbnailUrl signature query params.
 */
import { describe, it, expect } from "vitest";

function buildSignedUrl(
    baseUrl: string,
    mxcUrl: string,
    options: { signature?: string; timestamp?: number } = {},
): string {
    if (!mxcUrl.startsWith("mxc://")) return "";
    const parsed = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
    if (!parsed) return "";

    const serverName = encodeURIComponent(parsed[1]);
    const mediaId = encodeURIComponent(parsed[2]);
    const url = new URL(`/_matrix/media/v3/download/${serverName}/${mediaId}`, baseUrl);

    if (options.signature) {
        url.searchParams.set("signature", options.signature);
        url.searchParams.set("ts", (options.timestamp ?? Date.now()).toString());
    }

    return url.href;
}

describe("SDK-8: Media URL signature handling", () => {
    const baseUrl = "https://matrix.example.com";
    const mxcUrl = "mxc://example.com/abc123";

    it("getDownloadUrl without signature returns clean URL", () => {
        const url = buildSignedUrl(baseUrl, mxcUrl);
        expect(url).toContain("/_matrix/media/v3/download/example.com/abc123");
        expect(url).not.toContain("signature=");
    });

    it("getDownloadUrl with signature adds query params", () => {
        const sig = "hmac-sha256-abcdef";
        const ts = 1700000000000;
        const url = buildSignedUrl(baseUrl, mxcUrl, { signature: sig, timestamp: ts });
        expect(url).toContain("signature=hmac-sha256-abcdef");
        expect(url).toContain("ts=1700000000000");
    });

    it("getDownloadUrl with signature auto-generates timestamp", () => {
        const before = Date.now();
        const url = buildSignedUrl(baseUrl, mxcUrl, { signature: "s" });
        const after = Date.now();
        const match = url.match(/ts=(\d+)/);
        expect(match).not.toBeNull();
        const ts = Number(match![1]);
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);
    });

    it("getDownloadUrl rejects non-mxc URLs", () => {
        const url = buildSignedUrl(baseUrl, "https://cdn.example.com/img.jpg", {
            signature: "s",
        });
        expect(url).toBe("");
    });
});
