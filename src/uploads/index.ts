/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may May obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Uploads Manager - 上传管理
 *
 * 提供文件上传管理功能
 */

import { MatrixClient } from "../client";
import type { UploadOpts, UploadResponse } from "../http-api/interface";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

export interface IUploadOptions {
    name?: string;
    type?: string;
    includeFilename?: boolean;
    progress?: (progress: { loaded: number; total: number }) => void;
}

export interface IUploadProgress {
    loaded: number;
    total: number;
}

export interface IUploadResponse {
    content_uri: string;
}

export interface UploadsManagerEvents {
    upload_started: { uploadId: string; filename: string };
    upload_progress: { uploadId: string; progress: IUploadProgress };
    upload_completed: { uploadId: string; contentUri: string };
    upload_failed: { uploadId: string; error: Error };
}

export class UploadsManager extends BaseManager<keyof UploadsManagerEvents, UploadsManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    /**
     * 上传文件内容到服务器
     *
     * @param file - 要上传的文件（`File` / `Blob` / 字符串）
     * @param opts - 上传选项（名称、类型、进度回调等）
     * @returns 上传结果，包含内容 URI（`content_uri`）
     * @example
     * ```typescript
     * const res = await client.getUploadsManager().uploadContent(file, { name: "photo.png" });
     * console.log(res.content_uri);
     * ```
     */
    public async uploadContent(file: File | Blob | string, opts?: IUploadOptions): Promise<IUploadResponse> {
        return this.withRetry(() => this.client.uploadContent(file, opts as UploadOpts), "uploadContent");
    }

    // 上传文件。
    // 本 fork 没有 `client.uploadFile` —— 它本就是 `uploadContent` 的别名
    // （`uploadContent` 的第一个参数已经是 `File | Blob | string`）。此前这里转发给
    // 不存在的方法 ⇒ 调用即 TypeError。
    /**
     * 上传文件（`uploadContent` 的别名）
     *
     * @param file - 要上传的文件
     * @param opts - 上传选项
     * @returns 上传结果，包含内容 URI（`content_uri`）
     * @example
     * ```typescript
     * const res = await client.getUploadsManager().uploadFile(file);
     * console.log(res.content_uri);
     * ```
     */
    public async uploadFile(file: File | Blob, opts?: IUploadOptions): Promise<IUploadResponse> {
        return this.withRetry(() => this.client.uploadContent(file, opts as UploadOpts), "uploadFile");
    }

    /**
     * 取消指定的上传
     *
     * @param upload - 由上传方法返回的 Promise
     * @returns 是否成功取消
     * @example
     * ```typescript
     * const uploadPromise = client.getUploadsManager().uploadFile(file);
     * client.getUploadsManager().cancelUpload(uploadPromise);
     * ```
     */
    public cancelUpload(upload: Promise<unknown>): boolean {
        return this.client.cancelUpload(upload as Promise<UploadResponse>);
    }

    // 中止所有进行中的上传。
    // ⚠️ 本轮删掉了 `getUploadProgress(uploadId)`：本 fork 的上传**没有 uploadId 概念**
    // （`Upload` 只有 `loaded / total / promise / abortController`，见
    // `src/http-api/interface.ts:246`），进度应通过 `IUploadOptions.progress` 回调或
    // `getCurrentUploads()` 的 `{loaded, total}` 获取。原实现转发给不存在的
    // `client.getUploadProgress()`，调用即 TypeError。
    /**
     * 中止所有进行中的上传
     *
     * @example
     * ```typescript
     * client.getUploadsManager().abortAllUploads();
     * ```
     */
    public abortAllUploads(): void {
        for (const upload of this.client.getCurrentUploads()) {
            this.client.cancelUpload(upload.promise);
        }
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getUploadsManager = function (): UploadsManager {
        registerManagerClass("uploads", UploadsManager);
        return getOrCreateManager(this, "uploads", () => new UploadsManager(this));
    };
}
