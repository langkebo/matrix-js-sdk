import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../test-utils/FakeTransport";
import { VoiceManager, VoiceEvent } from "../../src/voice/index";
import { Method } from "../../src/http-api/method";

describe("VoiceManager", () => {
    let transport: FakeTransport;
    let manager: VoiceManager;

    beforeEach(() => {
        transport = new FakeTransport();
        manager = new VoiceManager({} as any, { transport });
    });

    // ─── getVoiceStats ────────────────────────────────────────────────

    it("getVoiceStats should GET /voice/stats and return stats", async () => {
        const stats = {
            total_messages: 100,
            total_duration_ms: 50000,
            average_duration_ms: 500,
            storage_used_bytes: 1024,
        };
        transport.respondWith(stats);
        const result = await manager.getVoiceStats();
        expect(result).toEqual(stats);
    });

    it("getVoiceStats should reject on failure", async () => {
        transport.rejectWith(new Error("API error"));
        await expect(manager.getVoiceStats()).rejects.toThrow();
    });

    // ─── getRoomVoiceStats ──────────────────────────────────────────

    it("getRoomVoiceStats should GET /voice/room/{id}/stats", async () => {
        const stats = { room_id: "!room:example.com", message_count: 10, total_duration_ms: 5000 };
        transport.respondWith(stats);
        const result = await manager.getRoomVoiceStats("!room:example.com");
        expect(result).toEqual(stats);
        transport.expectCalledWith(Method.Get, "/voice/room/!room%3Aexample.com/stats");
    });

    it("getRoomVoiceStats should throw ValidationError for empty room ID", async () => {
        await expect(manager.getRoomVoiceStats("")).rejects.toThrow("Room ID is required");
    });

    it("getRoomVoiceStats should reject on failure", async () => {
        transport.rejectWith(new Error("Not found"));
        await expect(manager.getRoomVoiceStats("!room:example.com")).rejects.toThrow();
    });

    // ─── getUserVoiceStats ──────────────────────────────────────────

    it("getUserVoiceStats should GET /voice/user/{id}/stats", async () => {
        const stats = { user_id: "@user:example.com", message_count: 5, total_duration_ms: 2500 };
        transport.respondWith(stats);
        const result = await manager.getUserVoiceStats("@user:example.com");
        expect(result).toEqual(stats);
        transport.expectCalledWith(Method.Get, "/voice/user/%40user%3Aexample.com/stats");
    });

    it("getUserVoiceStats should throw ValidationError for empty user ID", async () => {
        await expect(manager.getUserVoiceStats("")).rejects.toThrow("User ID is required");
    });

    // ─── getVoiceConfig ─────────────────────────────────────────────

    it("getVoiceConfig should GET /voice/config and emit ConfigUpdated", async () => {
        const config = {
            max_upload_size_bytes: 10485760,
            allowed_content_types: ["audio/ogg", "audio/mp3"],
            auto_transcribe: true,
            retention_days: 30,
        };
        const emitSpy = vi.spyOn(manager, "emit");
        transport.respondWith(config);
        const result = await manager.getVoiceConfig();
        expect(result).toEqual(config);
        expect(emitSpy).toHaveBeenCalledWith(VoiceEvent.ConfigUpdated, config);
        transport.expectCalledWith(Method.Get, "/voice/config");
    });

    it("getVoiceConfig should cache config for later retrieval", async () => {
        const config = {
            max_upload_size_bytes: 10485760,
            allowed_content_types: ["audio/ogg"],
            auto_transcribe: false,
            retention_days: 7,
        };
        // Initially null
        expect(manager.getCachedConfig()).toBeNull();
        transport.respondWith(config);
        await manager.getVoiceConfig();
        expect(manager.getCachedConfig()).toEqual(config);
    });

    // ─── uploadVoiceMessage ──────────────────────────────────────────

    it("uploadVoiceMessage should POST /voice/upload and emit MessageUploaded", async () => {
        const uploadReq = { content: "base64audio...", content_type: "audio/ogg", room_id: "!room:example.com" };
        const uploadResp = {
            message_id: "msg1",
            url: "https://example.com/audio",
            mxc_url: "mxc://example.com/audio",
            content_type: "audio/ogg",
            size_bytes: 2048,
            duration_ms: 3000,
        };
        const emitSpy = vi.spyOn(manager, "emit");
        transport.respondWith(uploadResp);
        const result = await manager.uploadVoiceMessage(uploadReq);
        expect(result).toEqual(uploadResp);
        expect(emitSpy).toHaveBeenCalledWith(VoiceEvent.MessageUploaded, uploadResp);
        transport.expectCalledWith(Method.Post, "/voice/upload");
    });

    it("uploadVoiceMessage should throw ValidationError for empty content", async () => {
        await expect(manager.uploadVoiceMessage({ content: "", content_type: "audio/ogg" })).rejects.toThrow(
            "Content is required",
        );
    });

    it("uploadVoiceMessage should throw ValidationError for empty content_type", async () => {
        await expect(manager.uploadVoiceMessage({ content: "data", content_type: "" })).rejects.toThrow(
            "Content type is required",
        );
    });

    it("uploadVoiceMessage should reject on failure", async () => {
        transport.rejectWith(new Error("Upload failed"));
        await expect(manager.uploadVoiceMessage({ content: "data", content_type: "audio/ogg" })).rejects.toThrow();
    });

    // ─── getVoiceMessage ─────────────────────────────────────────────

    it("getVoiceMessage should GET a single voice message", async () => {
        const msg = {
            message_id: "msg1",
            url: "https://example.com/audio",
            mxc_url: "mxc://example.com/audio",
            content_type: "audio/ogg",
            size_bytes: 2048,
            duration_ms: 3000,
            created_ts: 1234567890,
        };
        transport.respondWith(msg);
        const result = await manager.getVoiceMessage("msg1");
        expect(result).toEqual(msg);
        transport.expectCalledWith(Method.Get, "/voice/msg1");
    });

    it("getVoiceMessage should throw ValidationError for empty message ID", async () => {
        await expect(manager.getVoiceMessage("")).rejects.toThrow("Message ID is required");
    });

    // ─── deleteVoiceMessage ─────────────────────────────────────────

    it("deleteVoiceMessage should DELETE and emit MessageDeleted", async () => {
        transport.respondWith({ message_id: "msg1", deleted: true });
        const emitSpy = vi.spyOn(manager, "emit");
        const result = await manager.deleteVoiceMessage("msg1");
        expect(result.deleted).toBe(true);
        expect(emitSpy).toHaveBeenCalledWith(VoiceEvent.MessageDeleted, "msg1");
        transport.expectCalledWith(Method.Delete, "/voice/msg1");
    });

    it("deleteVoiceMessage should throw ValidationError for empty message ID", async () => {
        await expect(manager.deleteVoiceMessage("")).rejects.toThrow("Message ID is required");
    });

    // ─── getRoomVoice / getUserVoice ─────────────────────────────────

    it("getRoomVoice should GET /voice/room/{id}", async () => {
        transport.respondWith({ room_id: "!room:example.com", voice_enabled: true });
        const result = await manager.getRoomVoice("!room:example.com");
        expect(result.room_id).toBe("!room:example.com");
        transport.expectCalledWith(Method.Get, "/voice/room/!room%3Aexample.com");
    });

    it("getUserVoice should GET /voice/user/{id}", async () => {
        transport.respondWith({ user_id: "@user:example.com", voice_enabled: true });
        const result = await manager.getUserVoice("@user:example.com");
        expect(result.user_id).toBe("@user:example.com");
        transport.expectCalledWith(Method.Get, "/voice/user/%40user%3Aexample.com");
    });

    // ─── convertVoiceMessage ─────────────────────────────────────────

    it("convertVoiceMessage should POST /voice/{mediaId}/convert", async () => {
        transport.respondWith({ media_id: "mid1", format: "mp3" });
        const result = await manager.convertVoiceMessage("mid1", { format: "mp3" });
        expect(result.media_id).toBe("mid1");
        transport.expectCalledWith(Method.Post, "/voice/mid1/convert");
    });

    it("convertVoiceMessage should throw ValidationError for empty media ID", async () => {
        await expect(manager.convertVoiceMessage("")).rejects.toThrow("Media ID is required");
    });

    // ─── optimizeVoiceMessage ────────────────────────────────────────

    it("optimizeVoiceMessage should POST /voice/{mediaId}/optimize", async () => {
        transport.respondWith({ media_id: "mid1", bitrate: 64000 });
        const result = await manager.optimizeVoiceMessage("mid1", { bitrate: 64000 });
        expect(result.media_id).toBe("mid1");
        transport.expectCalledWith(Method.Post, "/voice/mid1/optimize");
    });

    it("optimizeVoiceMessage should throw ValidationError for empty media ID", async () => {
        await expect(manager.optimizeVoiceMessage("")).rejects.toThrow("Media ID is required");
    });

    // ─── transcribeVoiceMessage ──────────────────────────────────────

    it("transcribeVoiceMessage should POST /voice/{mediaId}/transcription", async () => {
        transport.respondWith({ media_id: "mid1", text: "Hello world", language: "en", confidence: 0.95 });
        const result = await manager.transcribeVoiceMessage("mid1", { language: "en" });
        expect(result.text).toBe("Hello world");
        expect(result.confidence).toBe(0.95);
        transport.expectCalledWith(Method.Post, "/voice/mid1/transcription");
    });

    it("transcribeVoiceMessage should throw ValidationError for empty media ID", async () => {
        await expect(manager.transcribeVoiceMessage("")).rejects.toThrow("Media ID is required");
    });

    // ─── getCachedConfig ─────────────────────────────────────────────

    it("getCachedConfig should return null before first config fetch", () => {
        expect(manager.getCachedConfig()).toBeNull();
    });

    // ─── extendMatrixClient export ─────────────────────────────────

    it("should export VoiceManager class", () => {
        expect(typeof VoiceManager).toBe("function");
    });

    it("should have expected prototype methods", () => {
        expect(typeof manager.getVoiceStats).toBe("function");
        expect(typeof manager.getVoiceConfig).toBe("function");
        expect(typeof manager.uploadVoiceMessage).toBe("function");
        expect(typeof manager.getVoiceMessage).toBe("function");
        expect(typeof manager.deleteVoiceMessage).toBe("function");
        expect(typeof manager.convertVoiceMessage).toBe("function");
    });
});
