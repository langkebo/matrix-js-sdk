/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Push Rules Manager - 推送规则管理
 * 
 * 提供推送规则相关功能
 */

import { MatrixClient } from "../client";
import { IPushRules } from "../@types/PushRules";

export interface IPushRule {
    rule_id: string;
    default?: boolean;
    enabled?: boolean;
    pattern?: string;
    conditions?: Array<{
        kind: string;
        key?: string;
        pattern?: string;
        is?: string;
    }>;
    actions?: Array<string | Record<string, unknown>>;
}

export interface ISetPushRuleBody {
    pattern?: string;
    conditions?: Array<{
        kind: string;
        key?: string;
        pattern?: string;
        is?: string;
    }>;
    actions?: Array<string | Record<string, unknown>>;
}

export class PushRulesManager {
    constructor(private client: MatrixClient) {}

    public async getPushRules(): Promise<IPushRules> {
        return (this.client as unknown as {
            getPushRules: () => Promise<IPushRules>;
        }).getPushRules();
    }

    public async getPushRule(kind: string, ruleId: string): Promise<IPushRule | null> {
        return (this.client as unknown as {
            getPushRule: (kind: string, ruleId: string) => Promise<IPushRule | null>;
        }).getPushRule(kind, ruleId);
    }

    public async setPushRule(kind: string, ruleId: string, body: ISetPushRuleBody): Promise<void> {
        return (this.client as unknown as {
            setPushRule: (kind: string, ruleId: string, body: ISetPushRuleBody) => Promise<void>;
        }).setPushRule(kind, ruleId, body);
    }

    public async deletePushRule(kind: string, ruleId: string): Promise<void> {
        return (this.client as unknown as {
            deletePushRule: (kind: string, ruleId: string) => Promise<void>;
        }).deletePushRule(kind, ruleId);
    }

    public async enablePushRule(kind: string, ruleId: string, enabled: boolean): Promise<void> {
        return (this.client as unknown as {
            enablePushRule: (kind: string, ruleId: string, enabled: boolean) => Promise<void>;
        }).enablePushRule(kind, ruleId, enabled);
    }

    public getPushRulesCached(): IPushRules | null {
        return (this.client as unknown as { pushRules?: IPushRules }).pushRules ?? null;
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getPushRulesManager(): PushRulesManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPushRulesManager = function (): PushRulesManager {
        return new PushRulesManager(this);
    };
}

export default extendMatrixClient;
