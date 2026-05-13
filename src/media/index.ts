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
import { Method } from "../http-api/method.ts";
import { MediaPrefix } from "../http-api/prefix.ts";
import type { UploadResponse } from "../http-api/interface.ts";
import { BaseManager } from "../managers/base-manager";
import { ValidationError } from "../errors";
import type { MediaPathPattern } from "./__generated__/route-table.ts";

type StripMediaPrefix<P extends string> =
    P extends `/_matrix/media/v1${infer Rest}` ? Rest :
    P extends `/_matrix/media/v3${infer Rest}` ? Rest :
    P extends `/_matrix/media/r0${infer Rest}` ? Rest :
    P extends `/_matrix/media/r1${infer Rest}` ? Rest :
    never;

type MediaRelativePathPattern = StripMediaPrefix<MediaPathPattern>;

function mp<P extends MediaRelativePathPattern>(path: P): P {
    return path;
}

export interface UrlPreview {
    "url"?: string;
    "title"?: string;
    "description"?: string;
    "image_url"?: string;
    "image"?: string;
    "og_image"?: string;
    "matrix:image"?: string;
}

export interface MediaDownloadUrlOptions {
    filename?: string;
    allowDirectLinks?: boolean;
    allowRedirects?: boolean;
    useAuthentication?: boolean;
    version?: "v1" | "v3" | "r1";
}

export interface MediaThumbnailUrlOptions {
    width?: number;
    height?: number;
    method?: "crop" | "scale";
    allowDirectLinks?: boolean;
    allowRedirects?: boolean;
    useAuthentication?: boolean;
    animated?: boolean;
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
    constructor(client: MatrixClient) {
        super(client);
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
        return this.client.http.uploadContent(file as Blob, opts as Record<string, unknown>);
    }

    /**
     * Upload content with a specific media ID
     * PUT /_matrix/media/v3/upload/{server_name}/{media_id}
     */
    public async uploadContentWithId(
        serverName: string,
        mediaId: string,
        content: ArrayBuffer | Blob,
        contentType: string,
    ): Promise<{ content_uri: string }> {
        const response = await this.client.http.authedRequest<{ content_uri: string }>(
            Method.Put,
            mp(`/upload/${serverName}/${mediaId}` as MediaRelativePathPattern),
            undefined,
            content,
            {
                prefix: MediaPrefix.V3,
                headers: { "Content-Type": contentType },
            },
        );
        return response;
    }

    /**
     * Cancel an upload
     */
    public cancelUpload(upload: Promise<UploadResponse>): boolean {
        return this.client.http.cancelUpload?.(upload) ?? false;
    }

    public getCurrentUploads(): Array<{ loaded: number; total: number; promise: Promise<UploadResponse> }> {
        return this.client.http.getCurrentUploads?.() ?? [];
    }

    /**
     * Get content repository URI
     */
    public getHomeserverUrl(): string {
        return this.client.baseUrl;
    }

    /**
     * Get content repository URI
     */
    public getContentRepositoryUri(): string | null {
        return this.client.getClientWellKnown()?.["m.homeserver"]?.["base_url"] || null;
    }

    /**
     * Delete media
     * POST /_matrix/media/v1/delete/{server_name}/{media_id}
     */
    public async deleteMedia(serverName: string, mediaId: string): Promise<void> {
        await this.client.http.authedRequest(
            Method.Post,
            mp(`/delete/${serverName}/${mediaId}` as MediaRelativePathPattern),
            undefined,
            undefined,
            {
                prefix: MediaPrefix.V1,
            },
        );
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

        return this.client.http.authedRequest<UrlPreview>(Method.Get, mp("/preview_url"), params, undefined, {
            prefix: MediaPrefix.V3,
        });
    }

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
        const prefix = options.useAuthentication ? "/_matrix/client/v1/media/download" : `/_matrix/media/${version}/download`;
        const encodedServer = encodeURIComponent(serverName);
        const encodedMediaId = encodeURIComponent(mediaId);
        const encodedFilename = options.filename ? `/${encodeURIComponent(options.filename)}` : "";
        const url = new URL(`${prefix}/${encodedServer}/${encodedMediaId}${encodedFilename}`, this.client.baseUrl);

        if (typeof options.allowRedirects === "boolean") {
            url.searchParams.set("allow_redirect", JSON.stringify(options.allowRedirects));
        }

        return url.href;
    }

    public getThumbnailUrl(mxcUrl: string, options: MediaThumbnailUrlOptions = {}): string {
        if (!mxcUrl.startsWith("mxc://")) {
            return options.allowDirectLinks ? mxcUrl : "";
        }

        const parsed = parseMxcUri(mxcUrl);
        if (!parsed) {
            return "";
        }

        const { serverName, mediaId } = parsed;
        const prefix = options.useAuthentication
            ? "/_matrix/client/v1/media/thumbnail"
            : "/_matrix/media/v3/thumbnail";
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

        return url.href;
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getMediaManager(): MediaManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getMediaManager = function (): MediaManager {
        return new MediaManager(this);
    };
}

export default extendMatrixClient;
