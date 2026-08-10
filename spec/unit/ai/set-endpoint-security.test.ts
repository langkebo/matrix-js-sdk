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

    it("warns but still sets non-localhost http endpoint", () => {
        const ai = new AIModule();
        ai.setEndpoint("http://external.evil.com/mcp");
        expect(ai.getEndpoint()).toBe("http://external.evil.com/mcp");
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/insecure/i),
            expect.anything(),
        );
    });

    it("warns on unsupported protocol but still sets", () => {
        const ai = new AIModule();
        ai.setEndpoint("ftp://example.org/mcp");
        expect(ai.getEndpoint()).toBe("ftp://example.org/mcp");
        expect(logger.warn).toHaveBeenCalled();
    });
});
