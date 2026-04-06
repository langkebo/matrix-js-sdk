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

export interface UrlPreview {
    url?: string;
    title?: string;
    description?: string;
    image_url?: string;
    image?: string;
    og_image?: string;
    "matrix:image"?: string;
}

export class MediaManager {
    constructor(private client: MatrixClient) {}

    /**
     * Upload content
     */
    public uploadContent(file: any, opts?: any): Promise<any> {
        return (this.client as any).http.uploadContent(file, opts);
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
            `/media/upload/${serverName}/${mediaId}`,
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

    /**
     * Delete media
     * POST /_matrix/media/v1/delete/{server_name}/{media_id}
     */
    public async deleteMedia(serverName: string, mediaId: string): Promise<void> {
        await this.client.http.authedRequest(
            Method.Post,
            `/media/delete/${serverName}/${mediaId}`,
            undefined,
            undefined,
            { prefix: MediaPrefix.V1 },
        );
    }

    /**
     * Get URL preview
     * GET /_matrix/media/v1/preview_url
     */
    public async previewUrl(url: string, ts?: number): Promise<UrlPreview> {
        const params: Record<string, any> = { url };
        if (ts !== undefined) {
            params.ts = ts;
        }

        return this.client.http.authedRequest<UrlPreview>(
            Method.Get,
            "/media/preview_url",
            params,
            undefined,
            { prefix: MediaPrefix.V1 },
        );
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
