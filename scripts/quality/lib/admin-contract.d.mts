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
    /** `Json<T>` 的 T 若是带 Deserialize 的 struct，记为它的字段集 */
    bodyStruct: { name: string; fields: string[]; denyUnknownFields: boolean } | null;
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
}

/** SDK 契约汇总。 */
export interface SdkAdminContract {
    callSites: SdkCallSite[];
    fields: Map<string, string[]>;
    fieldFiles: Map<string, string>;
    files: string[];
    stats: { fileCount: number; methodsScanned: number; callSiteCount: number; interfaceCount: number };
}

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

/** 抽取带 `Deserialize` 的 struct 字段与 `deny_unknown_fields`。 */
export function parseDeserializeStructs(src: string): Map<string, { fields: string[]; denyUnknownFields: boolean }>;

/** 索引带 `Serialize` / `Deserialize` 的 struct：JSON 键、Rust 名、派生列表与 `opaque`。 */
export function parseSerdeStructs(
    src: string,
): Map<
    string,
    { fields: string[]; rustFields?: string[]; denyUnknownFields: boolean; derives: string[]; opaque: boolean }
>;

/** 扫描 struct 体，取每个字段的 JSON 键（应用字段级 `#[serde(rename)]`）与 Rust 名。 */
export function scanStructFields(bodyText: string): { rust: string[]; json: string[]; unparsedRename: boolean };

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

/** 造一个「响应形状解析器」：把 `Ok(Json(<expr>))` 下沉到 struct / 辅助函数；判不出来返回 `null`。 */
export function createResponseResolver(input: {
    structs: Map<string, { fields: string[]; rustFields?: string[]; opaque?: boolean }>;
    functions: Map<
        string,
        { body: string; ret: string | null; topLevel: boolean; isHandler?: boolean; ambiguous?: boolean } | null
    >;
}): {
    resolveHandler(fn: { name?: string; body: string; ret?: string | null }): ResponseShape[] | null;
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

/** 取 `interface` 与 `type X = Y` 别名的第一层字段名。 */
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
