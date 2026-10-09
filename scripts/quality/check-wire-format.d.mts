/**
 * `check-wire-format.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 按顶层逗号切分对象字面量内部文本（嵌套 `{}`/`[]`/`()` 与字符串里的逗号不切）。 */
export function splitTopLevelObjectProps(inner: string): string[];

/**
 * 从对象字面量取顶层键集。fail-closed：`keys === null` 表示判不出来（`reason` 给出原因），
 * **绝不返回半份键集**。
 */
export function objectLiteralKeys(text: string): { keys: string[] | null; reason: string | null };

/**
 * 找 `const <name> = <对象字面量>` 绑定（只看对象；path-contract 的 `findLocalConstBinding`
 * 要求 RHS 解得成**路径**，拿来解键集恒为 null）。
 * fail-closed：文件里出现多于一处同名绑定则返回 `null`（宁可不判，也不能拿另一个同名绑定比对）。
 */
export function findConstObjectBinding(source: string, callIndex: number, name: string): string | null;

/**
 * 把实参表达式解析成键集：对象字面量 / 指向 `const` 绑定的裸标识符。
 * `undefined`/`null` ⇒ `keys: []`（确定不发）；`expr === null` ⇒ `keys: null`（位置不可知）。
 */
export function resolveKeySet(
    expr: string | null,
    source: string,
    callIndex: number,
): { keys: string[] | null; reason: string | null };

/** 抽「对象字面量形态」的包装器调用（`this.request({ method: Method.X, path, body, … })`）。 */
export function extractObjectFormCalls(
    source: string,
    relFile: string,
    options?: { identityHelpers?: Map<string, unknown> | null; templateBuilders?: Map<string, string> | null },
): {
    calls: Array<{
        method: string;
        pathRaw: string;
        prefixExpr: string | null;
        wrapper: string;
        line: number;
        queryArg: string | null;
        bodyArg: string | null;
        form: "object";
        callIndex: number;
    }>;
    unchecked: Array<{ file: string; line: number; wrapper: string; expr: string }>;
};

/** 后端某条路由的请求契约；`null` = 不可知。 */
export interface BackendSide {
    type: string;
    declared: string[];
    required: string[];
    denyUnknown?: boolean;
    opaque?: boolean;
}

export interface BackendRoute {
    handler: string;
    hasJson: boolean;
    hasQuery: boolean;
    body: BackendSide | null;
    query: (BackendSide & { denyUnknown: boolean }) | null;
}

/**
 * 「已解析到路由 + 键集」的调用点 与 后端契约 对账（纯函数）。
 * 判据：SDK 键集 ⊇ 后端必填集；后端 `deny_unknown_fields` 时再加 SDK 键集 ⊆ 已声明集；
 * 后端无 `Json` 提取器而 SDK 传了非空 body ⇒ `body-sent-ignored`。
 */
export function classifyWire(input: { calls: object[]; backend: Map<string, BackendRoute> }): {
    violations: Array<{ kind: string; route: string; file: string; line: number; [k: string]: unknown }>;
    unresolved: Array<{ kind: string; route: string; file: string; line: number; [k: string]: unknown }>;
    comparable: Array<{ kind?: string; route: string; file: string; line: number; [k: string]: unknown }>;
};

/** 覆盖桶计数（`kind` 或 `kind:side`）。 */
export function countBuckets(unresolved: object[]): Record<string, number>;

/** 覆盖率棘轮判据：观测相对基线「变多」的桶（只准降）。 */
export function diffBuckets(
    baseline: Record<string, number>,
    observed: Record<string, number>,
): Array<{ kind: string; baseline: number; observed: number }>;

/** 违规项的稳定键（`kind|route|file`）。 */
export function violationKey(v: { kind: string; route: string; file: string }): string;

/** waiver 是否覆盖该违规：`kind`+`route` 一致，`file` 给出时再要求一致；过期即不覆盖。 */
export function waiverCovers(
    waivers: Array<{ kind: string; route: string; file?: string; expires?: string }>,
    v: { kind: string; route: string; file: string },
    today: string,
): boolean;
