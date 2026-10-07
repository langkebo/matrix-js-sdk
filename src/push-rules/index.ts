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
import { type IPushRule as MatrixPushRule, type IPushRules, PushRuleKind } from "../@types/PushRules";
import { type IUpdatePushRuleRequest } from "../push";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

/**
 * 权威推送规则形状（`@types/PushRules`）。
 *
 * 此前本文件自己抄了一份 `IPushRule`：`default` / `enabled` 写成可选、
 * `actions` 写成 `Array<string | Record<string, unknown>>`。后端响应里
 * `default` / `enabled` 恒存在，`PushManager` 也用权威类型 —— 两份 DTO
 * 并存过。现直接别名，不再各写一份。
 */
export type IPushRule = MatrixPushRule;

/** 设置推送规则的请求体，对齐 `PushManager.updatePushRule` 的入参。 */
export type ISetPushRuleBody = IUpdatePushRuleRequest;

/**
 * 本模块操作的是**用户自己的**推送规则，故 scope 固定 `global`
 * （`PushManager` 的每个方法都要求显式 scope，`device` 语义由调用方自取）。
 */
const PUSH_RULE_SCOPE = "global";

export interface PushRulesManagerEvents {
    push_rules_updated: { rules: IPushRules };
    push_rule_added: { kind: string; ruleId: string };
    push_rule_deleted: { kind: string; ruleId: string };
}

export class PushRulesManager extends BaseManager<keyof PushRulesManagerEvents, PushRulesManagerEvents> {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    // 全部委托给 `PushManager`（`src/push/index.ts`）—— 它才是推送规则的**唯一实**现，
    // 含完整路径（`/_matrix/client/v3/pushrules/{scope}/{kind}/{rule_id}`）、参数校验、
    // 缓存失效与事件上报。本模块此前逐个转发 `this.client.getPushRules()` 等
    // **运行时并不存在**的方法 ⇒ 调用即 TypeError（类型表却声明了它们）。
    // 委托后不再套 `withRetry`：PushManager 内部已经重试，套两层只会让重试次数平方级放大。

    public async getPushRules(): Promise<IPushRules> {
        return this.client.getPushManager().getPushRules();
    }

    public async getPushRule(kind: PushRuleKind, ruleId: string): Promise<IPushRule | null> {
        return this.client.getPushManager().getPushRule(PUSH_RULE_SCOPE, kind, ruleId);
    }

    public async setPushRule(kind: PushRuleKind, ruleId: string, body: ISetPushRuleBody): Promise<void> {
        return this.client.getPushManager().updatePushRule(PUSH_RULE_SCOPE, kind, ruleId, body);
    }

    public async deletePushRule(kind: PushRuleKind, ruleId: string): Promise<void> {
        return this.client.getPushManager().deletePushRule(PUSH_RULE_SCOPE, kind, ruleId);
    }

    public async enablePushRule(kind: PushRuleKind, ruleId: string, enabled: boolean): Promise<void> {
        return this.client.getPushManager().setPushRuleEnabled(PUSH_RULE_SCOPE, kind, ruleId, enabled);
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
