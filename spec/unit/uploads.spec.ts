import { describe, it, expect, beforeEach, vi } from "vitest";

import { UploadsManager } from "../../src/uploads/index";

/*
 * mockClient **故意不提供** `uploadFile` / `getUploadProgress` / `abortAllUploads`
 * —— 它们在本 fork 的 MatrixClient 上运行时并不存在。
 * 旧 spec 把它们 `vi.fn()` 到 client 上，于是"转发到不存在的东西"被掩盖。
 */
describe("UploadsManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let uploadsManager: UploadsManager;
    const file = new Blob(["test content"], { type: "text/plain" });

    beforeEach(() => {
        mockClient = {
            uploadContent: vi.fn().mockResolvedValue({ content_uri: "mxc://example.com/abc123" }),
            cancelUpload: vi.fn().mockReturnValue(true),
            getCurrentUploads: vi.fn().mockReturnValue([]),
        };
        uploadsManager = new UploadsManager(mockClient);
    });

    it("uploadContent 直接委托 client.uploadContent", async () => {
        await expect(uploadsManager.uploadContent(file)).resolves.toEqual({
            content_uri: "mxc://example.com/abc123",
        });
        expect(mockClient.uploadContent).toHaveBeenCalledWith(file, undefined);
    });

    it("uploadContent 透传 options", async () => {
        await uploadsManager.uploadContent(file, { name: "test.txt", type: "text/plain" });

        expect(mockClient.uploadContent).toHaveBeenCalledWith(file, { name: "test.txt", type: "text/plain" });
    });

    it("uploadFile 也走 client.uploadContent（本 fork 没有 uploadFile）", async () => {
        await uploadsManager.uploadFile(file);

        expect(mockClient.uploadContent).toHaveBeenCalledWith(file, undefined);
    });

    it("cancelUpload 委托 client.cancelUpload", () => {
        const pending = Promise.resolve({ content_uri: "mxc://x/y" });

        expect(uploadsManager.cancelUpload(pending)).toBe(true);
        expect(mockClient.cancelUpload).toHaveBeenCalledWith(pending);
    });

    it("abortAllUploads 逐个取消进行中的上传", () => {
        const first = { loaded: 1, total: 2, promise: Promise.resolve({ content_uri: "mxc://a" }) };
        const second = { loaded: 0, total: 9, promise: Promise.resolve({ content_uri: "mxc://b" }) };
        mockClient.getCurrentUploads.mockReturnValue([first, second]);

        uploadsManager.abortAllUploads();

        expect(mockClient.cancelUpload).toHaveBeenCalledTimes(2);
        expect(mockClient.cancelUpload).toHaveBeenCalledWith(first.promise);
        expect(mockClient.cancelUpload).toHaveBeenCalledWith(second.promise);
    });

    it("不再暴露 getUploadProgress —— 本 fork 的 Upload 没有 id 概念", () => {
        expect((uploadsManager as unknown as Record<string, unknown>).getUploadProgress).toBeUndefined();
    });
});
