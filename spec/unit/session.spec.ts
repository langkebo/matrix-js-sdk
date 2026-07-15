import { describe, it, expect, beforeEach, vi } from "vitest";

import { SessionManager } from "../../src/session/index";

describe("SessionManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let sessionManager: SessionManager;

    beforeEach(() => {
        mockClient = {
            logout: vi.fn().mockResolvedValue({}),
            deactivateAccount: vi.fn().mockResolvedValue({ id_server_unbind_result: "success" }),
            getAccessToken: vi.fn().mockReturnValue("test-token"),
            credentials: { userId: "@test:example.com" },
            getSessionId: vi.fn().mockReturnValue("session-123"),
            whoami: vi.fn().mockResolvedValue({ user_id: "@test:example.com" }),
        };
        sessionManager = new SessionManager(mockClient);
    });

    describe("constructor", () => {
        it("should initialize correctly", () => {
            expect(sessionManager).toBeDefined();
        });
    });

    describe("logout", () => {
        it("should call client.logout with default parameter", async () => {
            await sessionManager.logout();
            expect(mockClient.logout).toHaveBeenCalledWith(false);
        });

        it("should call client.logout with stopClient=true", async () => {
            await sessionManager.logout(true);
            expect(mockClient.logout).toHaveBeenCalledWith(true);
        });

        it("should return the result from client.logout", async () => {
            const result = await sessionManager.logout();
            expect(result).toEqual({});
        });
    });

    describe("deactivateAccount", () => {
        it("should call client.deactivateAccount", async () => {
            await sessionManager.deactivateAccount();
            expect(mockClient.deactivateAccount).toHaveBeenCalled();
        });

        it("should return the result from client.deactivateAccount", async () => {
            const result = await sessionManager.deactivateAccount();
            expect(result).toEqual({ id_server_unbind_result: "success" });
        });
    });

    describe("getAccessToken", () => {
        it("should return the access token from client", () => {
            const token = sessionManager.getAccessToken();
            expect(token).toBe("test-token");
        });

        it("should return null when no token", () => {
            mockClient.getAccessToken.mockReturnValue(null);
            const token = sessionManager.getAccessToken();
            expect(token).toBeNull();
        });
    });

    describe("isLoggedIn", () => {
        it("should return true when user has userId and token", () => {
            const result = sessionManager.isLoggedIn();
            expect(result).toBe(true);
        });

        it("should return false when no userId", () => {
            mockClient.credentials.userId = null;
            const result = sessionManager.isLoggedIn();
            expect(result).toBe(false);
        });

        it("should return false when no token", () => {
            mockClient.getAccessToken.mockReturnValue(null);
            const result = sessionManager.isLoggedIn();
            expect(result).toBe(false);
        });
    });

    describe("getSessionId", () => {
        it("should return the session ID from client", () => {
            const sessionId = sessionManager.getSessionId();
            expect(sessionId).toBe("session-123");
        });

        it("should return null when no session ID", () => {
            mockClient.getSessionId.mockReturnValue(null);
            const sessionId = sessionManager.getSessionId();
            expect(sessionId).toBeNull();
        });
    });

    describe("whoami", () => {
        it("should call client.whoami", async () => {
            await sessionManager.whoami();
            expect(mockClient.whoami).toHaveBeenCalled();
        });

        it("should return the result from client.whoami", async () => {
            const result = await sessionManager.whoami();
            expect(result).toEqual({ user_id: "@test:example.com" });
        });
    });
});
