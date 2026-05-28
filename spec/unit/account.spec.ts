import { describe, it, expect, beforeEach, vi } from "vitest";

import { AccountManager } from "../../src/account/index";
import { SSOAction } from "../../src/@types/auth";

describe("AccountManager", () => {
    let mockClient: any;
    let accountManager: AccountManager;

    beforeEach(() => {
        mockClient = {
            http: {
                opts: {
                    accessToken: "test_token",
                },
                request: vi.fn(),
                authedRequest: vi.fn(),
                getUrl: vi.fn().mockReturnValue({ href: "https://example.com/login" }),
                abort: vi.fn(),
            },
            credentials: {
                userId: "@test:example.com",
            },
            isGuest: vi.fn().mockReturnValue(false),
            getSessionId: vi.fn().mockReturnValue("session123"),
            setGuest: vi.fn(),
            stopClient: vi.fn(),
        };
        accountManager = new AccountManager(mockClient);
    });

    describe("constructor", () => {
        it("should initialize correctly", () => {
            expect(accountManager).toBeDefined();
        });
    });

    describe("getSessionId", () => {
        it("should return session ID", () => {
            expect(accountManager.getSessionId()).toBe("session123");
            expect(mockClient.getSessionId).toHaveBeenCalled();
        });
    });

    describe("isGuest", () => {
        it("should return false by default", () => {
            expect(accountManager.isGuest()).toBe(false);
        });

        it("should return true when user is guest", () => {
            mockClient.isGuest.mockReturnValueOnce(true);
            const am = new AccountManager(mockClient);
            expect(am.isGuest()).toBe(true);
        });
    });

    describe("setGuest", () => {
        it("should set guest status", () => {
            accountManager.setGuest(true);
            expect(mockClient.setGuest).toHaveBeenCalledWith(true);
        });
    });

    describe("getAccessToken", () => {
        it("should return access token", () => {
            expect(accountManager.getAccessToken()).toBe("test_token");
        });

        it("should return null when no token", () => {
            mockClient.http.opts.accessToken = null;
            expect(accountManager.getAccessToken()).toBeNull();
        });
    });

    describe("setAccessToken", () => {
        it("should set access token", () => {
            accountManager.setAccessToken("new_token");
            expect(mockClient.http.opts.accessToken).toBe("new_token");
        });
    });

    describe("loginFlows", () => {
        it("should get login flows", async () => {
            mockClient.http.request.mockResolvedValueOnce({
                flows: [{ type: "m.login.password" }],
            });

            const flows = await accountManager.loginFlows();

            expect(flows.flows).toHaveLength(1);
        });
    });

    describe("login", () => {
        it("should login with password", async () => {
            mockClient.http.request.mockResolvedValueOnce({
                access_token: "new_token",
                user_id: "@user:example.com",
            });

            const response = await accountManager.login("m.login.password", {
                user: "@user:example.com",
                password: "password",
            });

            expect(response.access_token).toBe("new_token");
        });

        it("should update client credentials on login", async () => {
            mockClient.http.request.mockResolvedValueOnce({
                access_token: "new_token",
                user_id: "@user:example.com",
            });

            await accountManager.login("m.login.password", {
                user: "@user:example.com",
                password: "password",
            });

            expect(mockClient.credentials.userId).toBe("@user:example.com");
            expect(mockClient.http.opts.accessToken).toBe("new_token");
        });
    });

    describe("getCasLoginUrl", () => {
        it("should return CAS login URL", () => {
            mockClient.http.getUrl.mockReturnValue({
                href: "https://example.com/login/cas/redirect?redirectUrl=abc",
            });
            const url = accountManager.getCasLoginUrl("https://example.com/callback");
            expect(url).toContain("/login/cas/redirect");
        });
    });

    describe("getSsoLoginUrl", () => {
        it("should return SSO login URL", () => {
            mockClient.http.getUrl.mockReturnValue({
                href: "https://example.com/login/sso/redirect?redirectUrl=abc",
            });
            const url = accountManager.getSsoLoginUrl("https://example.com/callback");
            expect(url).toContain("/login/sso/redirect");
        });

        it("should include idpId when provided", () => {
            mockClient.http.getUrl.mockReturnValue({
                href: "https://example.com/login/sso/redirect/idp1?redirectUrl=abc",
            });
            const url = accountManager.getSsoLoginUrl("https://example.com/callback", "sso", "idp1");
            expect(url).toContain("/login/sso/redirect/idp1");
        });

        it("should include action parameter", () => {
            mockClient.http.getUrl.mockReturnValue({
                href: "https://example.com/login/sso/redirect?redirectUrl=abc&action=login",
            });
            const url = accountManager.getSsoLoginUrl(
                "https://example.com/callback",
                "sso",
                undefined,
                SSOAction.LOGIN,
            );
            expect(url).toContain("action=login");
        });
    });

    describe("loginRequest", () => {
        it("should send login request", async () => {
            mockClient.http.request.mockResolvedValueOnce({
                access_token: "token",
                user_id: "@user:example.com",
            });

            const response = await accountManager.loginRequest({
                type: "m.login.password",
                user: "@user:example.com",
                password: "password",
            });

            expect(response.access_token).toBe("token");
            expect(mockClient.http.request).toHaveBeenCalledWith("POST", "/login", undefined, {
                type: "m.login.password",
                user: "@user:example.com",
                password: "password",
            });
        });
    });

    describe("logout", () => {
        it("should logout successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await accountManager.logout();

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(expect.anything(), "/logout");
        });

        it("should stop client when stopClient is true", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await accountManager.logout(true);

            expect(mockClient.stopClient).toHaveBeenCalled();
            expect(mockClient.http.abort).toHaveBeenCalled();
        });
    });

    describe("logoutAll", () => {
        it("should logout all devices successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await accountManager.logoutAll();

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(expect.anything(), "/logout/all");
        });

        it("should stop client when logoutAll is called with stopClient=true", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await accountManager.logoutAll(true);

            expect(mockClient.stopClient).toHaveBeenCalled();
            expect(mockClient.http.abort).toHaveBeenCalled();
        });
    });

    describe("submitEmailToken", () => {
        it("should submit the registration email token payload", async () => {
            mockClient.http.request.mockResolvedValueOnce({ success: true });

            await expect(accountManager.submitEmailToken("sid123", "secret456", "token789")).resolves.toEqual({
                success: true,
            });

            expect(mockClient.http.request).toHaveBeenCalledWith("POST", "/register/email/submitToken", undefined, {
                sid: "sid123",
                client_secret: "secret456",
                token: "token789",
            });
        });
    });

    describe("deactivateAccount", () => {
        it("should use the canonical auth contract path", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ id_server_unbind_result: "success" });

            await accountManager.deactivateAccount(undefined, true);

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("POST", "/account/deactivate", undefined, {
                erase: true,
            });
        });
    });

    describe("deactivateAccount", () => {
        it("should deactivate account", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                id_server_unbind_result: "success",
            });

            const result = await accountManager.deactivateAccount();

            expect(result.id_server_unbind_result).toBe("success");
        });

        it("should accept auth and erase options", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await accountManager.deactivateAccount({ type: "m.login.password" }, true);

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/account/deactivate",
                undefined,
                expect.objectContaining({
                    auth: { type: "m.login.password" },
                    erase: true,
                }),
            );
        });
    });

    describe("requestLoginToken", () => {
        it("should request login token", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                login_token: "token123",
            });

            const result = await accountManager.requestLoginToken();

            expect(result.login_token).toBe("token123");
        });
    });

    describe("getFallbackAuthUrl", () => {
        it("should return fallback auth URL", () => {
            mockClient.http.getUrl.mockReturnValue({
                href: "https://example.com/auth/m.login.password/fallback/web?authSessionId=session123",
            });
            const url = accountManager.getFallbackAuthUrl("m.login.password", "session123");
            expect(url).toContain("/auth/m.login.password/fallback/web");
            expect(url).toContain("authSessionId=session123");
        });
    });

    describe("setGuestAccess", () => {
        it("should set guest access", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({});

            await accountManager.setGuestAccess("!room:example.com", {
                allowJoin: true,
                allowRead: false,
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("PUT", expect.any(String), undefined, {
                allowJoin: true,
                allowRead: false,
            });
        });
    });
});
