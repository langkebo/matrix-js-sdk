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
 * Push Rules Manager - 推送规则管理
 *
 * 提供推送规则相关功能
 */

import { MatrixClient } from "../client";
import { IPushRules } from "../@types/PushRules";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

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
    actions?: Array<string | Record<string, unknown>>; // Dynamic: push rule actions can be tweaks
}

export interface ISetPushRuleBody {
    pattern?: string;
    conditions?: Array<{
        kind: string;
        key?: string;
        pattern?: string;
        is?: string;
    }>;
    actions?: Array<string | Record<string, unknown>>; // Dynamic: push rule actions can be tweaks
}

export interface PushRulesManagerEvents {
    push_rules_updated: { rules: IPushRules };
    push_rule_added: { kind: string; ruleId: string };
    push_rule_deleted: { kind: string; ruleId: string };
}

export class PushRulesManager extends BaseManager<keyof PushRulesManagerEvents, PushRulesManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async getPushRules(): Promise<IPushRules> {
        return this.withRetry(() => this.client.getPushRules(), "getPushRules");
    }

    public async getPushRule(kind: string, ruleId: string): Promise<IPushRule | null> {
        return this.withRetry(() => this.client.getPushRule(kind, ruleId), "getPushRule");
    }

    public async setPushRule(kind: string, ruleId: string, body: ISetPushRuleBody): Promise<void> {
        return this.withRetry(() => this.client.setPushRule(kind, ruleId, body), "setPushRule");
    }

    public async deletePushRule(kind: string, ruleId: string): Promise<void> {
        return this.withRetry(() => this.client.deletePushRule(kind, ruleId), "deletePushRule");
    }

    public async enablePushRule(kind: string, ruleId: string, enabled: boolean): Promise<void> {
        return this.withRetry(() => this.client.enablePushRule(kind, ruleId, enabled), "enablePushRule");
    }

    public getPushRulesCached(): IPushRules | null {
        return this.client.pushRules ?? null;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getPushRulesManager = function (): PushRulesManager {
        registerManagerClass("pushRules", PushRulesManager);
        return getOrCreateManager(this, "pushRules", () => new PushRulesManager(this));
    };
}

export default extendMatrixClient;
