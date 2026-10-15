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

/**
 * Media Manager - 媒体管理
 *
 * 提供媒体上传、下载、删除、URL预览功能
 */

import { MatrixClient } from "../client";
import { MatrixError } from "../http-api";
import { Method } from "../http-api/method";
import { MediaPrefix, ClientPrefix } from "../http-api/prefix";
import type { UploadResponse } from "../http-api/interface";
import type { UploadOpts } from "../http-api/interface";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { ValidationError } from "../errors";
import type { MediaPath } from "./__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import type { IMediaConfig } from "../client-internal-types";
import type { PathAssert, StripMediaPrefix } from "../http-api/strip-prefix";

type MediaRelativePath = StripMediaPrefix<MediaPath>;

function mp<const P extends string>(path: P & PathAssert<P, MediaRelativePath>): P {
    return path;
}

export interface UrlPreview {
    url?: string;
    title?: string;
    description?: string;
    image_url?: string;
    image?: string;
    og_image?: string;
    "matrix:image"?: string;
}

export interface MediaDownloadUrlOptions {
    filename?: string;
    allowDirectLinks?: boolean;
    allowRedirects?: boolean;
    useAuthentication?: boolean;
    version?: "v1" | "v3" | "r1";
    signature?: string; // m-30: HMAC-SHA256 signature for authenticated media URLs
    timestamp?: number; // m-30: timestamp for signature verification
}

export interface MediaThumbnailUrlOptions {
    width?: number;
    height?: number;
    method?: "crop" | "scale";
    allowDirectLinks?: boolean;
    allowRedirects?: boolean;
    useAuthentication?: boolean;
    animated?: boolean;
    signature?: string; // m-30: HMAC-SHA256 signature for authenticated media URLs
    timestamp?: number; // m-30: timestamp for signature verification
}

export interface UploadProviderInfo {
    provider: string;
    supports_chunked_upload: boolean;
    supports_resume: boolean;
    max_file_size: number;
    chunk_size: number;
}

export interface UploadTokenResponse {
    upload_token: string;
    storage_type: string;
    upload_url: string;
    filename: string;
    content_type: string;
    max_file_size: number;
}

export interface MediaQuotaCheckResponse {
    limit: number;
    used: number;
    remaining: number;
    rule: string;
}

export interface MediaQuotaStatsResponse {
    user_id: string;
    storage_bytes: number;
    media_count: number;
    limit_bytes: number;
    statistics: Record<string, unknown>;
}

export interface MediaQuotaAlert {
    alert_id: string;
    alert_type: "quota_warning" | "quota_exceeded";
    threshold_percent: number;
    current_usage_bytes: number;
    quota_limit_bytes: number;
    message: string;
    created_ts: number;
    is_read: boolean;
}

export interface MediaQuotaAlertsResponse {
    alerts: MediaQuotaAlert[];
}

export interface ChunkUploadStartRequest {
    filename: string;
    content_type: string;
    total_size?: number;
}

export interface ChunkUploadStartResponse {
    upload_id: string;
    [key: string]: unknown;
}

export interface ChunkUploadRequest {
    upload_id: string;
    chunk_index: number;
    data: ArrayBuffer | Blob;
}

export interface ChunkUploadResponse {
    upload_id: string;
    chunk_index: number;
    /** 已接收分块数（后端键 `uploaded_chunks`，R-04：此前误声明 `received_bytes`，后端从不返回） */
    uploaded_chunks: number;
    /** 总分块数（后端键 `total_chunks`） */
    total_chunks?: number;
    /** 已接收字节数（后端键 `uploaded_size`） */
    uploaded_size: number;
    /** 上传状态（后端 `status`） */
    status?: string;
    [key: string]: unknown;
}

export interface ChunkUploadCompleteResponse {
    upload_id: string;
    content_uri: string;
    [key: string]: unknown;
}

export interface ChunkUploadCancelResponse {
    upload_id: string;
    cancelled: boolean;
    [key: string]: unknown;
}

export interface ChunkUploadProgressResponse {
    upload_id: string;
    total_chunks: number;
    /** 已接收分块数（后端键 `uploaded_chunks`） */
    uploaded_chunks: number;
    /** 已接收字节数（后端键 `uploaded_size`） */
    uploaded_size: number;
    /** 总字节数（后端键 `total_size`） */
    total_size?: number;
    /** 上传状态（后端 `status`） */
    status?: string;
    [key: string]: unknown;
}

function parseMxcUri(mxc?: string): { serverName: string; mediaId: string } | null {
    if (typeof mxc !== "string" || !mxc) {
        return null;
    }
    if (!mxc.startsWith("mxc://")) {
        return null;
    }

    const [serverName, mediaId, ...rest] = mxc.slice(6).split("/");
    if (!serverName || !mediaId || rest.length > 0) {
        return null;
    }

    return { serverName, mediaId };
}

export class MediaManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * Get the media config for the homeserver.
     * GET /_matrix/client/v1/media/config (authenticated) or GET /_matrix/media/v3/config (unauthenticated)
     *
     * @param useAuthenticatedMedia - Whether to use the authenticated media endpoint.
     * Note that the server's support for authenticated media will *not* be checked -
     * it is the caller's responsibility to do so before calling this function.
     * @returns Promise which resolves with an object containing the config.
     *
     * @example
     * ```typescript
     * const config = await client.getMediaManager().getMediaConfig(true);
     * console.log("Max upload size:", config["m.upload.size"]);
     * ```
     */
    public getMediaConfig(useAuthenticatedMedia: boolean = false): Promise<IMediaConfig> {
        const path = useAuthenticatedMedia ? "/media/config" : "/config";
        return this.withRetry(async () => {
            return await this.request<IMediaConfig>({
                method: Method.Get,
                path: path,
                prefix: useAuthenticatedMedia ? ClientPrefix.V1 : MediaPrefix.V3,
            });
        }, "getMediaConfig");
    }

    /**
     * Get the upload provider configuration for the homeserver.
     * GET /_matrix/client/v3/upload/provider
     *
     * Returns information about the server's media upload capabilities,
     * including supported upload modes and size limits.
     *
     * @example
     * ```typescript
     * const provider = await client.getMediaManager().getUploadProvider();
     * console.log("Supports chunked upload:", provider.supports_chunked_upload);
     * ```
     */
    public getUploadProvider(): Promise<UploadProviderInfo> {
        return this.withRetry(async () => {
            return await this.request<UploadProviderInfo>({
                method: Method.Get,
                path: "/upload/provider",
                prefix: ClientPrefix.V3,
            });
        }, "getUploadProvider");
    }

    /**
     * Request an upload token from the homeserver.
     * POST /_matrix/client/v3/upload/token
     *
     * @param filename - The name of the file to upload.
     * @param contentType - The MIME type of the file.
     * @returns Upload token and related metadata for the upload session.
     *
     * @example
     * ```typescript
     * const token = await client.getMediaManager().getUploadToken("photo.png", "image/png");
     * console.log("Upload URL:", token.upload_url);
     * ```
     */
    public getUploadToken(filename: string, contentType: string): Promise<UploadTokenResponse> {
        return this.withRetry(async () => {
            return await this.request<UploadTokenResponse>({
                method: Method.Post,
                path: "/upload/token",
                body: { filename, content_type: contentType },
                prefix: ClientPrefix.V3,
            });
        }, "getUploadToken");
    }

    /**
     * 上传媒体内容
     *
     * @param file - 文件内容（File, Blob 或 ArrayBuffer）
     * @param opts - 上传选项
     * @param opts.name - 文件名（可选）
     * @param opts.type - MIME 类型（可选）
     * @param opts.progress - 进度回调（可选）
     * @returns 包含 content_uri 的对象
     *
     * @example
     * ```typescript
     * // 上传文件
     * const file = document.querySelector('input[type="file"]').files[0];
     * const result = await mediaManager.uploadContent(file);
     * console.log("Uploaded:", result.content_uri);
     *
     * // 带进度回调
     * const result = await mediaManager.uploadContent(file, {
     *     progress: ({ loaded, total }) => {
     *         console.log(`Progress: ${(loaded / total * 100).toFixed(2)}%`);
     *     }
     * });
     *
     * // 上传 Blob
     * const blob = new Blob(['Hello, world!'], { type: 'text/plain' });
     * const result = await mediaManager.uploadContent(blob, {
     *     name: 'hello.txt',
     *     type: 'text/plain'
     * });
     * ```
     *
     * @throws {ValidationError} 如果文件为空
     * @throws {ApiError} 如果上传失败
     */
    public uploadContent(
        file: File | Blob | ArrayBuffer,
        opts?: { name?: string; type?: string; progress?: (progress: { loaded: number; total: number }) => void },
    ): Promise<{ content_uri: string }> {
        if (!file) {
            throw new ValidationError("File content is required");
        }
        return this.uploadContentWithPrecheck(file, opts);
    }

    /**
     * ISSUE-07: 上传前消费 `m.upload.size` 做客户端预检——超限直接抛
     * M_TOO_LARGE，而不是等服务器拒绝后得到难以识别的错误。
     * 预检失败（配置拉取异常）不阻断上传，由服务端兜底。
     */
    private async uploadContentWithPrecheck(
        file: File | Blob | ArrayBuffer,
        opts?: { name?: string; type?: string; progress?: (progress: { loaded: number; total: number }) => void },
    ): Promise<{ content_uri: string }> {
        const size = file instanceof ArrayBuffer ? file.byteLength : file.size;
        if (typeof size === "number" && size > 0) {
            const limit = await this.getCachedUploadSizeLimit();
            if (limit !== undefined && size > limit) {
                throw new MatrixError(
                    {
                        errcode: "M_TOO_LARGE",
                        error: `File size ${size} bytes exceeds the server limit of ${limit} bytes`,
                    },
                    413,
                );
            }
        }
        return this.client.http.uploadContent(file as Blob, opts as UploadOpts);
    }

    private uploadSizeLimitCache?: { value?: number; fetchedAt: number };

    private async getCachedUploadSizeLimit(): Promise<number | undefined> {
        const now = Date.now();
        if (this.uploadSizeLimitCache && now - this.uploadSizeLimitCache.fetchedAt < 5 * 60 * 1000) {
            return this.uploadSizeLimitCache.value;
        }
        let limit: number | undefined;
        try {
            const config = await this.getMediaConfig();
            limit = config["m.upload.size"];
        } catch {
            // 预检配置拉取失败不阻断上传
            limit = undefined;
        }
        this.uploadSizeLimitCache = { value: limit, fetchedAt: now };
        return limit;
    }

    /**
     * Upload content with a specific media ID
     * PUT /_matrix/media/v3/upload/{server_name}/{media_id}
     *
     * @example
     * ```typescript
     * const data = new Blob(["Hello"], { type: "text/plain" });
     * const result = await client
     *     .getMediaManager()
     *     .uploadContentWithId("example.org", "media-id", data, "text/plain");
     * console.log("Uploaded:", result.content_uri);
     * ```
     */
    public async uploadContentWithId(
        serverName: string,
        mediaId: string,
        content: ArrayBuffer | Blob,
        contentType: string,
    ): Promise<{ content_uri: string }> {
        const response = await this.request<{ content_uri: string }>({
            method: Method.Put,
            path: mp(`/upload/${serverName}/${mediaId}`),
            body: content,
            prefix: MediaPrefix.V3,
            headers: { "Content-Type": contentType },
        });
        return response;
    }

    /**
     * Cancel an upload
     *
     * @example
     * ```typescript
     * const promise = client.getMediaManager().uploadContent(file);
     * client.getMediaManager().cancelUpload(promise);
     * ```
     */
    public cancelUpload(upload: Promise<UploadResponse>): boolean {
        return this.client.http.cancelUpload?.(upload) ?? false;
    }

    /**
     * 获取当前正在进行的上传任务列表。
     *
     * @returns 上传任务数组，每项包含已上传字节数、总字节数与上传 Promise
     *
     * @example
     * ```typescript
     * const uploads = client.getMediaManager().getCurrentUploads();
     * console.log("Active uploads:", uploads.length);
     * ```
     */
    public getCurrentUploads(): Array<{ loaded: number; total: number; promise: Promise<UploadResponse> }> {
        return this.client.http.getCurrentUploads?.() ?? [];
    }

    /**
     * Get content repository URI
     *
     * @example
     * ```typescript
     * const baseUrl = client.getMediaManager().getHomeserverUrl();
     * console.log("Homeserver:", baseUrl);
     * ```
     */
    public getHomeserverUrl(): string {
        return this.client.baseUrl;
    }

    /**
     * Get content repository URI
     *
     * @example
     * ```typescript
     * const uri = client.getMediaManager().getContentRepositoryUri();
     * console.log("Content repository:", uri);
     * ```
     */
    public getContentRepositoryUri(): string | null {
        return this.client.getClientWellKnown()?.["m.homeserver"]?.["base_url"] || null;
    }

    /**
     * Delete media
     * POST /_matrix/media/v1/delete/{server_name}/{media_id}
     *
     * @example
     * ```typescript
     * await client.getMediaManager().deleteMedia("example.org", "media-id");
     * ```
     */
    public async deleteMedia(serverName: string, mediaId: string): Promise<void> {
        await this.request({
            method: Method.Post,
            path: mp(`/delete/${serverName}/${mediaId}`),
            prefix: MediaPrefix.V1,
        });
    }

    /**
     * 获取 URL 预览
     *
     * @param url - 要预览的 URL
     * @param ts - 时间戳（可选，用于缓存控制）
     * @returns URL 预览信息
     *
     * @example
     * ```typescript
     * // 获取 URL 预览
     * const preview = await mediaManager.previewUrl("https://example.com");
     * console.log("Title:", preview.title);
     * console.log("Description:", preview.description);
     * console.log("Image:", preview["og_image"]);
     *
     * // 带时间戳（强制刷新）
     * const preview = await mediaManager.previewUrl(
     *     "https://example.com",
     *     Date.now()
     * );
     * ```
     *
     * @throws {ValidationError} 如果 URL 为空或格式无效
     * @throws {ApiError} 如果 API 调用失败
     */
    public async previewUrl(url: string, ts?: number): Promise<UrlPreview> {
        if (!url || url.trim().length === 0) {
            throw new ValidationError("URL is required");
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw new ValidationError("URL must start with http:// or https://");
        }

        if (typeof this.client.getUrlPreview === "function") {
            return this.client.getUrlPreview(url, ts ?? 0) as Promise<UrlPreview>;
        }

        const params: Record<string, string | number> = { url };
        if (ts !== undefined) {
            params.ts = ts;
        }

        return this.request<UrlPreview>({
            method: Method.Get,
            path: mp("/preview_url"),
            queryParams: params,
            prefix: MediaPrefix.V3,
        });
    }

    /**
     * 根据 `mxc://` URI 构建媒体下载 URL。
     *
     * @param mxcUrl - 媒体内容 URI（`mxc://serverName/mediaId`）
     * @param options - 下载选项，可指定文件名、版本、认证方式与签名参数
     * @returns 构建好的下载 URL；URI 非法时返回空字符串
     *
     * @example
     * ```typescript
     * const url = client.getMediaManager().getDownloadUrl("mxc://example.org/media-id", {
     *     filename: "photo.png",
     *     useAuthentication: true,
     * });
     * console.log("Download URL:", url);
     * ```
     */
    public getDownloadUrl(mxcUrl: string, options: MediaDownloadUrlOptions = {}): string {
        if (!mxcUrl.startsWith("mxc://")) {
            return options.allowDirectLinks ? mxcUrl : "";
        }

        const parsed = parseMxcUri(mxcUrl);
        if (!parsed) {
            return "";
        }

        const { serverName, mediaId } = parsed;
        const version = options.version ?? "v3";
        // 带签名时必须走签名端点：普通 download 完全不读签名参数，
        // 只有 `/_matrix/media/{version}/download_signed/...` 会校验 `signature` + `expires`。
        const isSigned = Boolean(options.signature);
        const prefix =
            options.useAuthentication && !isSigned
                ? "/_matrix/client/v1/media/download"
                : `/_matrix/media/${version}/${isSigned ? "download_signed" : "download"}`;
        const encodedServer = encodeURIComponent(serverName);
        const encodedMediaId = encodeURIComponent(mediaId);
        const encodedFilename = options.filename ? `/${encodeURIComponent(options.filename)}` : "";
        const url = new URL(`${prefix}/${encodedServer}/${encodedMediaId}${encodedFilename}`, this.client.baseUrl);

        if (typeof options.allowRedirects === "boolean") {
            url.searchParams.set("allow_redirect", JSON.stringify(options.allowRedirects));
        }

        // m-30: 添加签名参数（HMAC-SHA256 认证媒体 URL）
        if (options.signature) {
            url.searchParams.set("signature", options.signature);
            // 后端读 `expires`（不是 `ts`），见 `media/download.rs:325-330`。
            url.searchParams.set("expires", (options.timestamp ?? Date.now()).toString());
        }

        return url.href;
    }

    /**
     * 开始一个分块上传会话。
     *
     * @param filename - 文件名
     * @param contentType - 文件的 MIME 类型
     * @param totalSize - 文件总字节数（可选）
     * @returns 包含 `upload_id` 的启动结果
     *
     * @example
     * ```typescript
     * const session = await client
     *     .getMediaManager()
     *     .startChunkUpload("video.mp4", "video/mp4", 10485760);
     * console.log("Upload ID:", session.upload_id);
     * ```
     */
    public async startChunkUpload(
        filename: string,
        contentType: string,
        totalSize?: number,
    ): Promise<ChunkUploadStartResponse> {
        this.requireNonEmptyString(filename, "filename");
        this.requireNonEmptyString(contentType, "contentType");
        return this.withRetry(async () => {
            return await this.request<ChunkUploadStartResponse>({
                method: Method.Post,
                path: "/upload/chunk/start",
                body: { filename, content_type: contentType, total_size: totalSize },
                prefix: MediaPrefix.V1,
            });
        }, "startChunkUpload");
    }

    /**
     * 上传分块上传会话中的一个分块。
     *
     * @param uploadId - 分块上传会话 ID
     * @param chunkIndex - 分块序号
     * @param data - 分块数据
     * @returns 包含已接收字节数的分块上传结果
     *
     * @example
     * ```typescript
     * const chunk = new Blob([new ArrayBuffer(1024)]);
     * await client.getMediaManager().uploadChunk(session.upload_id, 0, chunk);
     * ```
     */
    public async uploadChunk(
        uploadId: string,
        chunkIndex: number,
        data: ArrayBuffer | Blob,
    ): Promise<ChunkUploadResponse> {
        this.requireNonEmptyString(uploadId, "uploadId");
        return this.withRetry(async () => {
            return await this.request<ChunkUploadResponse>({
                method: Method.Post,
                path: `/upload/chunk`,
                // ISSUE-04: 后端从 query 读取 upload_id/chunk_index
                // （synapse-rust src/web/routes/media/upload.rs:185-186），
                // 此前只发 body 导致 upload_id=None、分块上传整体失效。
                queryParams: { upload_id: uploadId, chunk_index: chunkIndex },
                body: data,
                prefix: MediaPrefix.V1,
            });
        }, "uploadChunk");
    }

    /**
     * 完成分块上传会话并合并所有分块。
     *
     * @param uploadId - 分块上传会话 ID
     * @returns 包含最终 `content_uri` 的完成结果
     *
     * @example
     * ```typescript
     * const result = await client.getMediaManager().completeChunkUpload(session.upload_id);
     * console.log("Content URI:", result.content_uri);
     * ```
     */
    public async completeChunkUpload(uploadId: string): Promise<ChunkUploadCompleteResponse> {
        this.requireNonEmptyString(uploadId, "uploadId");
        return this.withRetry(async () => {
            return await this.request<ChunkUploadCompleteResponse>({
                method: Method.Post,
                path: `/upload/chunk/complete`,
                body: { upload_id: uploadId },
                prefix: MediaPrefix.V1,
            });
        }, "completeChunkUpload");
    }

    /**
     * 取消指定的分块上传会话。
     *
     * @param uploadId - 分块上传会话 ID
     * @returns 表示取消结果的响应
     *
     * @example
     * ```typescript
     * await client.getMediaManager().cancelChunkUpload(session.upload_id);
     * ```
     */
    public async cancelChunkUpload(uploadId: string): Promise<ChunkUploadCancelResponse> {
        this.requireNonEmptyString(uploadId, "uploadId");
        return this.withRetry(async () => {
            return await this.request<ChunkUploadCancelResponse>({
                method: Method.Post,
                path: `/upload/chunk/cancel`,
                body: { upload_id: uploadId },
                prefix: MediaPrefix.V1,
            });
        }, "cancelChunkUpload");
    }

    /**
     * 查询指定分块上传会话的进度。
     *
     * @param uploadId - 分块上传会话 ID
     * @returns 包含已上传分块数、字节数与状态的上传进度
     *
     * @example
     * ```typescript
     * const progress = await client.getMediaManager().getChunkUploadProgress(session.upload_id);
     * console.log("Uploaded chunks:", progress.uploaded_chunks);
     * ```
     */
    public async getChunkUploadProgress(uploadId: string): Promise<ChunkUploadProgressResponse> {
        this.requireNonEmptyString(uploadId, "uploadId");
        return this.withRetry(async () => {
            return await this.request<ChunkUploadProgressResponse>({
                method: Method.Get,
                path: `/upload/chunk/progress`,
                queryParams: { upload_id: uploadId },
                prefix: MediaPrefix.V1,
            });
        }, "getChunkUploadProgress");
    }

    /**
     * Check media quota status
     * GET /_matrix/media/v1/quota/check
     *
     * @example
     * ```typescript
     * const quota = await client.getMediaManager().checkMediaQuota();
     * console.log("Remaining bytes:", quota.remaining);
     * ```
     */
    public async checkMediaQuota(): Promise<MediaQuotaCheckResponse> {
        return this.withRetry(async () => {
            return await this.request<MediaQuotaCheckResponse>({
                method: Method.Get,
                path: "/quota/check",
                prefix: MediaPrefix.V1,
            });
        }, "checkMediaQuota");
    }

    /**
     * Get media quota statistics
     * GET /_matrix/media/v1/quota/stats
     *
     * @example
     * ```typescript
     * const stats = await client.getMediaManager().getMediaQuotaStats();
     * console.log("Storage bytes:", stats.storage_bytes);
     * ```
     */
    public async getMediaQuotaStats(): Promise<MediaQuotaStatsResponse> {
        return this.withRetry(async () => {
            return await this.request<MediaQuotaStatsResponse>({
                method: Method.Get,
                path: "/quota/stats",
                prefix: MediaPrefix.V1,
            });
        }, "getMediaQuotaStats");
    }

    /**
     * Get media quota alerts
     * GET /_matrix/media/v1/quota/alerts
     *
     * @example
     * ```typescript
     * const { alerts } = await client.getMediaManager().getMediaQuotaAlerts();
     * console.log("Pending alerts:", alerts.length);
     * ```
     */
    public async getMediaQuotaAlerts(): Promise<MediaQuotaAlertsResponse> {
        return this.withRetry(async () => {
            return await this.request<MediaQuotaAlertsResponse>({
                method: Method.Get,
                path: "/quota/alerts",
                prefix: MediaPrefix.V1,
            });
        }, "getMediaQuotaAlerts");
    }

    /**
     * 根据 `mxc://` URI 构建媒体缩略图 URL。
     *
     * @param mxcUrl - 媒体内容 URI（`mxc://serverName/mediaId`）
     * @param options - 缩略图选项，可指定宽高、缩放方式、认证方式与签名参数
     * @returns 构建好的缩略图 URL；URI 非法时返回空字符串
     *
     * @example
     * ```typescript
     * const url = client.getMediaManager().getThumbnailUrl("mxc://example.org/media-id", {
     *     width: 128,
     *     height: 128,
     *     method: "crop",
     * });
     * console.log("Thumbnail URL:", url);
     * ```
     */
    public getThumbnailUrl(mxcUrl: string, options: MediaThumbnailUrlOptions = {}): string {
        if (!mxcUrl.startsWith("mxc://")) {
            return options.allowDirectLinks ? mxcUrl : "";
        }

        const parsed = parseMxcUri(mxcUrl);
        if (!parsed) {
            return "";
        }

        const { serverName, mediaId } = parsed;
        const prefix = options.useAuthentication ? "/_matrix/client/v1/media/thumbnail" : "/_matrix/media/v3/thumbnail";
        const url = new URL(
            `${prefix}/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`,
            this.client.baseUrl,
        );

        if (options.width !== undefined) {
            url.searchParams.set("width", Math.round(options.width).toString());
        }
        if (options.height !== undefined) {
            url.searchParams.set("height", Math.round(options.height).toString());
        }
        if (options.method) {
            url.searchParams.set("method", options.method);
        }
        if (options.animated !== undefined) {
            url.searchParams.set("animated", String(options.animated));
        }
        if (typeof options.allowRedirects === "boolean") {
            url.searchParams.set("allow_redirect", JSON.stringify(options.allowRedirects));
        }

        // m-30: 添加签名参数（HMAC-SHA256 认证媒体 URL）
        if (options.signature) {
            url.searchParams.set("signature", options.signature);
            url.searchParams.set("ts", (options.timestamp ?? Date.now()).toString());
        }

        return url.href;
    }
}

// Declare prototype extension

export function extendMatrixClient(): void {
    MatrixClient.prototype.getMediaManager = function (): MediaManager {
        registerManagerClass("media", MediaManager);
        return getOrCreateManager(this, "media", () => new MediaManager(this));
    };
}
