/**
 * `check-wire-format.mjs` 的类型声明（只声明导出给 spec 用的纯函数）。
 *
 * 本仓惯例：vitest 走真实 .mjs、tsc 走本声明文件，两者必须同步。
 */

/** 按顶层逗号切分对象字面量内部文本（嵌套 `{}`/`[]`/`()` 与字符串里的逗号不切）。 */
export function splitTopLevelObjectProps(inner: string): string[];

/**
 * 剥掉一段文本里的 TS 注释，**保留字符串与模板字面量的内容**（`path: "/a//b"` 不受影响）。
 * 属性块必须先过它再判形态，否则「注释紧贴某属性」会让该属性整块被当注释丢掉：
 * 粘 `method`/`path` ⇒ 调用点被静默丢弃；粘 `body`/`queryParams` ⇒ 被读成「确定不发」。
 */
export function stripCommentsInChunk(text: string): string;

/**
 * 用**本门禁的** `normalizePath` 重建后端路由 key。
 *
 * 存在的唯一理由：仓里有两个 `normalizePath` 实现，占位符大小写（`{x}` vs `{X}`）
 * 与尾斜杠处理（保留 vs 去掉）都不同。不做这一步，含动态段的路由两侧 key 永远不相等，
 * 会静默落进 `route-contract-unavailable`。
 */
export function gateRouteKey(route: string): string;

/**
 * 台账 `entries`（后端收集器拼写）→ 门禁 key 空间。读取侧必经此步：
 * 否则漂移比较把每条动态段路由误报成 `backend-route-new`，且 CI 半场（`effective = 台账`）
 * 的动态段调用点静默失去可比性。幂等（`--refresh` 写出的已是门禁拼写）。
 */
/**
 * 门禁的路径归一化 = 共享 `normalizePath` + **保留尾斜杠**。
 *
 * `/a/` 与 `/a` 在 Matrix 里是两条不同路由（`state/{event_type}/` 表示 state key 为空，
 * 由另一个处理器服务、契约不同），共享 `normalizePath` 去尾斜杠会把它们折叠。
 * 后端 key / manifest key / SDK 候选 key **三侧都要走它**。
 */
export function wirePathKey(rawPath: string): string;

export function rebaseLedgerKeys(entries: Record<string, unknown> | undefined | null): Map<string, unknown>;

/**
 * 把「后端路由 → 契约」按门禁 key 折叠，并把折叠显式化。
 *
 * 门禁的 `normalizePath` 会去尾斜杠 ⇒ 后端把同一处理器注册在 `GET /pushers` 与
 * `GET /pushers/` 两条上时，门禁里**永远无法区分**。契约逐字段相同 ⇒ 折叠无害；
 * 契约不同 ⇒ 必须报错（`Map.set` 会让后写者静默胜出 = 用错契约校验调用点）。
 */
export function collapseContractEntries(routeEntries: Array<[string, unknown]>): {
    entries: Map<string, unknown>;
    collapsedIdentical: Array<{ key: string; routes: string[] }>;
    conflicts: Array<{ key: string; routes: string[] }>;
};

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

/** waiver 是否**指向**该违规（`kind`+`route` 一致，`file` 给出时再要求一致）。**不含过期判断。** */
export function waiverMatch(
    w: { kind: string; route: string; file?: string; expires?: string },
    v: { kind: string; route: string; file: string },
): boolean;

/** waiver 是否覆盖该违规：`kind`+`route` 一致，`file` 给出时再要求一致；过期即不覆盖。 */
export function waiverCovers(
    waivers: Array<{ kind: string; route: string; file?: string; expires?: string }>,
    v: { kind: string; route: string; file: string },
    today: string,
): boolean;
