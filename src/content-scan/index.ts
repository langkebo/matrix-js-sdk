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
 * Content Scan Manager - 内容扫描管理
 * 
 * 提供内容扫描功能
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";

export class ContentScanManager {
    constructor(private client: MatrixClient) {}

    /**
     * Scan content
     */
    public async scanContent(urls: string[], threatType?: string): Promise<any> {
        const path = "/v1/moderation/scan";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Post, path, undefined, { urls, threat_type: threatType });
    }

    /**
     * Get scan status
     */
    public async getScanStatus(): Promise<any> {
        const path = "/v1/moderation/scan/status";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).http.authedRequest(Method.Get, path);
    }

    /**
     * Check if content is scanned
     */
    public async isContentScanned(contentUrl: string): Promise<boolean> {
        try {
            await this.scanContent([contentUrl]);
            return true;
        } catch {
            return false;
        }
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getContentScanManager(): ContentScanManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getContentScanManager = function (): ContentScanManager {
        return new ContentScanManager(this);
    };
}

export default extendMatrixClient;
