import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIModule } from "../../../src/ai/index";
import { logger } from "../../../src/logger";

describe("ISSUE-09b AI setEndpoint security warning", () => {
    beforeEach(() => {
        vi.spyOn(logger, "warn").mockImplementation(() => {});
    });

    it("sets https endpoint without warning", () => {
        const ai = new AIModule();
        ai.setEndpoint("https://ai.example.org/mcp");
        expect(ai.getEndpoint()).toBe("https://ai.example.org/mcp");
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("sets localhost http endpoint without warning (local MCP)", () => {
        const ai = new AIModule();
        ai.setEndpoint("http://127.0.0.1:3333/mcp");
        expect(ai.getEndpoint()).toBe("http://127.0.0.1:3333/mcp");
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("rejects non-localhost http endpoint", () => {
        const ai = new AIModule();
        expect(() => ai.setEndpoint("http://external.evil.com/mcp")).toThrow(
            /refusing to use non-https/i,
        );
    });

    it("rejects unsupported protocol", () => {
        const ai = new AIModule();
        expect(() => ai.setEndpoint("ftp://example.org/mcp")).toThrow(
            /unsupported/i,
        );
    });

    it("rejects invalid URL", () => {
        const ai = new AIModule();
        expect(() => ai.setEndpoint("not-a-url")).toThrow(/invalid/i);
    });
});
