import { describe, it, expect, beforeEach, vi } from "vitest";

import { WidgetEvent, WidgetManager } from "../../src/widget/index";
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

        it("should emit WidgetError and return empty array when fallback mode is enabled", async () => {
            const errorSpy = vi.fn();
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Room not found" }, 404, undefined);
            widgetManager.on(WidgetEvent.WidgetError, errorSpy);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getRoomWidgets("!room:example.com", false)).resolves.toEqual([]);
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toBe("!room:example.com");
            expect(errorSpy.mock.calls[0][1]).toBeUndefined();
        });

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Room not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getRoomWidgets("!room:example.com")).rejects.toThrow();
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

        it("should emit WidgetError and throw by default", async () => {
            const errorSpy = vi.fn();
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            widgetManager.on(WidgetEvent.WidgetError, errorSpy);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidget("widget1")).rejects.toThrow();
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toBeUndefined();
            expect(errorSpy.mock.calls[0][1]).toBe("widget1");
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

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidgetConfig("widget1")).rejects.toThrow();
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

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Room not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getJitsiConfig("!room:example.com")).rejects.toThrow();
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

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidgetPermissions("widget1")).rejects.toThrow();
        });
    });

    describe("setWidgetPermission", () => {
        it("should emit WidgetError and return null when fallback mode is enabled", async () => {
            const errorSpy = vi.fn();
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            widgetManager.on(WidgetEvent.WidgetError, errorSpy);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(
                widgetManager.setWidgetPermission("widget1", "@user:example.com", ["send_message"], false),
            ).resolves.toBeNull();
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toBeUndefined();
            expect(errorSpy.mock.calls[0][1]).toBe("widget1");
        });

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(
                widgetManager.setWidgetPermission("widget1", "@user:example.com", ["send_message"]),
            ).rejects.toThrow();
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

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.deleteWidgetPermission("widget1", "@user:example.com")).rejects.toThrow();
        });
    });

    describe("createWidgetSession", () => {
        it("should omit optional fields when options are not provided", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                session: {
                    session_id: "session1",
                    widget_id: "widget1",
                    user_id: "@user:example.com",
                    device_id: null,
                    expires_at: 1234567890,
                },
            });

            await widgetManager.createWidgetSession("widget1");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/widgets/widget1/sessions",
                undefined,
                { widget_id: "widget1" },
                { prefix: "/_matrix/client/v1" },
            );
        });

        it("should emit WidgetError and return null when fallback mode is enabled", async () => {
            const errorSpy = vi.fn();
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            widgetManager.on(WidgetEvent.WidgetError, errorSpy);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.createWidgetSession("widget1", undefined, false)).resolves.toBeNull();
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toBeUndefined();
            expect(errorSpy.mock.calls[0][1]).toBe("widget1");
        });

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.createWidgetSession("widget1")).rejects.toThrow();
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

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidgetSessions("widget1")).rejects.toThrow();
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

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Session not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidgetSession("session1")).rejects.toThrow();
        });
    });

    describe("getWidgetCapabilities", () => {
        it("should return widget capabilities successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                capabilities: ["org.matrix.msc2762.receive.state_event:m.room.member"],
            });

            const result = await widgetManager.getWidgetCapabilities("!room:example.com", "widget1");

            expect(result).toEqual({
                capabilities: ["org.matrix.msc2762.receive.state_event:m.room.member"],
            });
        });

        it("should emit WidgetError and throw when capabilities lookup fails", async () => {
            const errorSpy = vi.fn();
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Widget not found" }, 404, undefined);
            widgetManager.on(WidgetEvent.WidgetError, errorSpy);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.getWidgetCapabilities("!room:example.com", "widget1")).rejects.toThrow();
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toBe("!room:example.com");
            expect(errorSpy.mock.calls[0][1]).toBe("widget1");
        });

        it("should call the v3 capability endpoint", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                capabilities: [],
            });

            await widgetManager.getWidgetCapabilities("!room:example.com", "widget1");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "GET",
                `/rooms/${encodeURIComponent("!room:example.com")}/widgets/${encodeURIComponent("widget1")}/capabilities`,
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("setWidgetCapabilities", () => {
        it("should update widget capabilities successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                capabilities: ["org.matrix.msc2762.send.event:m.room.message"],
            });

            const result = await widgetManager.setWidgetCapabilities("!room:example.com", "widget1", [
                "org.matrix.msc2762.send.event:m.room.message",
            ]);

            expect(result).toEqual({
                capabilities: ["org.matrix.msc2762.send.event:m.room.message"],
            });
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "PUT",
                `/rooms/${encodeURIComponent("!room:example.com")}/widgets/${encodeURIComponent("widget1")}/capabilities`,
                undefined,
                { capabilities: ["org.matrix.msc2762.send.event:m.room.message"] },
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("sendWidgetMessage", () => {
        it("should return widget message response successfully", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                event_id: "$event",
                widget_id: "widget1",
                room_id: "!room:example.com",
                type: "ping",
                content: { api: "widget", ok: true },
            });

            const result = await widgetManager.sendWidgetMessage("!room:example.com", "widget1", {
                api: "widget",
                action: "ping",
                data: { ok: true },
            });

            expect(result.eventId).toBe("$event");
            expect(result.widgetId).toBe("widget1");
            expect(result.roomId).toBe("!room:example.com");
            expect(result.type).toBe("ping");
            expect(result.content).toEqual({ api: "widget", ok: true });
            expect(result.requestId).toBeDefined();
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                `/rooms/${encodeURIComponent("!room:example.com")}/widgets/${encodeURIComponent("widget1")}/send`,
                undefined,
                {
                    type: "ping",
                    content: { api: "widget", ok: true },
                },
                { prefix: "/_matrix/client/v3" },
            );
        });

        it("should emit WidgetError and throw when sending a widget message fails", async () => {
            const errorSpy = vi.fn();
            const matrixError = new MatrixError({ errcode: "M_FORBIDDEN", error: "Forbidden" }, 403, undefined);
            widgetManager.on(WidgetEvent.WidgetError, errorSpy);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(
                widgetManager.sendWidgetMessage("!room:example.com", "widget1", {
                    api: "widget",
                    action: "ping",
                }),
            ).rejects.toThrow();
            expect(errorSpy).toHaveBeenCalledTimes(1);
            expect(errorSpy.mock.calls[0][0]).toBe("!room:example.com");
            expect(errorSpy.mock.calls[0][1]).toBe("widget1");
        });

        it("should support direct type and content payloads", async () => {
            mockClient.http.authedRequest.mockResolvedValueOnce({
                event_id: "$event",
                type: "m.room.message",
                content: { body: "hello" },
            });

            await widgetManager.sendWidgetMessage("!room:example.com", "widget1", {
                type: "m.room.message",
                content: { body: "hello" },
            });

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                `/rooms/${encodeURIComponent("!room:example.com")}/widgets/${encodeURIComponent("widget1")}/send`,
                undefined,
                {
                    type: "m.room.message",
                    content: { body: "hello" },
                },
                { prefix: "/_matrix/client/v3" },
            );
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

        it("should throw error by default", async () => {
            const matrixError = new MatrixError({ errcode: "M_NOT_FOUND", error: "Session not found" }, 404, undefined);
            mockClient.http.authedRequest.mockRejectedValueOnce(matrixError);

            await expect(widgetManager.terminateWidgetSession("session1")).rejects.toThrow();
        });
    });
});
