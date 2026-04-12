import { type IPushRule, type IPushRules, PushRuleActionName, PushRuleKind } from "./@types/PushRules.ts";

type Scope = "global" | "device";

interface PushManagerLike {
    deletePushRule(scope: Scope, kind: PushRuleKind, ruleId: string): Promise<unknown>;
    createPushRule(
        scope: Scope,
        kind: PushRuleKind,
        ruleId: string,
        body: { actions: PushRuleActionName[] },
    ): Promise<unknown>;
    getPushRules(): Promise<IPushRules>;
}

export function getRoomPushRuleRequest(
    pushRules: IPushRules | undefined,
    scope: Scope,
    roomId: string,
): IPushRule | undefined {
    if (pushRules) {
        return pushRules[scope]?.room?.find((rule) => rule.rule_id === roomId);
    }
    throw new Error("SyncApi.sync() must be done before accessing to push rules.");
}

export function setRoomMutePushRuleRequest(
    scope: Scope,
    roomId: string,
    mute: boolean,
    roomPushRule: IPushRule | undefined,
    getPushManager: () => PushManagerLike,
    setPushRules: (rules: IPushRules) => void,
): Promise<void> | undefined {
    let promise: Promise<unknown> | undefined;
    let hasDontNotifyRule = false;

    if (roomPushRule?.actions.includes(PushRuleActionName.DontNotify)) {
        hasDontNotifyRule = true;
    }

    if (!mute) {
        if (hasDontNotifyRule) {
            promise = getPushManager().deletePushRule(scope, PushRuleKind.RoomSpecific, roomPushRule!.rule_id);
        }
    } else if (!roomPushRule) {
        promise = getPushManager().createPushRule(scope, PushRuleKind.RoomSpecific, roomId, {
            actions: [PushRuleActionName.DontNotify],
        });
    } else if (!hasDontNotifyRule) {
        // Workaround for SYN-590 (Push rule update fails): delete then recreate.
        const doneResolvers = Promise.withResolvers<void>();
        getPushManager()
            .deletePushRule(scope, PushRuleKind.RoomSpecific, roomPushRule.rule_id)
            .then(() => {
                getPushManager()
                    .createPushRule(scope, PushRuleKind.RoomSpecific, roomId, {
                        actions: [PushRuleActionName.DontNotify],
                    })
                    .then(() => {
                        doneResolvers.resolve();
                    })
                    .catch((err) => {
                        doneResolvers.reject(err);
                    });
            })
            .catch((err) => {
                doneResolvers.reject(err);
            });
        promise = doneResolvers.promise;
    }

    if (promise) {
        return new Promise<void>((resolve, reject) => {
            promise!
                .then(() => {
                    getPushManager()
                        .getPushRules()
                        .then((result) => {
                            setPushRules(result);
                            resolve();
                        })
                        .catch((err) => {
                            reject(err);
                        });
                })
                .catch((err: Error) => {
                    getPushManager()
                        .getPushRules()
                        .then((result) => {
                            setPushRules(result);
                            reject(err);
                        })
                        .catch(() => {
                            reject(err);
                        });
                });
        });
    }
    return undefined;
}
