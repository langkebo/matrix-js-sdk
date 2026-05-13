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
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface ScanResult {
    url: string;
    status: "clean" | "threat" | "unknown";
    threat_type?: string;
}

export interface ScanStatus {
    enabled: boolean;
    last_scan: number;
    total_scanned: number;
}

export interface ContentScanManagerEvents {
    content_scanned: { urls: string[]; results: ScanResult[] };
    threat_detected: { url: string; threatType: string };
}

export class ContentScanManager extends BaseManager<keyof ContentScanManagerEvents, ContentScanManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async scanContent(urls: string[], threatType?: string): Promise<ScanResult[]> {
        return this.withRetry(async () => {
            const path = "/v1/moderation/scan";
            const result = await this.client.http.authedRequest<ScanResult[]>(Method.Post, path, undefined, {
                urls,
                threat_type: threatType,
            });
            return result;
        }, "scanContent");
    }

    public async getScanStatus(): Promise<ScanStatus> {
        return this.withRetry(async () => {
            const path = "/v1/moderation/scan/status";
            return this.client.http.authedRequest<ScanStatus>(Method.Get, path);
        }, "getScanStatus");
    }

    public async isContentScanned(contentUrl: string): Promise<boolean> {
        try {
            await this.scanContent([contentUrl]);
            return true;
        } catch {
            return false;
        }
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getContentScanManager(): ContentScanManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getContentScanManager = function (): ContentScanManager {
        return getOrCreateManager(this, "contentScan", () => new ContentScanManager(this));
    };
}

export default extendMatrixClient;
