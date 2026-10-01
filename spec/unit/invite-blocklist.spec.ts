import { describe, it, expect, beforeEach, vi } from "vitest";

import { InviteBlocklistManager } from "../../src/invite-blocklist/index";

describe("InviteBlocklistManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: InviteBlocklistManager;
    let authedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        authedRequest = vi.fn().mockResolvedValue({});
        mockClient = { http: { authedRequest } };
        manager = new InviteBlocklistManager(mockClient);
    });

    it("getBlocklist returns list of user IDs", async () => {
        authedRequest.mockResolvedValue({ blocklist: ["@a:x", "@b:x"] });
        const list = await manager.getBlocklist("!r:x");
        expect(Array.isArray(list)).toBe(true);
        expect(list.length).toBe(2);
    });

    it("setBlocklist POSTs user_ids body", async () => {
        authedRequest.mockResolvedValue({ success: true });
        await manager.setBlocklist("!r:x", ["@a:x"]);
        expect(authedRequest).toHaveBeenCalled();
        const call = authedRequest.mock.calls[0];
        expect(call[0]).toBe("POST");
        expect(call[3]).toMatchObject({ user_ids: ["@a:x"] });
    });

    it("addToBlocklist issues an HTTP request", async () => {
        authedRequest.mockResolvedValue({ success: true });
        await manager.addToBlocklist("!r:x", ["@c:x"]);
        expect(authedRequest).toHaveBeenCalled();
    });

    it("clearBlocklist calls the API", async () => {
        authedRequest.mockResolvedValue({ success: true });
        await manager.clearBlocklist("!r:x");
        expect(authedRequest).toHaveBeenCalled();
    });

    it("getAllowlist returns list of user IDs", async () => {
        authedRequest.mockResolvedValue({ allowlist: ["@allowed:x"] });
        const list = await manager.getAllowlist("!r:x");
        expect(Array.isArray(list)).toBe(true);
    });

    it("getInvitePermissionConfig reads the m.invite_permission_config account data (MSC4155)", async () => {
        const getAccountDataFromServer = vi.fn().mockResolvedValue({ default_action: "block" });
        mockClient = { http: { authedRequest }, getAccountDataFromServer };
        manager = new InviteBlocklistManager(mockClient);

        const config = await manager.getInvitePermissionConfig();

        expect(getAccountDataFromServer).toHaveBeenCalledWith("m.invite_permission_config");
        expect(config).toEqual({ default_action: "block" });
    });

    it("setInvitePermissionConfig writes the m.invite_permission_config account data (MSC4155)", async () => {
        const setAccountData = vi.fn().mockResolvedValue({});
        mockClient = { http: { authedRequest }, setAccountData };
        manager = new InviteBlocklistManager(mockClient);

        await manager.setInvitePermissionConfig({ default_action: "allow" });

        expect(setAccountData).toHaveBeenCalledWith("m.invite_permission_config", { default_action: "allow" });
    });
});
