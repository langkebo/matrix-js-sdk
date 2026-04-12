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
import { BaseManager } from "../managers/base-manager";

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
    constructor(client: MatrixClient) {
        super(client);
    }

    public async uploadContent(file: File | Blob | string, opts?: IUploadOptions): Promise<IUploadResponse> {
        return this.withRetry(() => this.client.uploadContent(file, opts as Record<string, unknown>), "uploadContent");
    }

    public async uploadFile(file: File | Blob, opts?: IUploadOptions): Promise<IUploadResponse> {
        return this.withRetry(
            () =>
                (
                    this.client as unknown as {
                        uploadFile: (file: File | Blob, opts?: IUploadOptions) => Promise<IUploadResponse>;
                    }
                ).uploadFile(file, opts),
            "uploadFile",
        );
    }

    public cancelUpload(upload: Promise<unknown>): boolean {
        return (
            this.client as unknown as {
                cancelUpload: (upload: Promise<unknown>) => boolean;
            }
        ).cancelUpload(upload);
    }

    public getUploadProgress(uploadId: string): IUploadProgress | null {
        return (
            this.client as unknown as {
                getUploadProgress: (uploadId: string) => IUploadProgress | null;
            }
        ).getUploadProgress(uploadId);
    }

    public abortAllUploads(): void {
        (
            this.client as unknown as {
                abortAllUploads: () => void;
            }
        ).abortAllUploads();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getUploadsManager(): UploadsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getUploadsManager = function (): UploadsManager {
        return new UploadsManager(this);
    };
}

export default extendMatrixClient;
