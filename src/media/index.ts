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
 * 提供媒体上传、下载功能
 */

import { MatrixClient } from "../client";

export class MediaManager {
    constructor(private client: MatrixClient) {}

    /**
     * Upload content
     */
    public uploadContent(file: any, opts?: any): Promise<any> {
        return (this.client as any).http.uploadContent(file, opts);
    }

    /**
     * Cancel an upload
     */
    public cancelUpload(upload: Promise<any>): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.cancelUpload(upload);
    }

    /**
     * Get current uploads
     */
    public getCurrentUploads(): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.getCurrentUploads();
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
