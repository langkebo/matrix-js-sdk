import { describe, it, expect, beforeEach, vi } from "vitest";

import { UploadsManager } from "../../src/uploads/index";

describe("UploadsManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let uploadsManager: UploadsManager;

    beforeEach(() => {
        mockClient = {
            uploadContent: vi.fn().mockResolvedValue({ content_uri: "mxc://example.com/abc123" }),
            uploadFile: vi.fn().mockResolvedValue({ content_uri: "mxc://example.com/file123" }),
            cancelUpload: vi.fn().mockReturnValue(true),
            getUploadProgress: vi.fn().mockReturnValue({ loaded: 50, total: 100 }),
            abortAllUploads: vi.fn(),
        };
        uploadsManager = new UploadsManager(mockClient);
    });

    describe("constructor", () => {
        it("should initialize correctly", () => {
            expect(uploadsManager).toBeDefined();
        });
    });

    describe("uploadContent", () => {
        it("should call client.uploadContent", async () => {
            const file = new Blob(["test content"], { type: "text/plain" });
            await uploadsManager.uploadContent(file);
            expect(mockClient.uploadContent).toHaveBeenCalled();
        });

        it("should pass options to client.uploadContent", async () => {
            const file = new Blob(["test content"], { type: "text/plain" });
            await uploadsManager.uploadContent(file, { name: "test.txt", type: "text/plain" });
            expect(mockClient.uploadContent).toHaveBeenCalledWith(file, expect.objectContaining({ name: "test.txt" }));
        });

        it("should return content_uri", async () => {
            const file = new Blob(["test content"], { type: "text/plain" });
            const result = await uploadsManager.uploadContent(file);
            expect(result.content_uri).toBe("mxc://example.com/abc123");
        });
    });

    describe("uploadFile", () => {
        it("should call client.uploadFile", async () => {
            const file = new File(["test content"], "test.txt", { type: "text/plain" });
            await uploadsManager.uploadFile(file);
            expect(mockClient.uploadFile).toHaveBeenCalled();
        });

        it("should return content_uri", async () => {
            const file = new File(["test content"], "test.txt", { type: "text/plain" });
            const result = await uploadsManager.uploadFile(file);
            expect(result.content_uri).toBe("mxc://example.com/file123");
        });
    });

    describe("cancelUpload", () => {
        it("should call client.cancelUpload", () => {
            const uploadPromise = Promise.resolve({ content_uri: "mxc://example.com/abc123" });
            const result = uploadsManager.cancelUpload(uploadPromise);
            expect(mockClient.cancelUpload).toHaveBeenCalledWith(uploadPromise);
            expect(result).toBe(true);
        });
    });

    describe("getUploadProgress", () => {
        it("should return upload progress", () => {
            const progress = uploadsManager.getUploadProgress("upload-123");
            expect(progress).toEqual({ loaded: 50, total: 100 });
        });

        it("should return null when no progress", () => {
            mockClient.getUploadProgress.mockReturnValue(null);
            const progress = uploadsManager.getUploadProgress("upload-123");
            expect(progress).toBeNull();
        });
    });

    describe("abortAllUploads", () => {
        it("should call client.abortAllUploads", () => {
            uploadsManager.abortAllUploads();
            expect(mockClient.abortAllUploads).toHaveBeenCalled();
        });
    });
});
