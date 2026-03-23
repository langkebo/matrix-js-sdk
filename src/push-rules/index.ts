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

export class PushRulesManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get push rules
     */
    public async getPushRules(): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPushRules();
    }

    /**
     * Get push rule
     */
    public async getPushRule(kind: string, ruleId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).getPushRule(kind, ruleId);
    }

    /**
     * Set push rule
     */
    public async setPushRule(kind: string, ruleId: string, body: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).setPushRule(kind, ruleId, body);
    }

    /**
     * Delete push rule
     */
    public async deletePushRule(kind: string, ruleId: string): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).deletePushRule(kind, ruleId);
    }

    /**
     * Enable push rule
     */
    public async enablePushRule(kind: string, ruleId: string, enabled: boolean): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).enablePushRule(kind, ruleId, enabled);
    }

    /**
     * Get all push rules
     */
    public getPushRulesCached(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).pushRules;
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
