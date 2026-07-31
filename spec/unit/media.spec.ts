/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { describe, it, expect, beforeEach, vi } from "vitest";

import { MediaManager } from "../../src/media/index";

describe("MediaManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let mediaManager: MediaManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn().mockResolvedValue({}),
                request: vi.fn().mockResolvedValue({}),
                uploadContent: vi.fn().mockResolvedValue({ content_uri: "mxc://example.com/abc123" }),
                cancelUpload: vi.fn().mockReturnValue(true),
                getCurrentUploads: vi.fn().mockReturnValue([]),
            },
            baseUrl: "https://matrix.test",
            getClientWellKnown: vi.fn().mockReturnValue(null),
            getIdentityServerManager: vi.fn().mockReturnValue({
                getIdentityServerUrl: vi.fn().mockReturnValue("https://identity.test"),
            }),
        };
        mediaManager = new MediaManager(mockClient);
    });

    // ============ Media Config ============

    describe("getMediaConfig", () => {
        it("should get media config (unauthenticated)", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                "m.upload.size": 10485760,
            });

            const result = await mediaManager.getMediaConfig(false);

            expect(result["m.upload.size"]).toBe(10485760);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/config", undefined, undefined, {
                prefix: "/_matrix/media/v3",
            });
        });

        it("should get media config (authenticated)", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                "m.upload.size": 5242880,
            });

            const result = await mediaManager.getMediaConfig(true);

            expect(result["m.upload.size"]).toBe(5242880);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/media/config", undefined, undefined, {
                prefix: "/_matrix/client/v1",
            });
        });
    });

    // ============ Download URL ============

    describe("getDownloadUrl", () => {
        it("should generate download URL from MXC URI", () => {
            const url = mediaManager.getDownloadUrl("mxc://example.com/abc123");

            expect(url).toContain("_matrix/media/v3/download");
            expect(url).toContain("example.com");
            expect(url).toContain("abc123");
        });

        it("should include filename in URL when provided", () => {
            const url = mediaManager.getDownloadUrl("mxc://example.com/abc123", {
                filename: "photo.jpg",
            });

            expect(url).toContain("photo.jpg");
        });

        it("should return empty string for non-MXC URL without direct links", () => {
            const url = mediaManager.getDownloadUrl("https://example.com/photo.jpg");

            expect(url).toBe("");
        });

        it("should return original URL for non-MXC with allowDirectLinks", () => {
            const url = mediaManager.getDownloadUrl("https://example.com/photo.jpg", {
                allowDirectLinks: true,
            });

            expect(url).toBe("https://example.com/photo.jpg");
        });

        it("should use authenticated media prefix when requested", () => {
            const url = mediaManager.getDownloadUrl("mxc://example.com/abc123", {
                useAuthentication: true,
            });

            expect(url).toContain("/_matrix/client/v1/media/download");
        });
    });

    // ============ Thumbnail URL ============

    describe("getThumbnailUrl", () => {
        it("should generate thumbnail URL from MXC URI", () => {
            const url = mediaManager.getThumbnailUrl("mxc://example.com/abc123");

            expect(url).toContain("_matrix/media/v3/thumbnail");
            expect(url).toContain("example.com");
            expect(url).toContain("abc123");
        });

        it("should include width and height in URL", () => {
            const url = mediaManager.getThumbnailUrl("mxc://example.com/abc123", {
                width: 100,
                height: 200,
            });

            expect(url).toContain("width=100");
            expect(url).toContain("height=200");
        });

        it("should include crop method when specified", () => {
            const url = mediaManager.getThumbnailUrl("mxc://example.com/abc123", {
                width: 100,
                height: 100,
                method: "crop",
            });

            expect(url).toContain("method=crop");
        });

        it("should return empty string for non-MXC URL", () => {
            const url = mediaManager.getThumbnailUrl("https://example.com/photo.jpg");

            expect(url).toBe("");
        });
    });

    // ============ Delete Media ============

    describe("deleteMedia", () => {
        it("should delete media by server name and media ID", async () => {
            mockClient.http.authedRequest.mockResolvedValue(undefined);

            await mediaManager.deleteMedia("example.com", "abc123");

            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/delete/example.com/abc123",
                undefined,
                undefined,
                { prefix: "/_matrix/media/v1" },
            );
        });
    });

    // ============ Chunk Upload ============

    describe("startChunkUpload", () => {
        it("should start a chunk upload", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                upload_id: "upload-123",
            });

            const result = await mediaManager.startChunkUpload("video.mp4", "video/mp4", 10485760);

            expect(result.upload_id).toBe("upload-123");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith(
                "POST",
                "/upload/chunk/start",
                undefined,
                { filename: "video.mp4", content_type: "video/mp4", total_size: 10485760 },
                { prefix: "/_matrix/media/v1" },
            );
        });

        it("should reject empty filename", async () => {
            await expect(mediaManager.startChunkUpload("", "video/mp4")).rejects.toThrow();
        });

        it("should reject empty content type", async () => {
            await expect(mediaManager.startChunkUpload("video.mp4", "")).rejects.toThrow();
        });
    });

    // ============ Preview URL ============

    describe("previewUrl", () => {
        it("should get URL preview", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                title: "Example Page",
                description: "A test page",
            });

            const result = await mediaManager.previewUrl("https://example.com");

            expect(result.title).toBe("Example Page");
        });

        it("should reject empty URL", async () => {
            await expect(mediaManager.previewUrl("")).rejects.toThrow();
        });

        it("should reject non-HTTP URL", async () => {
            await expect(mediaManager.previewUrl("ftp://example.com")).rejects.toThrow();
        });
    });

    // ============ Quota Management ============

    describe("checkMediaQuota", () => {
        it("should check media quota", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                limit: 1073741824,
                used: 536870912,
                remaining: 536870912,
                rule: "user",
            });

            const result = await mediaManager.checkMediaQuota();

            expect(result.limit).toBe(1073741824);
            expect(result.used).toBe(536870912);
            expect(result.remaining).toBe(536870912);
            expect(result.rule).toBe("user");
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/quota/check", undefined, undefined, {
                prefix: "/_matrix/media/v1",
            });
        });
    });

    describe("getMediaQuotaStats", () => {
        it("should get media quota statistics", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                user_id: "@user:example.com",
                storage_bytes: 536870912,
                media_count: 42,
                limit_bytes: 1073741824,
                statistics: {
                    total_uploads: 150,
                    average_file_size: 3579139,
                },
            });

            const result = await mediaManager.getMediaQuotaStats();

            expect(result.user_id).toBe("@user:example.com");
            expect(result.storage_bytes).toBe(536870912);
            expect(result.media_count).toBe(42);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/quota/stats", undefined, undefined, {
                prefix: "/_matrix/media/v1",
            });
        });
    });

    describe("getMediaQuotaAlerts", () => {
        it("should get media quota alerts", async () => {
            mockClient.http.authedRequest.mockResolvedValue({
                alerts: [
                    {
                        alert_id: "alert-1",
                        alert_type: "quota_warning",
                        threshold_percent: 80,
                        current_usage_bytes: 858993459,
                        quota_limit_bytes: 1073741824,
                        message: "You have used 80% of your storage quota",
                        created_ts: 1234567890,
                        is_read: false,
                    },
                ],
            });

            const result = await mediaManager.getMediaQuotaAlerts();

            expect(result.alerts).toHaveLength(1);
            expect(result.alerts[0].alert_type).toBe("quota_warning");
            expect(result.alerts[0].threshold_percent).toBe(80);
            expect(mockClient.http.authedRequest).toHaveBeenCalledWith("GET", "/quota/alerts", undefined, undefined, {
                prefix: "/_matrix/media/v1",
            });
        });

        it("should return empty alerts when none exist", async () => {
            mockClient.http.authedRequest.mockResolvedValue({ alerts: [] });

            const result = await mediaManager.getMediaQuotaAlerts();

            expect(result.alerts).toHaveLength(0);
        });
    });
});
