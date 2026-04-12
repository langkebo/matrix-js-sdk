import { describe, it, expect, beforeEach, vi } from "vitest";

import { WidgetsManager } from "../../src/widgets/index";
import type { MatrixEvent } from "../../src/models/event";

describe("WidgetsManager", () => {
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
});
