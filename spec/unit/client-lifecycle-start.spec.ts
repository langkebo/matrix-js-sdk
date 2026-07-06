import { describe, expect, it, vi } from "vitest";

import { buildSyncApiOptions, detectServerCapabilities } from "../../src/client-lifecycle-start";

describe("client-lifecycle-start", () => {
    describe("buildSyncApiOptions", () => {
        it("builds sync options with cryptoCallbacks from client", () => {
            const mockCrypto = {};
            const client = {
                cryptoBackend: mockCrypto,
                canResetTimelineCallback: undefined,
                logger: { getChild: vi.fn().mockReturnValue({}) },
            };

            const opts = buildSyncApiOptions(client as any);
            expect(opts.cryptoCallbacks).toBe(mockCrypto);
            expect(typeof opts.canResetEntireTimeline).toBe("function");
        });

        it("canResetEntireTimeline returns false when no callback set", () => {
            const client = {
                cryptoBackend: undefined,
                canResetTimelineCallback: undefined,
                logger: { getChild: vi.fn().mockReturnValue({}) },
            };

            const opts = buildSyncApiOptions(client as any);
            expect(opts.canResetEntireTimeline!("!room:example.org")).toBe(false);
        });

        it("canResetEntireTimeline delegates to callback when set", () => {
            const cb = vi.fn().mockReturnValue(true);
            const client = {
                cryptoBackend: undefined,
                canResetTimelineCallback: cb,
                logger: { getChild: vi.fn().mockReturnValue({}) },
            };

            const opts = buildSyncApiOptions(client as any);
            expect(opts.canResetEntireTimeline!("!room:example.org")).toBe(true);
            expect(cb).toHaveBeenCalledWith("!room:example.org");
        });
    });

    describe("detectServerCapabilities", () => {
        it("detects thread support from server and applies to Thread", async () => {
            const client = {
                getVersions: vi.fn().mockResolvedValue({}),
                doesServerSupportThread: vi.fn().mockResolvedValue({
                    threads: true,
                    list: true,
                    fwdPagination: false,
                }),
                logger: { error: vi.fn() },
            };

            // We can't easily test Thread.setServerSideSupport side effects
            // without importing Thread, but we verify the flow completes
            await expect(detectServerCapabilities(client as any)).resolves.toBeUndefined();
            expect(client.getVersions).toHaveBeenCalled();
            expect(client.doesServerSupportThread).toHaveBeenCalled();
        });

        it("logs error and continues when server version check fails", async () => {
            const client = {
                getVersions: vi.fn().mockRejectedValue(new Error("Network error")),
                doesServerSupportThread: vi.fn(),
                logger: { error: vi.fn() },
            };

            await expect(detectServerCapabilities(client as any)).resolves.toBeUndefined();
            expect(client.logger.error).toHaveBeenCalled();
            expect(client.doesServerSupportThread).not.toHaveBeenCalled();
        });
    });
});
