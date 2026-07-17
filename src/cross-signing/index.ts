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
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";
import { CrossSigningKey } from "../crypto-api";

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
    cross_signing_ready: () => void;
    cross_signing_updated: (data: { userId: string }) => void;
    cross_signing_trusted: (data: { userId: string }) => void;
}

export class CrossSigningManager extends BaseManager<keyof CrossSigningManagerEvents, CrossSigningManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async checkCrossSigningStatus(): Promise<CrossSigningStatus> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) {
                return {
                    crossSigningVerified: false,
                    crossSigningVerifiedBefore: false,
                    crossSigningTrusted: false,
                };
            }
            const status = await crypto.getCrossSigningStatus();
            const userId = this.client.getUserId();
            let crossSigningVerified = false;
            let crossSigningVerifiedBefore = false;
            if (userId) {
                const verificationStatus = await crypto.getUserVerificationStatus(userId);
                crossSigningVerified = verificationStatus.isCrossSigningVerified();
                crossSigningVerifiedBefore = verificationStatus.wasCrossSigningVerified();
            }
            return {
                crossSigningVerified,
                crossSigningVerifiedBefore,
                crossSigningTrusted: status.publicKeysOnDevice,
            };
        }, "checkCrossSigningStatus");
    }

    public async getCrossSigningKeys(): Promise<CrossSigningKeys> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) {
                return { masterKey: null, selfSigningKey: null, userSigningKey: null };
            }
            const [masterKey, selfSigningKey, userSigningKey] = await Promise.all([
                crypto.getCrossSigningKeyId(CrossSigningKey.Master),
                crypto.getCrossSigningKeyId(CrossSigningKey.SelfSigning),
                crypto.getCrossSigningKeyId(CrossSigningKey.UserSigning),
            ]);
            return { masterKey, selfSigningKey, userSigningKey };
        }, "getCrossSigningKeys");
    }

    public async isCrossSigningReady(): Promise<boolean> {
        const crypto = this.client.getCrypto();
        if (!crypto) return false;
        return crypto.isCrossSigningReady();
    }

    public async getUserCrossSigningKeys(userId: string): Promise<UserCrossSigningKeys> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) {
                return { masterKey: null, selfSigningKey: null, userSigningKey: null, verified: false };
            }
            const [hasKeys, verificationStatus] = await Promise.all([
                crypto.userHasCrossSigningKeys(userId),
                crypto.getUserVerificationStatus(userId),
            ]);
            return {
                masterKey: hasKeys ? await crypto.getCrossSigningKeyId(CrossSigningKey.Master) : null,
                selfSigningKey: hasKeys ? await crypto.getCrossSigningKeyId(CrossSigningKey.SelfSigning) : null,
                userSigningKey: hasKeys ? await crypto.getCrossSigningKeyId(CrossSigningKey.UserSigning) : null,
                verified: verificationStatus.isCrossSigningVerified(),
            };
        }, "getUserCrossSigningKeys");
    }

    public async checkAndTrustCrossSigning(): Promise<void> {
        return this.withRetry(async () => {
            const crypto = this.client.getCrypto();
            if (!crypto) return;
            await crypto.bootstrapCrossSigning({});
        }, "checkAndTrustCrossSigning");
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getCrossSigningManager = function (): CrossSigningManager {
        registerManagerClass("crossSigning", CrossSigningManager);
        return getOrCreateManager(this, "crossSigning", () => new CrossSigningManager(this));
    };
}
