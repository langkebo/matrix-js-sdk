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
 * Uploads Manager - 上传管理
 * 
 * 提供文件上传管理功能
 */

import { MatrixClient } from "../client";

export class UploadsManager {
    constructor(private client: MatrixClient) {}

    /**
     * Upload content
     */
    public async uploadContent(file: any, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).uploadContent(file, opts);
    }

    /**
     * Upload file
     */
    public async uploadFile(file: any, opts?: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).uploadFile(file, opts);
    }

    /**
     * Cancel upload
     */
    public cancelUpload(upload: Promise<any>): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).cancelUpload(upload);
    }

    /**
     * Get upload progress
     */
    public getUploadProgress(uploadId: string): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getUploadProgress(uploadId);
    }

    /**
     * Abort all uploads
     */
    public abortAllUploads(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).abortAllUploads();
    }
}

// Declare prototype extension
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
