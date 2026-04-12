import { describe, it, expect, beforeEach, vi } from "vitest";

import { WidgetManager } from "../../src/widget/index";
import { MatrixError } from "../../src/http-api/errors";

describe("WidgetManager", () => {
    let mockClient: any;
    let widgetManager: WidgetManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
        };
        widgetManager = new WidgetManager(mockClient);
    });

    describe("getRoomWidgets", () => {
        it("should return widgets successfully", async () => {
            const mockResponse = {
                widgets: [
                    {
                        widget_id: "widget1",
                        widget_type: "customwidget",
                        name: "Test Widget",
                        url: "https://example.com/widget",
                        user_id: "@user:example.com",
                    },
                ],
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResponse);

            const result = await widgetManager.getRoomWidgets("!room:example.com");

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe("widget1");
            expect(result[0].name).toBe("Test Widget");
        });

        it("should return empty array on error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Room not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await widgetManager.getRoomWidgets("!room:example.com", false);

            expect(result).toEqual([]);
        });

        it("should throw error when throwOnError is true", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Room not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getRoomWidgets("!room:example.com", true)).rejects.toThrow();
        });

        it("should throw error when roomId is missing", async () => {
            await expect(widgetManager.getRoomWidgets("")).rejects.toThrow("Room ID is required");
        });

        it("should use cache when available", async () => {
            const mockResponse = {
                widgets: [
                    {
                        widget_id: "widget1",
                        widget_type: "customwidget",
                        name: "Test Widget",
                        url: "https://example.com/widget",
                        user_id: "@user:example.com",
                    },
                ],
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResponse);

            await widgetManager.getRoomWidgets("!room:example.com");
            await widgetManager.getRoomWidgets("!room:example.com");

            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe("getWidget", () => {
        it("should return widget successfully", async () => {
            const mockResponse = {
                widget: {
                    widget_id: "widget1",
                    widget_type: "customwidget",
                    name: "Test Widget",
                    url: "https://example.com/widget",
                    user_id: "@user:example.com",
                },
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResponse);

            const result = await widgetManager.getWidget("widget1");

            expect(result).toBeDefined();
            expect(result?.id).toBe("widget1");
            expect(result?.name).toBe("Test Widget");
        });

        it("should return null on error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await widgetManager.getWidget("widget1", false);

            expect(result).toBeNull();
        });

        it("should throw error when throwOnError is true", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidget("widget1", true)).rejects.toThrow();
        });

        it("should throw error when widgetId is missing", async () => {
            await expect(widgetManager.getWidget("")).rejects.toThrow("Widget ID is required");
        });
    });

    describe("getWidgetConfig", () => {
        it("should return widget config successfully", async () => {
            const mockResponse = {
                widget_id: "widget1",
                room_id: "!room:example.com",
                url: "https://example.com/widget",
                name: "Test Widget",
                data: { theme: "dark", language: "en" },
                type: "customwidget",
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResponse);

            const result = await widgetManager.getWidgetConfig("widget1");

            expect(result).toBeDefined();
            expect(result?.data).toEqual({ theme: "dark", language: "en" });
        });

        it("should return null on error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await widgetManager.getWidgetConfig("widget1", false);

            expect(result).toBeNull();
        });

        it("should throw error when throwOnError is true", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidgetConfig("widget1", true)).rejects.toThrow();
        });
    });

    describe("getJitsiConfig", () => {
        it("should return jitsi config successfully", async () => {
            const mockResponse = {
                domain: "meet.example.com",
                appId: "app123",
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResponse);

            const result = await widgetManager.getJitsiConfig("!room:example.com");

            expect(result).toBeDefined();
            expect(result?.domain).toBe("meet.example.com");
        });

        it("should return null on error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Room not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await widgetManager.getJitsiConfig("!room:example.com", false);

            expect(result).toBeNull();
        });

        it("should throw error when throwOnError is true", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Room not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getJitsiConfig("!room:example.com", true)).rejects.toThrow();
        });
    });

    describe("getWidgetPermissions", () => {
        it("should return widget permissions successfully", async () => {
            const mockResponse = {
                permissions: ["send_message", "view_room"],
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResponse);

            const result = await widgetManager.getWidgetPermissions("widget1");

            expect(result).toBeDefined();
            expect(result?.permissions).toEqual(["send_message", "view_room"]);
        });

        it("should return null on error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await widgetManager.getWidgetPermissions("widget1", false);

            expect(result).toBeNull();
        });

        it("should throw error when throwOnError is true", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidgetPermissions("widget1", true)).rejects.toThrow();
        });
    });

    describe("deleteWidgetPermission", () => {
        it("should delete widget permission successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ deleted: true });

            const result = await widgetManager.deleteWidgetPermission("widget1", "@user:example.com");

            expect(result).toBe(true);
        });

        it("should return false on error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await widgetManager.deleteWidgetPermission("widget1", "@user:example.com", false);

            expect(result).toBe(false);
        });

        it("should throw error when throwOnError is true", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.deleteWidgetPermission("widget1", "@user:example.com", true)).rejects.toThrow();
        });
    });

    describe("getWidgetSessions", () => {
        it("should return widget sessions successfully", async () => {
            const mockResponse = {
                sessions: [
                    { session_id: "session1", device_id: "device1" },
                    { session_id: "session2", device_id: "device2" },
                ],
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResponse);

            const result = await widgetManager.getWidgetSessions("widget1");

            expect(result).toHaveLength(2);
            expect(result[0].session_id).toBe("session1");
        });

        it("should return empty array on error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await widgetManager.getWidgetSessions("widget1", false);

            expect(result).toEqual([]);
        });

        it("should throw error when throwOnError is true", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidgetSessions("widget1", true)).rejects.toThrow();
        });
    });

    describe("getWidgetSession", () => {
        it("should return widget session successfully", async () => {
            const mockResponse = {
                session: {
                    session_id: "session1",
                    device_id: "device1",
                },
            };
            mockClient.http.authedRequest.mockResolvedValueOnce(mockResponse);

            const result = await widgetManager.getWidgetSession("session1");

            expect(result).toBeDefined();
            expect(result?.session_id).toBe("session1");
        });

        it("should return null on error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Session not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await widgetManager.getWidgetSession("session1", false);

            expect(result).toBeNull();
        });

        it("should throw error when throwOnError is true", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Session not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidgetSession("session1", true)).rejects.toThrow();
        });
    });

    describe("terminateWidgetSession", () => {
        it("should terminate widget session successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({ terminated: true });

            const result = await widgetManager.terminateWidgetSession("session1");

            expect(result).toBe(true);
        });

        it("should return false on error when throwOnError is false", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Session not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            const result = await widgetManager.terminateWidgetSession("session1", false);

            expect(result).toBe(false);
        });

        it("should throw error when throwOnError is true", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Session not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.terminateWidgetSession("session1", true)).rejects.toThrow();
        });
    });
});
