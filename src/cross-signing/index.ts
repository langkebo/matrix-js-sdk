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
 * Cross Signing Manager - 交叉签名管理
 *
 * 提供 cross-signing 功能
 */

import { MatrixClient } from "../client";
import { BaseManager } from "../managers/base-manager";
import { getOrCreateManager } from "../client-infra/manager-registry";

export interface CrossSigningStatus {
    crossSigningVerified: boolean;
    crossSigningVerifiedBefore: boolean;
    crossSigningTrusted: boolean;
}

export interface CrossSigningKeys {
    masterKey: string | null;
    selfSigningKey: string | null;
    userSigningKey: string | null;
}

export interface UserCrossSigningKeys {
    masterKey: string | null;
    selfSigningKey: string | null;
    userSigningKey: string | null;
    verified: boolean;
}

export interface CrossSigningManagerEvents {
    cross_signing_ready: void;
    cross_signing_updated: { userId: string };
    cross_signing_trusted: { userId: string };
}

export class CrossSigningManager extends BaseManager<keyof CrossSigningManagerEvents, CrossSigningManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public async checkCrossSigningStatus(): Promise<CrossSigningStatus> {
        return this.withRetry(
            () => this.client.checkCrossSigningStatus() as Promise<CrossSigningStatus>,
            "checkCrossSigningStatus",
        );
    }

    public async getCrossSigningKeys(): Promise<CrossSigningKeys> {
        return this.withRetry(
            () => this.client.getCrossSigningKeys() as Promise<CrossSigningKeys>,
            "getCrossSigningKeys",
        );
    }

    public isCrossSigningReady(): boolean {
        return this.client.isCrossSigningReady();
    }

    public async getUserCrossSigningKeys(userId: string): Promise<UserCrossSigningKeys> {
        return this.withRetry(
            () => this.client.getUserCrossSigningKeys(userId) as Promise<UserCrossSigningKeys>,
            "getUserCrossSigningKeys",
        );
    }

    public async checkAndTrustCrossSigning(): Promise<void> {
        return this.withRetry(
            () => this.client.checkAndTrustCrossSigning() as Promise<void>,
            "checkAndTrustCrossSigning",
        );
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getCrossSigningManager(): CrossSigningManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCrossSigningManager = function (): CrossSigningManager {
        return getOrCreateManager(this, "crossSigning", () => new CrossSigningManager(this));
    };
}

export default extendMatrixClient;
