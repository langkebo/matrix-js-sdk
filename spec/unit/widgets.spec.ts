import { describe, it, expect, beforeEach, vi } from "vitest";

import { WidgetsManager } from "../../src/widgets/index";
import type { MatrixEvent } from "../../src/models/event";

describe("WidgetsManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let widgetsManager: WidgetsManager;

    beforeEach(() => {
        mockClient = {
            getUserWidgets: vi.fn().mockResolvedValue({}),
            getRoomWidgets: vi.fn().mockResolvedValue({}),
            setUserWidgets: vi.fn().mockResolvedValue(undefined),
            setRoomWidgets: vi.fn().mockResolvedValue(undefined),
            getAllWidgetEvents: vi.fn().mockResolvedValue([]),
        };
        widgetsManager = new WidgetsManager(mockClient);
    });

    describe("constructor", () => {
        it("should initialize correctly", () => {
            expect(widgetsManager).toBeDefined();
        });
    });

    describe("isSupported", () => {
        it("defaults to supported for clients without centralized discovery", async () => {
            await expect(widgetsManager.isSupported()).resolves.toBe(true);
        });

        it("uses centralized synapse-rust widget discovery when available", async () => {
            mockClient.doesServerAdvertiseSynapseRustFeature = vi.fn().mockResolvedValue(false);

            await expect(widgetsManager.isSupported()).resolves.toBe(false);
            expect(mockClient.doesServerAdvertiseSynapseRustFeature).toHaveBeenCalledWith("org.matrix.msc4261.widget");
        });
    });

    describe("getUserWidgets", () => {
        it("should call client.getUserWidgets", async () => {
            await widgetsManager.getUserWidgets();
            expect(mockClient.getUserWidgets).toHaveBeenCalled();
        });

        it("should return user widgets", async () => {
            mockClient.getUserWidgets.mockResolvedValue({ widget1: { url: "https://example.com" } });
            const result = await widgetsManager.getUserWidgets();
            expect(result).toEqual({ widget1: { url: "https://example.com" } });
        });
    });

    describe("getRoomWidgets", () => {
        it("should call client.getRoomWidgets with roomId", async () => {
            await widgetsManager.getRoomWidgets("!room:example.com");
            expect(mockClient.getRoomWidgets).toHaveBeenCalledWith("!room:example.com");
        });

        it("should return room widgets", async () => {
            mockClient.getRoomWidgets.mockResolvedValue({ widget1: { url: "https://example.com" } });
            const result = await widgetsManager.getRoomWidgets("!room:example.com");
            expect(result).toEqual({ widget1: { url: "https://example.com" } });
        });
    });

    describe("setUserWidgets", () => {
        it("should call client.setUserWidgets", async () => {
            const widgets = { widget1: { url: "https://example.com" } };
            await widgetsManager.setUserWidgets(widgets);
            expect(mockClient.setUserWidgets).toHaveBeenCalledWith(widgets);
        });
    });

    describe("setRoomWidgets", () => {
        it("should call client.setRoomWidgets with roomId and widgets", async () => {
            const widgets = { widget1: { url: "https://example.com" } };
            await widgetsManager.setRoomWidgets("!room:example.com", widgets);
            expect(mockClient.setRoomWidgets).toHaveBeenCalledWith("!room:example.com", widgets);
        });
    });

    describe("getAllWidgetEvents", () => {
        it("should call client.getAllWidgetEvents", async () => {
            await widgetsManager.getAllWidgetEvents("!room:example.com");
            expect(mockClient.getAllWidgetEvents).toHaveBeenCalledWith("!room:example.com");
        });

        it("should return widget events", async () => {
            const mockEvent = {} as MatrixEvent;
            mockClient.getAllWidgetEvents.mockResolvedValue([mockEvent]);
            const result = await widgetsManager.getAllWidgetEvents("!room:example.com");
            expect(result).toHaveLength(1);
        });
    });

    describe("REST widget wrappers (synapse-rust)", () => {
        let mockAuthedRequest: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            mockAuthedRequest = vi.fn().mockResolvedValue({ widget: { widget_id: "w1" } });
            mockClient.http = { authedRequest: mockAuthedRequest };
        });

        it("createWidget posts to /widgets under V1 prefix", async () => {
            await widgetsManager.createWidget({
                room_id: "!r:x",
                widget_type: "jitsi",
                url: "https://jitsi/",
                name: "Call",
            });
            const call = mockAuthedRequest.mock.calls[0];
            expect(call[0]).toBe("POST");
            expect(call[1]).toBe("/widgets");
            expect(call[3]).toMatchObject({ widget_type: "jitsi", name: "Call" });
            expect(call[4]).toMatchObject({ prefix: "/_matrix/client/v1" });
        });

        it("getWidgetById encodes path and uses GET", async () => {
            await widgetsManager.getWidgetById("w/1");
            const call = mockAuthedRequest.mock.calls[0];
            expect(call[0]).toBe("GET");
            expect(call[1]).toBe("/widgets/w%2F1");
        });

        it("updateWidget uses PUT", async () => {
            await widgetsManager.updateWidget("w1", { name: "renamed" });
            const call = mockAuthedRequest.mock.calls[0];
            expect(call[0]).toBe("PUT");
            expect(call[3]).toEqual({ name: "renamed" });
        });

        it("deleteWidget uses DELETE", async () => {
            mockAuthedRequest.mockResolvedValue(undefined);
            await widgetsManager.deleteWidget("w1");
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("DELETE");
        });

        it("listRoomWidgets hits /rooms/{id}/widgets", async () => {
            mockAuthedRequest.mockResolvedValue({ widgets: [] });
            await widgetsManager.listRoomWidgets("!r:x");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/rooms/!r%3Ax/widgets");
        });

        it("getJitsiConfig hits /rooms/{id}/widgets/jitsi/config", async () => {
            mockAuthedRequest.mockResolvedValue({ server: "jitsi.example" });
            await widgetsManager.getJitsiConfig("!r:x");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/rooms/!r%3Ax/widgets/jitsi/config");
        });

        it("setWidgetPermission posts body with user_id+permissions", async () => {
            await widgetsManager.setWidgetPermission("w1", {
                user_id: "@a:x",
                permissions: ["read"],
            });
            expect(mockAuthedRequest.mock.calls[0][3]).toEqual({
                user_id: "@a:x",
                permissions: ["read"],
            });
        });

        it("createWidgetSession POSTs to /widgets/{id}/sessions", async () => {
            mockAuthedRequest.mockResolvedValue({ session_id: "s1" });
            await widgetsManager.createWidgetSession("w1", { expires_in_ms: 5000 });
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("POST");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/widgets/w1/sessions");
            expect(mockAuthedRequest.mock.calls[0][3]).toEqual({ expires_in_ms: 5000 });
        });

        it("terminateWidgetSession uses DELETE on /widgets/sessions/{id}", async () => {
            mockAuthedRequest.mockResolvedValue(undefined);
            await widgetsManager.terminateWidgetSession("s1");
            expect(mockAuthedRequest.mock.calls[0][0]).toBe("DELETE");
            expect(mockAuthedRequest.mock.calls[0][1]).toBe("/widgets/sessions/s1");
        });
    });
});
