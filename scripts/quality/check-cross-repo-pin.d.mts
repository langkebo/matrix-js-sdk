/**
 * 跨仓 pin 门禁（`check-cross-repo-pin.mjs`）的公开形状。
 *
 * 只有 `CHECKS` 与 `evaluatePin` 被导出：前者是四条绑定的清单，后者是纯函数式判定，
 * 便于用负向测试钉住"测不到（unknown）≠ 不一致（drift）"这一区分（F-C1-02）。
 */

export type PinCheckStatus = "ok" | "drift" | "waived" | "expired-waiver" | "unknown";

export interface PinCheck {
    /** 绑定标识，如 `sdk_commit` / `ledger_schema`。 */
    key: string;
    /** 人类可读的绑定描述（直接用于门禁输出）。 */
    label: string;
    /** `Tjg/meta/sdk-pin.json` 里对应的字段名。 */
    pinField: string;
}

export interface PinCheckResult extends PinCheck {
    expected: string;
    actual: string;
    status: PinCheckStatus;
    note: string;
}

/** 有意、限时豁免的漂移；`expires` 过期即失败。 */
export interface PinWaiver {
    check: string;
    reason: string;
    /** `YYYY-MM-DD` */
    expires: string;
}

/** 四条绑定的清单，顺序即报告顺序。 */
export const CHECKS: PinCheck[];

export interface EvaluatePinInput {
    /** `Tjg/meta/sdk-pin.json` 的内容（缺字段即视为读不到）。 */
    pin: {
        sdk_commit?: string;
        synapse_rust_commit?: string;
        tarball_sha256?: string;
        ledger_schema?: string;
    } | null;
    sdkHead: string;
    backendHead: string;
    tarballSha: string;
    /** SDK 侧 `LEDGER_SCHEMA_VERSION`；读不到时传 `""`。 */
    sdkLedgerSchema: string;
    /** 后端侧 `pub const SCHEMA_VERSION`；读不到时传 `""`。 */
    backendSchemaVersion: string;
    waivers: PinWaiver[];
    today?: Date;
}

/**
 * 比对 pin 与兄弟仓库。
 *
 * `ledger_schema` 这条绑定的判定区分三种情况：三处都能读到且一致 → `ok`；三处都能读到
 * 但有分歧 → `drift`；**任一处读不到 → `unknown`**（不得报成 `drift`）。
 */
export function evaluatePin(input: EvaluatePinInput): PinCheckResult[];
