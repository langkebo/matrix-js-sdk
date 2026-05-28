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
 * URL Preview Manager - URL预览管理
 *
 * Provides methods for URL preview
 * This manager is now integrated into MatrixClient via getUrlPreviewManager()
 */

import { MatrixClient } from "../client";
import { type IPreviewUrlResponse } from "../client-api-types";
import { getOrCreateManager } from "../client-infra/manager-registry";

export class UrlPreviewManager {
    private client: MatrixClient;

    public constructor(client: MatrixClient) {
        this.client = client;
    }

    /**
     * Get URL preview
     * @param url - The URL to preview
     * @param timestamp - Optional timestamp for scrying
     */
    public async getUrlPreview(url: string, timestamp?: number): Promise<IPreviewUrlResponse> {
        return this.client.getUrlPreview(url, timestamp ?? 0);
    }

    /**
     * Clear URL preview cache
     */
    public clearUrlPreviewCache(): void {
        this.client.urlPreviewCache.clear();
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getUrlPreviewManager(): UrlPreviewManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getUrlPreviewManager = function (): UrlPreviewManager {
        return getOrCreateManager(this, "urlPreview", () => new UrlPreviewManager(this));
    };
}

export default extendMatrixClient;
