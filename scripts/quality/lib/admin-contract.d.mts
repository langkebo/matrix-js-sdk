/**
 * `scripts/quality/lib/admin-contract.mjs` 的类型声明。
 *
 * admin 面「响应/请求形状」契约门禁（`check-admin-response-contract.mjs`）的核心抽取器。
 * spec 直接 import 真实 `.mjs` 运行，本声明只给 `tsc` 走类型用。
 */

/** 后端一个路由的契约信息。 */
export interface RustRouteContract {
    /** 路由注册时的原始路径（未归一） */
    rawRoute: string;
    /** 相对扫描根的源文件路径 */
    file: string;
    /** 处理器函数名 */
    handler: string;
    /** 各分支「返回位置」`json!` 的第一层键；`null` 表示无法判定（非对象字面量/先算后组装） */
    responseVariants: string[][] | null;
    /**
     * 各返回分支的**响应形状**（严格结论：任一分支判不出来就是 `null`）。
     *
     * `object` 给出 JSON 键集；`array` 表示顶层是数组，`item` / `itemKeys` 为元素类型信息。
     */
    responseShapes: Array<
        { kind: "object"; keys: string[] } | { kind: "array"; item: string | null; itemKeys: string[] | null }
    > | null;
    /** Query / Path / Json 提取器（只看参数表，不看返回类型） */
    io: {
        hasQuery: boolean;
        hasPath: boolean;
        hasJson: boolean;
        queryType: string | null;
        pathType: string | null;
        jsonType: string | null;
    };
    /**
     * 请求体形状：`Json<T>` 的 T 是带 `Deserialize` 的 struct 时记它的字段集；
     * 处理器是 `Json<Value>` + 手工 `body.get("k")` 时记**实际读到的键集**
     * （`manualRead: true`）；两者都判不出来时为 `null`（未知桶）。
     */
    bodyStruct: {
        name: string;
        fields: string[];
        /** 缺席也不会让反序列化失败的键（`Option<T>` / `#[serde(default)]`） */
        optional: string[];
        /** `#[serde(skip*)]` 的键（不是线上键） */
        ignored: string[];
        denyUnknownFields: boolean;
        /** 键集来自"处理器读了哪些键"，不是 struct 定义 */
        manualRead?: boolean;
        /** 键集不闭合（`flatten` / 改不出键的 `rename_all`） */
        opaque: boolean;
    } | null;
    /** 同一路由被多个处理器注册时的其余条目 */
    merged?: RustRouteContract[];
}

/** 后端契约汇总。 */
export interface RustAdminContract {
    byRoute: Map<string, RustRouteContract>;
    files: string[];
    stats: {
        fileCount: number;
        /** 响应形状下沉目录（storage / common / services）里扫到的文件数 */
        sinkFileCount?: number;
        handlerCount: number;
        responseKnown: number;
        requestKnown: number;
        structCount: number;
        ambiguous: number;
    };
}

/** SDK 侧一个请求调用点。 */
export interface SdkCallSite {
    file: string;
    managerMethod: string;
    declaredReturn: string | null;
    typeArg: string | null;
    /** 调用点是否**原样返回**（`return [await] this.adminRequest(..);`）—— 决定声明返回类型能否当线格式声明 */
    directReturn: boolean;
    httpMethod: string;
    /** `METHOD /归一化路径` */
    route: string;
    argCount: number;
    hasQueryArg: boolean;
    hasBodyArg: boolean;
    /** 方法参数表原文（解析 `payload: X` 的类型用） */
    params?: string;
    /** 方法体原文（解析局部 `const body = {…}` 用） */
    methodBody?: string;
    /** 第 4 实参原文（内联字面量 / `payload ?? {}` / 三元） */
    bodyArg?: string | null;
    /** 本文件自己的类型形状表（跨文件重名时优先） */
    ownShapes?: Map<string, TsTypeShape>;
}

/** SDK 契约汇总。 */
export interface SdkAdminContract {
    callSites: SdkCallSite[];
    fields: Map<string, string[]>;
    fieldFiles: Map<string, string>;
    /** 全局类型形状表（跨文件同名不同形时标 `open`，交给调用方按未知处理） */
    typeShapes: Map<string, TsTypeShape>;
    typeShapeFiles: Map<string, string>;
    /** 按文件的形状表（TS 解析是按模块的，重名时本文件优先） */
    typeShapesByFile: Map<string, Map<string, TsTypeShape>>;
    files: string[];
    stats: { fileCount: number; methodsScanned: number; callSiteCount: number; interfaceCount: number };
}

/** TS 侧一个类型的一层形状。 */
export interface TsTypeShape {
    fields: string[];
    /** 带 `?` 的字段（请求体必填/可选判定要用） */
    optionalFields: string[];
    /** 键集不闭合（索引签名 / 映射类型 / 联合 / 展开 …） */
    open: boolean;
    /** 字段 → 类型文本（C4 的值类别归一化用；非判定字段） */
    valueTypes?: Map<string, string>;
    /** 字段 → 值类别（C4「嵌套形状」用；非判定字段） */
    valueKinds?: Map<string, ValueKind>;
}

/** 值类别词表（Rust json! 值 与 TS 类型共用；`union` 仅 TS 侧出现）。 */
export type ValueKind =
    | "object"
    | "array"
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "undefined"
    | "union"
    | "unknown";

/** 解析一段**表达式**（请求体实参）得到字段集；判不出来返回 `null`。 */
export function resolveSdkRequestShape(input: {
    params?: string;
    bodyArg?: string | null;
    methodBody?: string;
    shapes?: Map<string, TsTypeShape>;
    ownShapes?: Map<string, TsTypeShape>;
}): { fields: string[]; optionalFields: string[] } | null;

/** TS 字段类型的值类别归一化（fail-closed：认不出为 `unknown`）。 */
export function valueKindOfTsType(text: string, typeKinds?: Map<string, ValueKind>): ValueKind;

/** Rust `json!` 值文本的值类别归一化（fail-closed：认不出为 `unknown`）。 */
export function valueKindOfRustValue(text: string): ValueKind;

/** 取 `json!({…})` 的第一层「键 → 值文本」；`null` = 非对象字面量（形状不可知）。 */
export function jsonMacroTopLevelEntries(src: string, jsonBangIndex: number): Map<string, string> | null;

/** 索引 TS 类型形状（`interface` / `type X = {…}` / `type X = Y` / 工具类型别名）。 */
export function extractTsTypeShapes(src: string): Map<string, TsTypeShape>;

/** 解析 `Json<Value>` 型请求体读了哪些键（fail-closed：变量有别的用法就返回 `null`）。 */
export function extractJsonValueBodyKeys(fn: {
    sig: string;
    body: string;
    io: { hasJson: boolean; jsonType: string | null };
}): { keys: string[]; required: string[] } | null;

/** 去掉 Rust 的 `//` 与块注释，保留字符串字面量内容。 */
export function stripRustComments(src: string): string;

/** 从开括号开始按括号配对取片段（跳过字符串/字符/模板字面量与行注释）。 */
export function balancedSlice(src: string, start: number): { text: string; end: number } | null;

/** 按深度 0 的逗号切分实参列表文本（不含外层括号）。 */
export function splitTopLevelArgs(text: string): string[];

/** 取 Rust 对象字面量文本的第一层键 → 值文本。 */
export function parseJsonObjectTopLevel(objectText: string): Map<string, string>;

/**
 * 取 `json!(...)` 的第一层键。
 *
 * @returns `[]` = 空对象字面量；`null` = 参数不是对象字面量（形状不可知）
 */
export function jsonMacroTopLevelKeys(src: string, jsonBangIndex: number): string[] | null;

/** 找出所有 `async fn` 的签名与函数体。 */
export function findRustFunctions(src: string): Array<{ name: string; sig: string; body: string; start: number }>;

/** 抽取「返回位置」的 `json!` 顶层键（每个分支一个变体）；`null` = 不可知。 */
export function extractResponseVariants(fnBody: string): string[][] | null;

/** 抽取带 `Deserialize` 的 struct 字段、可选性、`skip` 键与 `deny_unknown_fields`。 */
export function parseDeserializeStructs(src: string): Map<
    string,
    {
        fields: string[];
        optionalFields: string[];
        ignoredFields: string[];
        denyUnknownFields: boolean;
        flatten: boolean;
    }
>;

/** 索引带 `Serialize` / `Deserialize` 的 struct：JSON 键、Rust 名、可选性、派生列表与 `opaque`。 */
export function parseSerdeStructs(src: string): Map<
    string,
    {
        fields: string[];
        rustFields: string[];
        optionalFields: string[];
        ignoredFields: string[];
        denyUnknownFields: boolean;
        flatten: boolean;
        derives: string[];
        opaque: boolean;
    }
>;

/** 扫描 struct 体，取每个字段的 JSON 键（应用字段级 `#[serde(rename)]`）、Rust 名、可选性与 `skip` 键。 */
export function scanStructFields(bodyText: string): {
    rust: string[];
    json: string[];
    optionalJson: string[];
    ignoredJson: string[];
    flatten: boolean;
    unparsedRename: boolean;
};

/** 取 struct 字面量 `Type { a, b: v }` 的一层字段名；`..spread` 时 `keys` 为 `null`。 */
export function structLiteralShape(text: string): { type: string; keys: string[] | null; spread: boolean } | null;

/** 取 `serde_json::Map` 变量上 `insert("k", ..)` 的顶层键；没有 `insert` 时 `null`。 */
export function collectMapInsertKeys(bodyText: string, varName: string): string[] | null;

/** 在作用域文本里找 `let <name> [: <type>] = <rhs>` 的绑定。 */
export function findLetBinding(bodyText: string, name: string): { type: string | null; rhs: string } | null;

/** 按深度 0 的分隔符切分文本。 */
export function splitTopLevel(text: string, sep: string): string[];

/** 取 Rust 块体的尾表达式（Rust 里函数体尾表达式就是返回值）。 */
export function tailExpression(body: string): string | null;

/** 找函数体里所有 `Ok(Json(<expr>))` 的 `<expr>`（含 `Ok((StatusCode, Json(..)))` 元组形态）。 */
export function extractJsonReturnExprs(fnBody: string): string[];

/** 取 `fn` 签名里的返回类型文本。 */
export function extractReturnType(sig: string): string | null;

/** 找出所有 `fn`（含同步函数）；`topLevel` 只对行首无缩进的定义为真。 */
export function findAllRustFunctions(
    src: string,
): Array<{ name: string; sig: string; body: string; topLevel: boolean; start: number }>;

/** 响应形状。 */
export type ResponseShape = { kind: "object"; keys: string[] } | { kind: "array"; item: string | null };

/** 按深度 0 的逗号切分泛型实参。 */
export function splitGenericArgs(text: string): string[];

/** 把 Rust 类型文本脱壳成 `{name, isArray}`（取**末段**路径名；`dyn`/`impl` 返回 null）。 */
export function unwrapRustType(text: string): { name: string; isArray: boolean } | null;

/** 从 `Arc<dyn Trait>` 里取出特征名（`unwrapRustType` 对 `dyn` 返回 null）。 */
export function unwrapRustTraitType(text: string): { trait: string } | null;

/** 从**返回类型**求值类型（剥 `Result` / `ApiResult` / `Option` 等外壳）。 */
export function typeOfRustReturn(ret: string | null): { name: string; isArray: boolean } | null;

/** 取处理器签名里 `State(<name>): State<<Type>>` 的变量名与类型（链的根）。 */
export function extractStateContext(sig: string): { name: string; type: string } | null;

/** 索引 struct 的字段类型：`structName → (field → typeText)`（同名 struct 字段集不同则整条作废）。 */
export function parseRustStructFieldTypes(src: string): Map<string, Map<string, string> | null>;

/** 索引 `impl` 块里的方法；每个定义带 `selfType` 与 `traitName`（固有方法为 null）。 */
export function parseRustImplMethods(
    src: string,
): Map<
    string,
    Map<string, Array<{ name?: string; ret: string | null; body: string; selfType: string; traitName: string | null }>>
>;

/** 索引 `impl <Trait> for <Type>` 关系：`traitName → [selfType, …]`。 */
export function parseRustTraitImpls(src: string): Map<string, string[]>;

/** 找把 `<name>` 绑起来的 `match`，返回 scrutinee 文本（返回类型不可知时为 null）。 */
export function findMatchScrutinee(bodyText: string, name: string): string | null;

/**
 * 造一个「响应形状解析器」：把 `Ok(Json(<expr>))` 下沉到 struct / 辅助函数 / 服务方法；
 * 判不出来返回 `null`（**fail-closed**，绝不交半份结论）。
 */
export function createResponseResolver(input: {
    structs: Map<string, { fields: string[]; rustFields?: string[]; opaque?: boolean }>;
    functions: Map<
        string,
        { body: string; ret: string | null; topLevel: boolean; isHandler?: boolean; ambiguous?: boolean } | null
    >;
    types?: {
        structFields: Map<string, Map<string, string> | null>;
        methods: Map<
            string,
            Map<
                string,
                Array<{ name?: string; ret: string | null; body: string; selfType: string; traitName: string | null }>
            >
        >;
        traitImpls?: Map<string, string[]>;
    };
}): {
    resolveHandler(fn: { name?: string; body: string; ret?: string | null; sig?: string }): ResponseShape[] | null;
    resolveExpr(expr: string, scope: { body?: string }, depth?: number): ResponseShape[] | null;
};

/** 从**参数表**抽取 Query / Path / Json 提取器。 */
export function extractHandlerIo(sig: string): RustRouteContract["io"];

/** 解析 `.route("path", get(handler))` 表（支持多行与 `mod::handler` 限定路径）。 */
export function parseRouteTable(src: string): Array<{ path: string; methods: string[]; handlers: string[] }>;

/** 收集后端契约。`sinkDirs` 是响应形状的下沉目录（storage / common / services）。 */
export function collectRustAdminContract(options: {
    routesDir: string;
    sinkDirs?: string[];
}): Promise<RustAdminContract>;

/** 归一化路径参数段为 `{x}`。 */
export function normalizePath(p: string): string;

/** 归一化 `METHOD /path` 路由键。 */
export function normalizeRoute(route: string): string;

/** 去 TS 注释（保留字符串/模板/正则字面量）。 */
export function stripTsComments(src: string): string;

/** 取 `interface` / `type X = {…}` / 别名的第一层字段名（只收键集闭合的形状）。 */
export function extractInterfaceFields(src: string): Map<string, string[]>;

/** 收集 SDK 契约。 */
export function collectSdkAdminContract(options: {
    srcDir: string;
    prefixes?: Record<string, string>;
}): Promise<SdkAdminContract>;

/** 归一化声明返回类型；`primitive` 为真表示 `void`/`boolean` 之类（没有响应形状可核对）。 */
export function normalizeReturnType(declared: string | null): {
    base: string | null;
    isArray: boolean;
    primitive: boolean;
};

/**
 * 比较 SDK 请求体形状与后端请求键集；返回 `null` 表示一致。
 *
 * 四档：`request-unknown-field-rejected`（后端 deny ⇒ 400）/ `request-unknown-field-ignored`
 * （静默忽略）/ `request-missing-required-field` / `request-optional-vs-required`。
 */
export function diffRequestShape(input: {
    sdkFields: string[];
    sdkOptional: string[];
    backendFields: string[];
    backendOptional: string[];
    denyUnknownFields: boolean;
    backendType: string;
}): { kind: string; detail: string } | null;

/** 比较 SDK 字段集合与后端响应键集合。 */
export function diffFields(input: { sdkFields: string[]; backendKeys: string[] }): {
    missing: string[];
    extra: string[];
    ok: boolean;
};

/** 用「变体联合」比较响应形状；`variants` 为 `null` 时返回 `unknown: true`。 */
export function diffResponse(input: { sdkFields: string[]; variants: string[][] | null }): {
    missing: string[];
    extra: string[];
    ok: boolean;
    unknown: boolean;
};

/** 「覆盖桶」每一类的含义（台账里每条 reason 的模板）。 */
export const UNRESOLVED_KIND_REASONS: Readonly<Record<string, string>>;

/**
 * 把 `classify()` 的覆盖桶拍平成「逐条带 reason」的台账形状。
 *
 * 不变量：entries 长度恒等于 count；每条 reason 非空；排序稳定（按 `route|managerMethod`）。
 */
export function summarizeUnresolved(unresolved: Array<Record<string, unknown>>): Record<
    string,
    {
        count: number;
        entries: Array<{
            managerMethod: string | null;
            route: string | null;
            declaredReturn: string | null;
            handler: string | null;
            sdkType: string | null;
            reason: string;
        }>;
    }
>;
