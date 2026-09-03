import { beforeEach, describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/index.ts";
import { MediaManager } from "../../src/media/index.ts";
import { ValidationError } from "../../src/errors.ts";

describe("MediaManager", () => {
    let authedRequest: ReturnType<typeof vi.fn>;
    let uploadContent: ReturnType<typeof vi.fn>;
    let cancelUpload: ReturnType<typeof vi.fn>;
    let getCurrentUploads: ReturnType<typeof vi.fn>;
    let manager: MediaManager;

    beforeEach(() => {
        authedRequest = vi.fn();
        uploadContent = vi.fn();
        cancelUpload = vi.fn();
        getCurrentUploads = vi.fn();
        manager = new MediaManager({
            http: {
                authedRequest,
                uploadContent,
                cancelUpload,
                getCurrentUploads,
            },
            baseUrl: "https://hs.example.com",
            getClientWellKnown: vi.fn().mockReturnValue(undefined),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        manager.setRetryOptions({ maxRetries: 0 });
    });

    describe("uploadContent", () => {
        it("delegates to http.uploadContent", async () => {
            uploadContent.mockResolvedValueOnce({ content_uri: "mxc://hs/abc" });
            const file = new Blob(["payload"], { type: "text/plain" });

            const res = await manager.uploadContent(file);

            expect(res).toEqual({ content_uri: "mxc://hs/abc" });
            expect(uploadContent).toHaveBeenCalledWith(file, undefined);
        });

        it("throws ValidationError when file is missing", () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(() => manager.uploadContent(undefined as any)).toThrow(ValidationError);
            expect(uploadContent).not.toHaveBeenCalled();
        });
    });

    describe("uploadContentWithId", () => {
        it("PUTs to /upload/{server}/{mediaId} with the supplied Content-Type", async () => {
            authedRequest.mockResolvedValueOnce({ content_uri: "mxc://hs/m1" });
            const buf = new ArrayBuffer(4);

            const res = await manager.uploadContentWithId("hs.example.com", "m1", buf, "image/png");

            expect(res).toEqual({ content_uri: "mxc://hs/m1" });
            expect(authedRequest).toHaveBeenCalledWith(Method.Put, "/upload/hs.example.com/m1", undefined, buf, {
                prefix: "/_matrix/media/v3",
                headers: { "Content-Type": "image/png" },
            });
        });

        it("propagates 413 typed errors (file too large)", async () => {
            const err = Object.assign(new Error("Payload Too Large"), {
                httpStatus: 413,
                errcode: "M_TOO_LARGE",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(
                manager.uploadContentWithId("hs.example.com", "m1", new ArrayBuffer(0), "image/png"),
            ).rejects.toMatchObject({
                httpStatus: 413,
                errcode: "M_TOO_LARGE",
            });
        });
    });

    describe("deleteMedia", () => {
        it("POSTs to /delete/{server}/{mediaId} on MediaPrefix.V1", async () => {
            authedRequest.mockResolvedValueOnce({});

            await manager.deleteMedia("hs.example.com", "m1");

            expect(authedRequest).toHaveBeenCalledWith(Method.Post, "/delete/hs.example.com/m1", undefined, undefined, {
                prefix: "/_matrix/media/v1",
            });
        });

        it("propagates 403 errors", async () => {
            const err = Object.assign(new Error("Forbidden"), {
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.deleteMedia("hs.example.com", "m1")).rejects.toMatchObject({
                httpStatus: 403,
                errcode: "M_FORBIDDEN",
            });
        });
    });

    describe("previewUrl", () => {
        it("GETs /preview_url with url + ts", async () => {
            authedRequest.mockResolvedValueOnce({ title: "Hi", og_image: "mxc://hs/x" });

            const res = await manager.previewUrl("https://example.com", 1234);

            expect(res).toEqual({ title: "Hi", og_image: "mxc://hs/x" });
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/preview_url",
                { url: "https://example.com", ts: 1234 },
                undefined,
                { prefix: "/_matrix/media/v3" },
            );
        });

        it("omits ts when not provided", async () => {
            authedRequest.mockResolvedValueOnce({});

            await manager.previewUrl("https://example.com");

            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/preview_url",
                { url: "https://example.com" },
                undefined,
                { prefix: "/_matrix/media/v3" },
            );
        });

        it("rejects empty URLs with ValidationError", async () => {
            await expect(manager.previewUrl("")).rejects.toBeInstanceOf(ValidationError);
            await expect(manager.previewUrl("   ")).rejects.toBeInstanceOf(ValidationError);
            expect(authedRequest).not.toHaveBeenCalled();
        });

        it("rejects non-http(s) URLs with ValidationError", async () => {
            await expect(manager.previewUrl("file:///etc/passwd")).rejects.toBeInstanceOf(ValidationError);
            expect(authedRequest).not.toHaveBeenCalled();
        });

        it("propagates 502 errors from the homeserver preview proxy", async () => {
            const err = Object.assign(new Error("Bad Gateway"), {
                httpStatus: 502,
                errcode: "M_UNKNOWN",
            });
            authedRequest.mockRejectedValueOnce(err);

            await expect(manager.previewUrl("https://example.com")).rejects.toMatchObject({
                httpStatus: 502,
            });
        });
    });

    describe("upload helpers", () => {
        it("getHomeserverUrl returns client.baseUrl", () => {
            expect(manager.getHomeserverUrl()).toBe("https://hs.example.com");
        });

        it("cancelUpload delegates to http.cancelUpload", () => {
            cancelUpload.mockReturnValueOnce(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p = Promise.resolve({ content_uri: "mxc://hs/x" } as any);
            expect(manager.cancelUpload(p)).toBe(true);
            expect(cancelUpload).toHaveBeenCalledWith(p);
        });

        it("getCurrentUploads returns http layer's list", () => {
            getCurrentUploads.mockReturnValueOnce([{ loaded: 5, total: 10, promise: Promise.resolve() }]);
            const list = manager.getCurrentUploads();
            expect(list).toHaveLength(1);
            expect(list[0].loaded).toBe(5);
        });

        it("builds unauthenticated download URLs", () => {
            expect(manager.getDownloadUrl("mxc://hs.example.com/m1")).toBe(
                "https://hs.example.com/_matrix/media/v3/download/hs.example.com/m1",
            );
            expect(
                manager.getDownloadUrl("mxc://hs.example.com/m1", {
                    filename: "hello world.png",
                    version: "r1",
                    allowRedirects: false,
                }),
            ).toBe(
                "https://hs.example.com/_matrix/media/r1/download/hs.example.com/m1/hello%20world.png?allow_redirect=false",
            );
        });

        it("builds authenticated media URLs", () => {
            expect(
                manager.getDownloadUrl("mxc://hs.example.com/m1", {
                    filename: "file.txt",
                    useAuthentication: true,
                    allowRedirects: true,
                }),
            ).toBe(
                "https://hs.example.com/_matrix/client/v1/media/download/hs.example.com/m1/file.txt?allow_redirect=true",
            );
            expect(
                manager.getThumbnailUrl("mxc://hs.example.com/m1", {
                    width: 320,
                    height: 240,
                    method: "crop",
                    animated: true,
                    useAuthentication: true,
                }),
            ).toBe(
                "https://hs.example.com/_matrix/client/v1/media/thumbnail/hs.example.com/m1?width=320&height=240&method=crop&animated=true",
            );
        });

        it("returns direct links only when explicitly allowed", () => {
            expect(manager.getDownloadUrl("https://cdn.example.com/file.png")).toBe("");
            expect(manager.getDownloadUrl("https://cdn.example.com/file.png", { allowDirectLinks: true })).toBe(
                "https://cdn.example.com/file.png",
            );
            expect(manager.getThumbnailUrl("not-an-mxc")).toBe("");
        });
    });

    describe("getUploadProvider", () => {
        it("GETs /upload/provider on ClientPrefix.V3 and returns provider info", async () => {
            authedRequest.mockResolvedValueOnce({
                provider: "matrix",
                supports_chunked_upload: true,
                supports_resume: true,
                max_file_size: 52428800,
                chunk_size: 1048576,
            });

            const res = await manager.getUploadProvider();

            expect(res).toEqual({
                provider: "matrix",
                supports_chunked_upload: true,
                supports_resume: true,
                max_file_size: 52428800,
                chunk_size: 1048576,
            });
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Get,
                "/upload/provider",
                undefined,
                undefined,
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    describe("getUploadToken", () => {
        it("POSTs to /upload/token with filename and content_type, returns token info", async () => {
            authedRequest.mockResolvedValueOnce({
                upload_token: "upload_@user:hs_1700000000000",
                storage_type: "matrix",
                upload_url: "/_matrix/media/v3/upload",
                filename: "photo.jpg",
                content_type: "image/jpeg",
                max_file_size: 52428800,
            });

            const res = await manager.getUploadToken("photo.jpg", "image/jpeg");

            expect(res).toEqual({
                upload_token: "upload_@user:hs_1700000000000",
                storage_type: "matrix",
                upload_url: "/_matrix/media/v3/upload",
                filename: "photo.jpg",
                content_type: "image/jpeg",
                max_file_size: 52428800,
            });
            expect(authedRequest).toHaveBeenCalledWith(
                Method.Post,
                "/upload/token",
                undefined,
                { filename: "photo.jpg", content_type: "image/jpeg" },
                { prefix: "/_matrix/client/v3" },
            );
        });
    });

    // ISSUE-04: 后端从 query 读 upload_id/chunk_index，SDK 必须带 queryParams
    describe("uploadChunk (ISSUE-04)", () => {
        it("sends upload_id and chunk_index as query params", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const requestSpy = vi.spyOn(manager as any, "request").mockResolvedValue({
                upload_id: "up-1",
                chunk_index: 0,
                uploaded_chunks: 1,
                total_chunks: 2,
                uploaded_size: 4,
                status: "uploading",
            });

            await manager.uploadChunk("up-1", 0, new ArrayBuffer(4));

            expect(requestSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: Method.Post,
                    path: "/upload/chunk",
                    queryParams: { upload_id: "up-1", chunk_index: 0 },
                }),
            );
        });
    });

    // ISSUE-07: 上传前消费 m.upload.size 做客户端预检
    describe("uploadContent precheck (ISSUE-07)", () => {
        it("rejects an oversized file with M_TOO_LARGE before uploading", async () => {
            vi.spyOn(manager, "getMediaConfig").mockResolvedValue({ "m.upload.size": 4 });

            await expect(manager.uploadContent(new Blob(["this is larger than 4 bytes"]))).rejects.toMatchObject({
                errcode: "M_TOO_LARGE",
            });
            expect(uploadContent).not.toHaveBeenCalled();
        });

        it("uploads files within the advertised limit", async () => {
            vi.spyOn(manager, "getMediaConfig").mockResolvedValue({ "m.upload.size": 1024 });
            uploadContent.mockResolvedValueOnce({ content_uri: "mxc://hs/ok" });

            const res = await manager.uploadContent(new Blob(["ok"]));

            expect(res).toEqual({ content_uri: "mxc://hs/ok" });
            expect(uploadContent).toHaveBeenCalledOnce();
        });

        it("does not block the upload when the config fetch fails", async () => {
            vi.spyOn(manager, "getMediaConfig").mockRejectedValue(new Error("network down"));
            uploadContent.mockResolvedValueOnce({ content_uri: "mxc://hs/fallback" });

            const res = await manager.uploadContent(new Blob(["payload"]));

            expect(res).toEqual({ content_uri: "mxc://hs/fallback" });
            expect(uploadContent).toHaveBeenCalledOnce();
        });
    });
});
