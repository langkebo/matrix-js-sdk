import "../../src/widget/index";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { WidgetManager } from "../../src/widget/index";
import { Method } from "../../src/http-api";

describe("WidgetManager", () => {
    let mockClient: any;
    let widgetManager: WidgetManager;
    let mockAuthedRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockAuthedRequest = vi.fn();
        mockClient = {
            http: {
                authedRequest: mockAuthedRequest,
            },
            getUserId: vi.fn().mockReturnValue("@user:example.com"),
        };
        widgetManager = new WidgetManager(mockClient);
    });

    // ============ Room widgets ============

    describe("getRoomWidgets", () => {
        it("should fetch room widgets", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                widgets: [{ widget_id: "w1", room_id: "!room:example.com", user_id: "@user:example.com", type: "custom", url: "https://example.com", name: "Test", data: {}, creator: "@user:example.com", active: true }],
            });
            const result = await widgetManager.getRoomWidgets("!room:example.com");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/widgets",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.widgets).toHaveLength(1);
            expect(result.widgets[0].widget_id).toBe("w1");
        });
    });

    describe("getJitsiConfig", () => {
        it("should fetch Jitsi config for a room", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ conf_id: "conf1", name: "Test", domain: "jitsi.example.com", app_id: null, jwt: null });
            const result = await widgetManager.getJitsiConfig("!room:example.com");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/widgets/jitsi/config",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.conf_id).toBe("conf1");
        });
    });

    // ============ Widget CRUD ============

    describe("createWidget", () => {
        it("should create a widget", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                widget: { widget_id: "w1", room_id: null, user_id: "@user:example.com", type: "custom", url: "https://example.com", name: "Test", data: {}, creator: "@user:example.com", active: true },
            });
            const result = await widgetManager.createWidget({ widget_type: "custom", url: "https://example.com", name: "Test" });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/widgets",
                undefined,
                { widget_type: "custom", url: "https://example.com", name: "Test" },
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.widget.widget_id).toBe("w1");
        });

        it("should throw if widget_type is missing", async () => {
            await expect(
                widgetManager.createWidget({ widget_type: "", url: "https://example.com", name: "Test" }),
            ).rejects.toThrow("widget_type is required");
        });

        it("should throw if url is missing", async () => {
            await expect(
                widgetManager.createWidget({ widget_type: "custom", url: "", name: "Test" }),
            ).rejects.toThrow("url is required");
        });
    });

    describe("getWidget", () => {
        it("should get a widget by ID", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                widget: { widget_id: "w1", room_id: null, user_id: "@user:example.com", type: "custom", url: "https://example.com", name: "Test", data: {}, creator: "@user:example.com", active: true },
            });
            const result = await widgetManager.getWidget("w1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/widgets/w1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.widget.widget_id).toBe("w1");
        });

        it("should throw if widget_id is missing", async () => {
            await expect(widgetManager.getWidget("")).rejects.toThrow("widget_id is required");
        });
    });

    describe("updateWidget", () => {
        it("should update a widget", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                widget: { widget_id: "w1", room_id: null, user_id: "@user:example.com", type: "custom", url: "https://example.com", name: "Updated", data: {}, creator: "@user:example.com", active: true },
            });
            const result = await widgetManager.updateWidget("w1", { name: "Updated" });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/widgets/w1",
                undefined,
                { name: "Updated" },
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.widget.name).toBe("Updated");
        });

        it("should throw if widget_id is missing", async () => {
            await expect(
                widgetManager.updateWidget("", { name: "Test" }),
            ).rejects.toThrow("widget_id is required");
        });
    });

    describe("deleteWidget", () => {
        it("should delete a widget", async () => {
            mockAuthedRequest.mockResolvedValueOnce(undefined);
            await widgetManager.deleteWidget("w1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/widgets/w1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Widget config ============

    describe("getWidgetConfig", () => {
        it("should get widget config", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ widget_id: "w1", room_id: null, url: "https://example.com", name: "Test", type: "custom", data: {} });
            const result = await widgetManager.getWidgetConfig("w1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/widgets/w1/config",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.widget_id).toBe("w1");
        });
    });

    // ============ Widget permissions ============

    describe("getWidgetPermissions", () => {
        it("should get widget permissions", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                permissions: [{ id: 1, widget_id: "w1", user_id: "@user:example.com", permissions: ["read"], created_ts: 1234, updated_ts: null }],
            });
            const result = await widgetManager.getWidgetPermissions("w1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/widgets/w1/permissions",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.permissions).toHaveLength(1);
        });
    });

    describe("setWidgetPermissions", () => {
        it("should set widget permissions", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ success: true, permission_id: 1 });
            const result = await widgetManager.setWidgetPermissions("w1", {
                user_id: "@user:example.com",
                permissions: ["read", "write"],
            });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/widgets/w1/permissions",
                undefined,
                { user_id: "@user:example.com", permissions: ["read", "write"] },
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.success).toBe(true);
        });

        it("should throw if user_id is missing", async () => {
            await expect(
                widgetManager.setWidgetPermissions("w1", { user_id: "", permissions: ["read"] }),
            ).rejects.toThrow("user_id is required");
        });

        it("should throw if permissions is empty", async () => {
            await expect(
                widgetManager.setWidgetPermissions("w1", { user_id: "@user:example.com", permissions: [] }),
            ).rejects.toThrow("permissions must be a non-empty array");
        });
    });

    describe("removeWidgetPermission", () => {
        it("should remove a widget permission", async () => {
            mockAuthedRequest.mockResolvedValueOnce(undefined);
            await widgetManager.removeWidgetPermission("w1", "@user:example.com");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/widgets/w1/permissions/%40user%3Aexample.com",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Widget sessions ============

    describe("getWidgetSessions", () => {
        it("should get widget sessions", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                sessions: [{ session_id: "s1", widget_id: "w1", device_id: null, created_ts: 1234, expires_ts: null }],
                total: 1,
            });
            const result = await widgetManager.getWidgetSessions("w1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/widgets/w1/sessions",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.sessions).toHaveLength(1);
        });
    });

    describe("createWidgetSession", () => {
        it("should create a widget session", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                session: { session_id: "s1", widget_id: "w1", device_id: null, created_ts: 1234, expires_ts: null },
            });
            const result = await widgetManager.createWidgetSession("w1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/widgets/w1/sessions",
                undefined,
                {},
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.session.session_id).toBe("s1");
        });
    });

    describe("getWidgetSession", () => {
        it("should get a specific widget session", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                session: { session_id: "s1", widget_id: "w1", device_id: null, created_ts: 1234, expires_ts: null },
            });
            const result = await widgetManager.getWidgetSession("s1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/widgets/sessions/s1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
            expect(result.session.session_id).toBe("s1");
        });
    });

    describe("deleteWidgetSession", () => {
        it("should delete a widget session", async () => {
            mockAuthedRequest.mockResolvedValueOnce(undefined);
            await widgetManager.deleteWidgetSession("s1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Delete,
                "/widgets/sessions/s1",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v1" },
            );
        });
    });

    // ============ Widget capabilities (v3) ============

    describe("getWidgetCapabilities", () => {
        it("should get widget capabilities", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ widget_id: "w1", room_id: "!room:example.com", capabilities: ["read", "write"] });
            const result = await widgetManager.getWidgetCapabilities("!room:example.com", "w1");
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/rooms/!room%3Aexample.com/widgets/w1/capabilities",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
            expect(result.capabilities).toEqual(["read", "write"]);
        });
    });

    describe("setWidgetCapabilities", () => {
        it("should set widget capabilities", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ widget_id: "w1", room_id: "!room:example.com", capabilities: ["read"] });
            const result = await widgetManager.setWidgetCapabilities("!room:example.com", "w1", ["read"]);
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Put,
                "/rooms/!room%3Aexample.com/widgets/w1/capabilities",
                undefined,
                { capabilities: ["read"] },
                { prefix: "/_matrix/client/v3" },
            );
            expect(result.capabilities).toEqual(["read"]);
        });
    });

    describe("sendWidgetEvent", () => {
        it("should send a widget event", async () => {
            mockAuthedRequest.mockResolvedValueOnce({ event_id: "$ev1" });
            const result = await widgetManager.sendWidgetEvent("!room:example.com", "w1", { action: "click" });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/rooms/!room%3Aexample.com/widgets/w1/send",
                undefined,
                { action: "click" },
                { prefix: "/_matrix/client/v3" },
            );
            expect(result.event_id).toBe("$ev1");
        });
    });

    describe("createWidgetV3", () => {
        it("should create a widget via v3 endpoint", async () => {
            mockAuthedRequest.mockResolvedValueOnce({
                widget: { widget_id: "w1", room_id: null, user_id: "@user:example.com", type: "custom", url: "https://example.com", name: "Test", data: {}, creator: "@user:example.com", active: true },
            });
            const result = await widgetManager.createWidgetV3({ widget_type: "custom", url: "https://example.com", name: "Test" });
            expect(mockAuthedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/widgets/create",
                undefined,
                { widget_type: "custom", url: "https://example.com", name: "Test" },
                { prefix: "/_matrix/client/v3" },
            );
            expect(result.widget.widget_id).toBe("w1");
        });
    });

    // ============ Lifecycle ============

    describe("start/stop", () => {
        it("should start and stop without errors", () => {
            expect(() => widgetManager.start()).not.toThrow();
            expect(() => widgetManager.stop()).not.toThrow();
        });
    });
});
