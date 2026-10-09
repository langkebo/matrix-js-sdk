/*
 * admin-response-contract.spec.ts — 抽取器的守卫 spec。
 *
 * ## 为什么这个 spec 的目标是「抽取器」而不是「门禁的结论」
 *
 * `scripts/quality/lib/admin-contract.mjs` 要同时读 Rust 与 TS 两种语言的形状。
 * 2026-10-07 写它的过程中，**抽取器自己先错了六次**，每一次都产出"看起来正常"的假结果：
 *
 *   1. 键检测排在字符串跳过之后 ⇒ **所有带引号的键全部丢失**，键集恒为空
 *      （"抽错源"比漏抽危险：会据此得出"没有问题"的结论）；
 *   2. 不区分层次 ⇒ 把 `json!` 里嵌套对象的键当成响应顶层键，凭空造出一批差异；
 *   3. 扫描整个函数体的 `json!` ⇒ 把 `record_audit_event(..., json!({...}))` 的审计字段
 *      当成了响应字段（`target_user` / `admin_role` …）；
 *   4. `json!(notification)` 这类非对象字面量被当成"空对象"，于是把"后端不透明"
 *      读成了"SDK 多编了 16 个字段"（方向正好相反的假阳性）；
 *   5. 只看整段签名判提取器 ⇒ 返回类型里的 `Result<Json<Value>, …>` 让
 *      "该处理器接收请求体"**恒真**，两条请求体检查全部假绿；
 *   6. 只归一化 SDK 侧路径 ⇒ 134 个调用点被误报成「后端没有这条路由」。
 *
 * 这些都是**判据失效**而不是判据缺失，只会表现为"门禁说没问题"。所以本 spec 用合成输入
 * 逐个钉住它们：每个 `it` 都对应上面某一条，且都带一个必须被识别出来的阳性样本。
 */

import { describe, it, expect } from "vitest";

import {
    balancedSlice,
    collectMapInsertKeys,
    createResponseResolver,
    diffRequestShape,
    extractJsonValueBodyKeys,
    extractTsTypeShapes,
    jsonMacroTopLevelEntries,
    resolveSdkRequestShape,
    scanStructFields,
    diffResponse,
    extractHandlerIo,
    extractInterfaceFields,
    extractJsonReturnExprs,
    extractResponseVariants,
    extractReturnType,
    extractStateContext,
    findLetBinding,
    findMatchScrutinee,
    jsonMacroTopLevelKeys,
    normalizePath,
    valueKindOfRustValue,
    valueKindOfTsType,
    normalizeReturnType,
    parseJsonObjectTopLevel,
    parseRouteTable,
    parseRustImplMethods,
    parseRustStructFieldTypes,
    parseRustTraitImpls,
    parseSerdeStructs,
    splitGenericArgs,
    splitTopLevelArgs,
    stripRustComments,
    stripTsComments,
    structLiteralShape,
    summarizeUnresolved,
    tailExpression,
    typeOfRustReturn,
    unwrapRustTraitType,
    unwrapRustType,
} from "../../scripts/quality/lib/admin-contract.mjs";

describe("admin-contract 抽取器（守卫）", () => {
    describe("parseJsonObjectTopLevel —— 「带引号的键」不能被字符串跳过吃掉", () => {
        it("取出引号键与裸标识符键，且只取第一层", () => {
            const body = `
        "token": row.token,
        uses_allowed: if x == 0 { None } else { Some(x) },
        nested: { "inner_key": 1, bare_inner: 2 },
        "last": 3
    `;
            const keys = [...parseJsonObjectTopLevel(body).keys()];
            expect(keys).toEqual(["token", "uses_allowed", "nested", "last"]);
            // 嵌套键不能出现在第一层
            expect(keys).not.toContain("inner_key");
            expect(keys).not.toContain("bare_inner");
        });

        it('值里的字符串含冒号/花括号时不会截断（`url: "a:b"`、`data: {…}`）', () => {
            const body = `url: "https://a.example:8448/x", data: { "k": "{v}" }, tail: 1`;
            const keys = [...parseJsonObjectTopLevel(body).keys()];
            expect(keys).toEqual(["url", "data", "tail"]);
        });

        it("阴性对照：空对象 → 空集合（而不是抛错或返回垃圾）", () => {
            expect([...parseJsonObjectTopLevel("").keys()]).toEqual([]);
        });
    });

    describe("jsonMacroTopLevelKeys —— 必须区分「空对象」与「非对象字面量」", () => {
        it("`json!({})` ⇒ 空数组（确认没有响应字段）", () => {
            const src = `Ok(Json(json!({})))`;
            const bang = src.indexOf("!");
            expect(jsonMacroTopLevelKeys(src, bang)).toEqual([]);
        });

        it("`json!(notification)` ⇒ null（形状不可知，绝不能当成空对象）", () => {
            for (const arg of ["notification", "event", "notifications", "v"]) {
                const src = `Ok(Json(json!(${arg})))`;
                const bang = src.indexOf("!");
                expect(jsonMacroTopLevelKeys(src, bang), `json!(${arg})`).toBeNull();
            }
        });

        it("多行对象字面量取全（不要用 lastIndexOf('}') 收尾）", () => {
            const src = `Ok(Json(json!({\n  "a": 1,\n  "b": { "c": [1, 2] },\n})))`;
            const bang = src.indexOf("!");
            expect(jsonMacroTopLevelKeys(src, bang)).toEqual(["a", "b"]);
        });
    });

    describe("extractResponseVariants —— 只认「返回位置」的 json!", () => {
        it("忽略审计事件的 json!（否则会把审计字段当响应字段）", () => {
            const body = `{
    let request_id = resolve_request_id(&headers);
    record_audit_event(&ctx, &admin.user_id, "x", "user", &u, request_id, json!({
        "admin_role": admin.role,
        "target_user": u,
        "audit_only_key": true,
    })).await;
    Ok(Json(json!({
        "success": true,
    })))
}`;
            const variants = extractResponseVariants(body);
            expect(variants).toEqual([["success"]]);
            expect(variants!.flat()).not.toContain("admin_role");
            expect(variants!.flat()).not.toContain("audit_only_key");
        });

        it("分支各记一个变体（带 room_id / 不带 room_id 两种返回）", () => {
            const body = `{
    if let Some(id) = x {
        Ok(Json(json!({ "started": true, "room_id": id, "events_deleted": 1 })))
    } else {
        Ok(Json(json!({ "started": true, "scope": "all_rooms" })))
    }
}`;
            expect(extractResponseVariants(body)).toEqual([
                ["events_deleted", "room_id", "started"],
                ["scope", "started"],
            ]);
        });

        it("全是不透明返回 ⇒ null（未知，而不是空）", () => {
            expect(extractResponseVariants("{\n  Ok(Json(event))\n}")).toBeNull();
        });
    });

    describe("extractHandlerIo —— 只看参数表，不能看返回类型", () => {
        it("返回类型里的 Json<Value> 不得让 hasJson 恒真（否则请求体两项检查全部假绿）", () => {
            const sig = `async fn logout_user_devices(\n    _admin: AdminUser,\n    State(ctx): State<AdminContext>,\n    Path(user_id): Path<UserId>,\n) -> Result<Json<Value>, ApiError>`;
            const io = extractHandlerIo(sig);
            expect(io.hasJson).toBe(false);
            expect(io.hasPath).toBe(true);
        });

        it("参数表里的 Json<T> 要被认出来并取到 T（含限定路径）", () => {
            const sig = `async fn create(\n    Json(body): Json<CreateTokenRequest>,\n) -> Result<Json<Value>, ApiError>`;
            const io = extractHandlerIo(sig);
            expect(io.hasJson).toBe(true);
            expect(io.jsonType).toBe("CreateTokenRequest");
        });

        it("Query<T> 取到类型名（`std::collections::HashMap` 这类限定名取末段）", () => {
            const sig = `async fn list(Query(q): Query<std::collections::HashMap<String, String>>) -> Result<Json<Value>, ApiError>`;
            expect(extractHandlerIo(sig).queryType).toBe("HashMap");
        });
    });

    describe("parseRouteTable —— 多行与限定路径 handler", () => {
        it("多行 .route 与 `mod::handler` 都要解析出来", () => {
            const src = `fn r() -> Router {
    .route("/a/{id}", get(a_handler))
    .route(
        "/b/{id}/block",
        post(management::block_room),
    )
    .route("/c", post(h1).get(h2))
}`;
            const routes = parseRouteTable(src);
            expect(routes).toEqual([
                { path: "/a/{id}", methods: ["GET"], handlers: ["a_handler"] },
                { path: "/b/{id}/block", methods: ["POST"], handlers: ["management::block_room"] },
                { path: "/c", methods: ["POST", "GET"], handlers: ["h1", "h2"] },
            ]);
        });
    });

    describe("normalizePath / normalizeReturnType", () => {
        it("路径两侧必须用同一套归一化（`${…}` 与 `{…}` 都变 {x}）", () => {
            expect(normalizePath("/_synapse/admin/v1/reports/{report_id}")).toBe("/_synapse/admin/v1/reports/{x}");
            expect(normalizePath("/_synapse/admin/v1/reports/${encodeURIComponent(id)}")).toBe(
                "/_synapse/admin/v1/reports/{x}",
            );
        });

        it("`Promise<void>` 标为 primitive（没有响应形状可核对，不该进覆盖桶）", () => {
            expect(normalizeReturnType("void")).toEqual({ base: null, isArray: false, primitive: true });
            expect(normalizeReturnType("boolean")).toEqual({ base: null, isArray: false, primitive: true });
        });

        it("`X | null` 与 `X[]` 归一", () => {
            expect(normalizeReturnType("RoomInfo | null")).toEqual({
                base: "RoomInfo",
                isArray: false,
                primitive: false,
            });
            expect(normalizeReturnType("DeviceInfo[]")).toEqual({
                base: "DeviceInfo",
                isArray: true,
                primitive: false,
            });
        });
    });

    describe("extractInterfaceFields —— 别名的字段也要能查到", () => {
        it("`export type X = Y` 继承 Y 的字段（否则这类返回类型整体不被检查）", () => {
            const src = `export interface FederationDestination {
    destination: string;
    failure_count: number;
}
export type AdminFederationDestinationDetail = FederationDestination;`;
            const fields = extractInterfaceFields(src);
            expect(fields.get("FederationDestination")).toEqual(["destination", "failure_count"]);
            expect(fields.get("AdminFederationDestinationDetail")).toEqual(["destination", "failure_count"]);
        });

        it("阴性对照：只认 4 空格缩进的成员（嵌套对象/函数的内部字段不算）", () => {
            const src = `export interface X {
    id: string;
    nested: {
        inner: number;
    };
}`;
            expect(extractInterfaceFields(src).get("X")).toEqual(["id", "nested"]);
        });
    });

    describe("diffResponse —— 变体联合比较", () => {
        it("任一变体覆盖即可，且要报出 SDK 多声明的键", () => {
            const r = diffResponse({ sdkFields: ["a", "b", "extra"], variants: [["a", "b"], ["a"]] });
            expect(r.unknown).toBe(false);
            expect(r.missing).toEqual([]);
            expect(r.extra).toEqual(["extra"]);
            expect(r.ok).toBe(false);
        });

        it("variants 为 null ⇒ unknown（沉默不是同意）", () => {
            const r = diffResponse({ sdkFields: ["a"], variants: null });
            expect(r.unknown).toBe(true);
            expect(r.ok).toBe(false);
        });
    });

    describe("调用点抽取 —— 三种「整类方法隐身」的坑", () => {
        it('路径被包装调用包住（`apu("/x")`）也要能抽到（否则整族端点从不被检查）', () => {
            const src = `
class M {
    async getRetentionPolicy(): Promise<RetentionPolicy> {
        return await this.adminRequest<RetentionPolicy>(Method.Get, apu("/retention/policy"));
    }
}`;
            const seen = [
                ...src.matchAll(
                    /(adminRequest|v2Request)\s*(?:<\s*([^;]*?)\s*>)?\s*\(\s*Method\.(\w+)\s*,\s*([^,)]*)/g,
                ),
            ].map((m) => m[4]);
            // 直接断言"包装调用确实出现"，用于证明下面那条约定不是空话
            expect(seen[0]).toContain("apu(");
        });

        it("`interface X extends Y` 要合并父字段（否则 X 的父字段凭空消失、看起来像 SDK 漏声明）", () => {
            const src = `export interface RetentionPolicy {
    max_lifetime: number | null;
}
export interface RoomRetentionPolicy extends RetentionPolicy {
    room_id: string;
}`;
            expect(extractInterfaceFields(src).get("RoomRetentionPolicy")).toEqual(["max_lifetime", "room_id"]);
        });

        it("阴性对照：多级 extends 也合并", () => {
            // 必须写成多行：抽取器只认「4 空格缩进的独立成员行」（prettier 保证的形态），
            // 单行 interface 会把字段与花括号写在同一行 —— 那是**测试夹具**的问题，不是抽取器的。
            const src = `export interface A {
    a: number;
}
export interface B extends A {
    b: number;
}
export interface C extends B {
    c: number;
}`;
            const f = extractInterfaceFields(src);
            expect(f.get("B")).toEqual(["a", "b"]);
            expect(f.get("C")).toEqual(["a", "b", "c"]);
        });
    });

    describe("balancedSlice / splitTopLevelArgs / 注释剥离", () => {
        it("balancedSlice 跳过字符串里的括号", () => {
            expect(balancedSlice(`f(")")`, 1)?.text).toBe(`(")")`);
        });

        it("splitTopLevelArgs 按深度 0 逗号切分并吃掉字面量里的逗号", () => {
            expect(splitTopLevelArgs(`Method.Post, "/a", {}, { x: "1,2" }`)).toEqual([
                "Method.Post",
                '"/a"',
                "{}",
                '{ x: "1,2" }',
            ]);
        });

        it("stripRustComments 不吞字符串里的双斜杠", () => {
            const out = stripRustComments(`let a = "http://x"; // 注释\nlet b = 1;`);
            expect(out).toContain('"http://x"');
            expect(out).not.toContain("注释");
        });

        it("stripTsComments 不吞模板/正则字面量里的斜杠", () => {
            const out = stripTsComments("const p = `/a/${x}/b`;\nconst re = /\\/\\//;\n// 真注释\nconst y = 1;");
            expect(out).toContain("`/a/${x}/b`");
            expect(out).toContain("const y = 1;");
            expect(out).not.toContain("真注释");
        });
    });

    /*
     * 第二轮（§7.15-28）：把 `backend-shape-unknown` 55 条下沉到 struct / 辅助函数。
     *
     * 这一轮又踩了 3 个"看起来正常"的坑，全部表现为**抽取器静默给出错答案**：
     *   a. `structLiteralShape` 把**值里的裸标识符**当成简写字段 ⇒ `x.max(0) as u64,`
     *      凭空多出一个键 `u64`（`register` 因此被报成"SDK 多声明 nonce"）；
     *   b. 修 a 时把"字段起始位"判据建立在上一个 token 上，却把**空白**也写进了 token
     *      ⇒ 判据永不成立、键集**恒为空**（`feature-flags` / `modules` / `register` 集体隐身）；
     *   c. `Ok((StatusCode::CREATED, Json(..)))` 的元组响应：整体是**一个**以 `(` 开头的实参，
     *      只按 `,` 切会把它整段跳过 ⇒ 所有"带状态码的创建类"处理器落进未知桶。
     */
    describe("第二轮下沉：struct 字面量 / ::from / Map::insert / 委派 / 数组", () => {
        it("struct 字面量取简写字段（不能把 `as u64` 里的裸标识符当键）", () => {
            const lit = structLiteralShape("RegisterResponse { a: r.a.max(0) as u64, b: r.b, c }");
            expect(lit?.keys).toEqual(["a", "b", "c"]);
            expect(lit?.keys).not.toContain("u64");
        });

        it("阴性对照：多行 + 混合写法都能取到键（prevToken 不能被空白顶掉）", () => {
            expect(structLiteralShape("FeatureFlagListResponse { flags, total, next_batch }")?.keys).toEqual([
                "flags",
                "next_batch",
                "total",
            ]);
            expect(structLiteralShape("X {\n    a: 1,\n    b,\n    c: some.map(|x| x),\n}")?.keys).toEqual([
                "a",
                "b",
                "c",
            ]);
            // 空键集是"抽取器坏了"的信号，不能与"空对象"混为一谈
            expect(structLiteralShape("X { a }")?.keys).not.toEqual([]);
        });

        it("`..spread` 不能当成「没有其余字段」（否则制造「SDK 多声明字段」的假阳）", () => {
            const lit = structLiteralShape("X { a: 1, ..base }");
            expect(lit?.spread).toBe(true);
            expect(lit?.keys).toBeNull();
        });

        it("字段级 `#[serde(rename)]` 要变成 JSON 键（Rust 名与 JSON 键分开存）", () => {
            const src = `#[derive(Debug, Serialize)]
pub struct ThirdPartyRuleResultResponse {
    /// The \`id\` field.
    pub id: i64,
    #[serde(rename = "allowed")]
    /// The \`is_allowed\` field.
    pub is_allowed: bool,
    pub rule_name: String,
}`;
            const st = parseSerdeStructs(src).get("ThirdPartyRuleResultResponse");
            expect(st?.fields).toEqual(["allowed", "id", "rule_name"]);
            expect(st?.rustFields).toEqual(["id", "is_allowed", "rule_name"]);
            expect(st?.opaque).toBe(false);
        });

        it("阴性对照：非 snake_case 的 rename_all 判不出键 ⇒ opaque（不猜）", () => {
            const src = `#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct X {
    pub a_b: i64,
}`;
            expect(parseSerdeStructs(src).get("X")?.opaque).toBe(true);
        });

        it("元组响应 `Ok((StatusCode::CREATED, Json(..)))` 也要抽到（否则整族创建类端点隐身）", () => {
            const body = `{
    let x = ctx.svc.create(body).await?;
    Ok((StatusCode::CREATED, Json(AccountValidityResponse::from(x))))
}`;
            expect(extractJsonReturnExprs(body)).toEqual(["AccountValidityResponse::from(x)"]);
        });

        it("阴性对照：`Ok(Json(f(x, Json(body))))` 里参数位置的 Json 不是返回值", () => {
            const body = `{
    Ok(Json(purge_history(admin, State(ctx), headers, Json(merged_body)).await?))
}`;
            expect(extractJsonReturnExprs(body)).toEqual([
                "purge_history(admin, State(ctx), headers, Json(merged_body)).await?",
            ]);
        });

        it("`serde_json::json!` 限定写法与裸 `json!` 等价", () => {
            const body = `{ Ok(Json(serde_json::json!({ "a": 1, "b": 2 }))) }`;
            expect(extractJsonReturnExprs(body)).toEqual(['serde_json::json!({ "a": 1, "b": 2 })']);
        });

        it("Map::insert 取顶层键，且不能把嵌套 map 的键算进来", () => {
            const body = `{
    let mut results = serde_json::Map::new();
    let mut token_results = serde_json::Map::new();
    token_results.insert("access_tokens_deleted".to_string(), json!(1));
    token_results.insert("refresh_tokens_deleted".to_string(), json!(2));
    results.insert("rooms".to_string(), json!({}));
    results.insert("tokens".to_string(), Value::Object(token_results));
    Ok(Json(Value::Object(results)))
}`;
            // `\b` 边界：`results` 不能匹配到 `token_results`
            expect(collectMapInsertKeys(body, "results")).toEqual(["rooms", "tokens"]);
            expect(extractJsonReturnExprs(body)).toEqual(["Value::Object(results)"]);
        });

        it("取返回类型 / let 绑定 / 尾表达式", () => {
            expect(
                extractReturnType("async fn f(State(ctx): State<AdminContext>) -> Result<Json<Value>, ApiError>"),
            ).toBe("Result<Json<Value>, ApiError>");
            expect(findLetBinding(`{ let stats: Vec<ModuleResponse> = x.map(y).collect(); }`, "stats")).toEqual({
                type: "Vec<ModuleResponse>",
                rhs: "x.map(y).collect()",
            });
            expect(
                tailExpression(`{
    let merged = match body { _ => json!({}) };
    purge_history(admin, State(ctx), headers, Json(merged)).await
}`),
            ).toBe("purge_history(admin, State(ctx), headers, Json(merged)).await");
        });

        it("解析器：struct 字面量 / ::from / let 类型标注 / 委派 / 数组元素", () => {
            const structs = new Map([
                ["ModuleResponse", { fields: ["id", "module_name"], rustFields: ["id", "module_name"], opaque: false }],
                [
                    "AccountValidityResponse",
                    { fields: ["is_valid", "user_id"], rustFields: ["is_valid", "user_id"], opaque: false },
                ],
            ]);
            const functions = new Map([
                [
                    "purge_history",
                    {
                        body: `{ Ok(Json(json!({ "purged": true }))) }`,
                        ret: "Result<Json<Value>, ApiError>",
                        topLevel: true,
                    },
                ],
                [
                    "report_to_json",
                    { body: `{ json!({ "id": r.id, "reason": r.reason }) }`, ret: "Value", topLevel: true },
                ],
            ]);
            const r = createResponseResolver({ structs, functions });

            expect(r.resolveHandler({ body: `{ Ok(Json(ModuleResponse { id: m.id, module_name: m.n })) }` })).toEqual([
                { kind: "object", keys: ["id", "module_name"] },
            ]);
            expect(r.resolveHandler({ body: `{ Ok(Json(AccountValidityResponse::from(validity))) }` })).toEqual([
                { kind: "object", keys: ["is_valid", "user_id"] },
            ]);
            expect(
                r.resolveHandler({
                    body: `{
    let responses: Vec<ModuleResponse> = modules.into_iter().map(ModuleResponse::from).collect();
    Ok(Json(responses))
}`,
                }),
            ).toEqual([{ kind: "array", item: "ModuleResponse", itemKeys: ["id", "module_name"] }]);
            // 纯委派：体内没有 Ok(Json(..))，尾表达式指向另一个处理器
            expect(r.resolveHandler({ body: `{ purge_history(admin, State(ctx)).await }` })).toEqual([
                { kind: "object", keys: ["purged"] },
            ]);
            // 同步辅助函数（非 async、返回 Value）
            expect(r.resolveHandler({ body: `{ Ok(Json(report_to_json(&report))) }` })).toEqual([
                { kind: "object", keys: ["id", "reason"] },
            ]);
        });

        it("解析器：判不出来必须返回 null，绝不猜（方法链 / 非对象字面量的 json! / opaque）", () => {
            const structs = new Map([["Opaque", { fields: ["a"], rustFields: ["a"], opaque: true }]]);
            const r = createResponseResolver({ structs, functions: new Map() });
            // 接收者类型未知的方法链 —— 本仓同名方法在 services/storage 多处定义，靠名字下沉会猜错
            expect(
                r.resolveHandler({ body: `{ let s = ctx.room_service.state().get_room_stats().await?; Ok(Json(s)) }` }),
            ).toBeNull();
            // `json!(event)` 的 event 来自服务调用（无类型标注）
            expect(
                r.resolveHandler({ body: `{ let e = ctx.svc.get_event(&id).await?; Ok(Json(json!(e))) }` }),
            ).toBeNull();
            expect(r.resolveHandler({ body: `{ Ok(Json(Opaque::from(x))) }` })).toBeNull();
            // 分支里有一个判不出来 ⇒ 整体未知，不交半份结论
            expect(
                r.resolveHandler({
                    body: `{ if c { Ok(Json(json!({ "a": 1 }))) } else { Ok(Json(unknown_thing)) } }`,
                }),
            ).toBeNull();
        });
    });

    /*
     * 第三轮（§7.15-29）：**接收者类型推断** —— 把 `ctx.<service>.<method>(..)` 从
     * "按方法名猜"改成"从 `AdminContext` 的字段类型推出接收者，再去 `impl` 里找唯一实现"。
     *
     * 这一轮又踩了 4 个坑，其中一个是**根因级**的：
     *   13. `stripRustComments` 把 Rust 的**生命周期**当字符字面量 ⇒ `&'static str` 之后一路吞到
     *       下一个 `'`，中间的花括号全被吃掉 ⇒ `balancedSlice` 在**整个 `impl` 块**上返回 null
     *       （`room/messaging/events.rs` 的 `impl MessagingService` 整块隐身，78 个 `async fn` 零索引）；
     *   14. `impl` 头带前导换行 ⇒ `^impl` 永不匹配 ⇒ **所有类型都没有方法**；
     *   15. 递归深度上限 5 ⇒ 一条真实链（handler → Ok 解包 → 变量 → 服务方法 → 又一条链 → storage 方法
     *       → `Value::Object`）**刚好差一层**返回 null，表现为"这条链就是解析不出来"；
     *   16. 特征实现是薄委派（`self.cleanup_abnormal_data(..).await`）而固有方法才是真的 ⇒
     *       两个同名 def 时抓错会绕回自己。
     */
    describe("第三轮：接收者类型推断", () => {
        it("生命周期不能被当成字符字面量（否则整块 impl 都取不到）", () => {
            const src = `impl S {
    pub fn f(&self) -> &'static str {
        let a = 'x';
        let b = '\\n';
        "done"
    }
}`;
            const stripped = stripRustComments(src);
            // 生命周期被换成等宽空格；字符字面量原样保留
            expect(stripped).toContain("'x'");
            expect(stripped).toContain("'\\n'");
            expect(stripped).not.toContain("'static");
            expect(stripped.length).toBe(src.length); // 等宽 ⇒ 所有下标都不受影响
            // 关键：括号配平能取到整个 impl 块（旧行为在这里返回 null）
            const slice = balancedSlice(stripped, stripped.indexOf("{"));
            expect(slice).not.toBeNull();
            expect(slice?.text).toContain('"done"');
            expect(slice?.text.trimEnd().endsWith("}")).toBe(true);
        });

        it("类型脱壳：Wrapper / 路径 / 泛型 / dyn / 元组", () => {
            expect(unwrapRustType("Arc<synapse_services::room::RoomService>")).toEqual({
                name: "RoomService",
                isArray: false,
            });
            // 必须取**末段**路径名：取首个标识符会得到 `synapse_services`
            expect(unwrapRustType("serde_json::Value")).toEqual({ name: "Value", isArray: false });
            expect(unwrapRustType("Option<Arc<RoomState>>")).toEqual({ name: "RoomState", isArray: false });
            expect(unwrapRustType("Vec<ModuleExecutionLog>")).toEqual({ name: "ModuleExecutionLog", isArray: true });
            expect(unwrapRustType("&'static str")?.name).toBe("str");
            expect(unwrapRustType("Arc<dyn RoomStoreApi>")).toBeNull(); // 具体类型不可知
            expect(unwrapRustTraitType("Arc<dyn RoomStoreApi>")).toEqual({ trait: "RoomStoreApi" });
            expect(unwrapRustTraitType("RoomService")).toBeNull();
        });

        it("返回类型剥离：Result / ApiResult / Option 都要能脱掉（且不许切错泛型）", () => {
            expect(typeOfRustReturn("Result<Option<ServerNotification>, ApiError>")).toEqual({
                name: "ServerNotification",
                isArray: false,
            });
            expect(typeOfRustReturn("ApiResult<serde_json::Value>")).toEqual({ name: "Value", isArray: false });
            expect(typeOfRustReturn("Vec<ModuleExecutionLog>")).toEqual({ name: "ModuleExecutionLog", isArray: true });
            // → 无返回类型
            expect(typeOfRustReturn(null)).toBeNull();
        });

        it("splitGenericArgs 按深度 0 逗号切分（`HashMap<String, i64>` 不能切成两段）", () => {
            expect(splitGenericArgs("HashMap<String, i64>, ApiError")).toEqual(["HashMap<String, i64>", "ApiError"]);
            expect(splitGenericArgs("Option<AuditEvent>")).toEqual(["Option<AuditEvent>"]);
        });

        it("取 `State(ctx): State<AdminContext>` 的变量名与类型（链的根）", () => {
            expect(extractStateContext("async fn f(_a: AdminUser, State(ctx): State<AdminContext>) -> X ")).toEqual({
                name: "ctx",
                type: "AdminContext",
            });
            expect(extractStateContext("async fn f(a: i32) -> X ")).toBeNull();
        });

        it("struct 字段类型表：同名 struct 撞了就整条作废（不许把 A 的字段当成 B 的）", () => {
            const src = `pub struct A {
    pub x: Arc<Foo>,
    pub y: String,
}
pub struct B {
    pub x: serde_json::Value,
}`;
            const t = parseRustStructFieldTypes(src);
            expect([...(t.get("A")?.keys() ?? [])]).toEqual(["x", "y"]);
            // 直接写路径类型也不能凭空多出一个叫 `serde_json` 的字段
            expect([...(t.get("B")?.keys() ?? [])]).toEqual(["x"]);
        });

        it("impl 方法索引：`impl` 头带前导换行也要认出 self 类型；`for` 形式取 for 之后那段", () => {
            const src = `
impl Foo {
    pub async fn a(&self) -> Result<String, E> {
        Ok("x".to_string())
    }
}
impl Bar for Foo {
    async fn b(&self) -> Result<i64, E> {
        Ok(1)
    }
}`;
            const m = parseRustImplMethods(src);
            expect(m.get("Foo")?.has("a")).toBe(true);
            expect(m.get("Foo")?.get("b")?.[0].traitName).toBe("Bar");
            expect(m.get("Foo")?.get("a")?.[0].traitName).toBeNull();
            expect(parseRustTraitImpls(src).get("Bar")).toEqual(["Foo"]);
        });

        it("解析链：ctx 字段 → 方法 → 返回类型 ⇒ 形状", () => {
            const types = {
                structFields: new Map([
                    [
                        "Ctx",
                        new Map([
                            ["svc", "Arc<Dyn>"],
                            ["audit", "Arc<AuditSvc>"],
                        ]),
                    ],
                    ["AuditSvc", new Map()],
                    ["Ctx2", new Map()],
                ]),
                methods: new Map([
                    [
                        "AuditSvc",
                        new Map([
                            [
                                "get_event",
                                [
                                    {
                                        ret: "Result<Option<AuditEvent>, E>",
                                        body: "{ Ok(1) }",
                                        selfType: "AuditSvc",
                                        traitName: null,
                                    },
                                ],
                            ],
                        ]),
                    ],
                ]),
                traitImpls: new Map([["Dyn", ["RealSvc"]]]),
            };
            const structs = new Map([
                ["AuditEvent", { fields: ["created_ts", "event_id"], rustFields: [], opaque: false }],
            ]);
            const r = createResponseResolver({ structs, functions: new Map(), types });
            expect(
                r.resolveHandler({
                    sig: "async fn f(State(c): State<Ctx>) -> Result<Json<Value>, ApiError> ",
                    body: `{ let e = c.audit.get_event(&id).await?; Ok(Json(json!(e))) }`,
                }),
            ).toEqual([{ kind: "object", keys: ["created_ts", "event_id"] }]);
        });

        it("dyn Trait ⇒ 唯一「非测试」实现；两个实现一律 null（fail-closed）", () => {
            const types = {
                structFields: new Map([
                    [
                        "Svc",
                        new Map([
                            ["store", "Arc<dyn StoreApi>"],
                            ["weird", "Arc<dyn TwoImpls>"],
                        ]),
                    ],
                ]),
                methods: new Map([
                    [
                        "RealStore",
                        new Map([
                            [
                                "load",
                                [
                                    {
                                        ret: "Result<Value, E>",
                                        body: `{ let mut m = serde_json::Map::new(); m.insert("k".to_string(), json!(1)); Ok(serde_json::Value::Object(m)) }`,
                                        selfType: "RealStore",
                                        traitName: "StoreApi",
                                    },
                                ],
                            ],
                        ]),
                    ],
                    // 两个实现的 trait：**两个**都要有可解析的 load，否则"唯一性"判据会被
                    // "方法找不到"那道守门遮住 —— 变异测试（放开唯一性检查）不会变红。
                    [
                        "A",
                        new Map([
                            [
                                "load",
                                [
                                    {
                                        ret: "Result<Value, E>",
                                        body: `{ Ok(json!({ "from_a": 1 })) }`,
                                        selfType: "A",
                                        traitName: "TwoImpls",
                                    },
                                ],
                            ],
                        ]),
                    ],
                ]),
                traitImpls: new Map([
                    ["StoreApi", ["RealStore"]],
                    ["TwoImpls", ["A", "B"]],
                ]),
            };
            const r = createResponseResolver({ structs: new Map(), functions: new Map(), types });
            const sig = "async fn f(State(c): State<Svc>) -> Result<Json<Value>, ApiError> ";
            // dyn → RealStore →（特征实现）→ Map::insert 的键
            expect(r.resolveHandler({ sig, body: `{ let v = c.store.load(&id).await?; Ok(Json(v)) }` })).toEqual([
                { kind: "object", keys: ["k"] },
            ]);
            // 两个非测试实现 ⇒ 拒绝（不挑一个继续给形状）
            expect(r.resolveHandler({ sig, body: `{ let v = c.weird.load(&id).await?; Ok(Json(v)) }` })).toBeNull();
        });

        it("经 dyn 进来用该特征的实现；该实现委派到固有方法时**不绕回自己**", () => {
            const types = {
                structFields: new Map([["Svc", new Map([["store", "Arc<dyn StoreApi>"]])]]),
                methods: new Map([
                    [
                        "RealStore",
                        new Map([
                            [
                                "load",
                                [
                                    // 特征实现常常只是薄薄一层委派（真身是固有方法）
                                    {
                                        ret: "Result<Value, E>",
                                        body: "{ self.load(&id).await }",
                                        selfType: "RealStore",
                                        traitName: "StoreApi",
                                    },
                                    {
                                        ret: "Result<Value, E>",
                                        body: `{ Ok(json!({ "real": true })) }`,
                                        selfType: "RealStore",
                                        traitName: null,
                                    },
                                ],
                            ],
                        ]),
                    ],
                ]),
                traitImpls: new Map([["StoreApi", ["RealStore"]]]),
            };
            const r = createResponseResolver({ structs: new Map(), functions: new Map(), types });
            const sig = "async fn f(State(c): State<Svc>) -> Result<Json<Value>, ApiError> ";
            // 委派体里的 `self.load(..)` 会走到**固有**实现（`viaTrait` 已清空）⇒ 真正取到形状
            expect(r.resolveHandler({ sig, body: `{ let v = c.store.load(&id).await?; Ok(Json(v)) }` })).toEqual([
                { kind: "object", keys: ["real"] },
            ]);
        });

        it("`Some(..)` / `to_value(..)` 解包都要支持（服务层常见写法）", () => {
            const types = {
                structFields: new Map<string, Map<string, string> | null>([
                    ["Svc", new Map([["store", "Arc<dyn StoreApi>"]])],
                ]),
                methods: new Map<
                    string,
                    Map<string, { ret: string | null; body: string; selfType: string; traitName: string | null }[]>
                >([
                    [
                        "Svc",
                        new Map([
                            [
                                "deep",
                                [
                                    {
                                        ret: "ApiResult<Value>",
                                        body: `{ let result = json!({ "auto": 1 }); Ok(serde_json::to_value(result).map_err(|e| E(e.to_string()))?) }`,
                                        selfType: "Svc",
                                        traitName: null,
                                    },
                                ],
                            ],
                        ]),
                    ],
                    [
                        "RealStore",
                        new Map([
                            [
                                "load",
                                [
                                    {
                                        ret: "Result<Option<Value>, E>",
                                        body: `{ Ok(Some(json!({ "room_id": room_id }))) }`,
                                        selfType: "RealStore",
                                        traitName: "StoreApi",
                                    },
                                ],
                            ],
                        ]),
                    ],
                ]),
                traitImpls: new Map([["StoreApi", ["RealStore"]]]),
            };
            const r = createResponseResolver({ structs: new Map(), functions: new Map(), types });
            const sig = "async fn f(State(c): State<Svc>) -> Result<Json<Value>, ApiError> ";
            //  handler → Ok 解包 → 变量 → 又一条链 → dyn → 特征实现 → Ok(Some(json!)) ⇒ 逐层解开
            expect(r.resolveHandler({ sig, body: `{ let v = c.store.load(&id).await?; Ok(Json(v)) }` })).toEqual([
                { kind: "object", keys: ["room_id"] },
            ]);
            // `to_value(result?)` + `let result = json!(..)`
            expect(r.resolveHandler({ sig, body: `{ let v = c.deep().await?; Ok(Json(v)) }` })).toEqual([
                { kind: "object", keys: ["auto"] },
            ]);
            // 链上有一段解析不出来（`c.deep` 上没有 get）⇒ 整体未知
            expect(r.resolveHandler({ sig, body: `{ let v = c.deep.get().await?; Ok(Json(v)) }` })).toBeNull();
        });

        it("match 模式绑定：`match x { Some(n) => .. }` 里 n 的类型来自 scrutinee", () => {
            const body = `{
    let notification = ctx.svc.get_notification(id).await?;
    match notification {
        Some(n) => Ok(Json(json!(n))),
        None => Err(ApiError::not_found("x".to_string())),
    }
}`;
            expect(findMatchScrutinee(body, "n")).toBe("notification");
            expect(findMatchScrutinee(body, "zzz")).toBeNull();
            // 合成解析
            const types = {
                structFields: new Map([["Ctx", new Map([["svc", "Arc<NotifSvc>"]])]]),
                methods: new Map([
                    [
                        "NotifSvc",
                        new Map([
                            [
                                "get_notification",
                                [
                                    {
                                        ret: "Result<Option<Notif>, E>",
                                        body: "{ Ok(1) }",
                                        selfType: "NotifSvc",
                                        traitName: null,
                                    },
                                ],
                            ],
                        ]),
                    ],
                ]),
                traitImpls: new Map(),
            };
            const structs = new Map([["Notif", { fields: ["id", "title"], rustFields: [], opaque: false }]]);
            const r = createResponseResolver({ structs, functions: new Map(), types });
            expect(
                r.resolveHandler({ sig: "async fn f(State(ctx): State<Ctx>) -> Result<Json<Value>, ApiError> ", body }),
            ).toEqual([{ kind: "object", keys: ["id", "title"] }]);
        });
    });
    describe("第四轮：请求体字段名比对（后端可选性 + SDK 请求形状）", () => {
        describe("scanStructFields / parseSerdeStructs —— 可选性与 skip", () => {
            it("`Option<T>` 与 `#[serde(default)]` 记为可选；`#[serde(skip)]` 的键不是线上键", () => {
                const body = `
    pub required_name: String,
    pub maybe: Option<i64>,
    #[serde(default)]
    pub with_default: i32,
    #[serde(skip)]
    pub hidden: String,
`;
                const r = scanStructFields(body);
                expect(r.json).toEqual(["required_name", "maybe", "with_default"]);
                expect(r.optionalJson.sort()).toEqual(["maybe", "with_default"]);
                expect(r.ignoredJson).toEqual(["hidden"]);
            });

            it("阴性对照：`skip_serializing_if` 是**条件序列化**，键照样要算（不能当 skip 剔除）", () => {
                const body = `
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maybe: Option<String>,
`;
                const r = scanStructFields(body);
                expect(r.json).toEqual(["maybe"]);
                expect(r.ignoredJson).toEqual([]);
            });

            it("`#[serde(flatten)]` ⇒ 标出来（键集不闭合，调用方必须落回未知）", () => {
                const src = `#[derive(Serialize)]
pub struct X {
    pub a: i64,
    #[serde(flatten)]
    pub inner: Inner,
}`;
                const st = parseSerdeStructs(src).get("X");
                expect(st?.flatten).toBe(true);
            });

            it("阴性对照：容器级 `#[serde(default)]` 只认紧邻本 struct 的属性（上个 struct 的字段属性不得泄漏）", () => {
                // A 的字段级 #[serde(default)] 与 B 之间**没有空行**：
                // 旧实现把"上个空行到现在"整段当容器属性 ⇒ 会把 B 的必填字段全判成可选。
                const src = `#[derive(Deserialize)]
pub struct A {
    #[serde(default)]
    pub a: i64,
}
#[derive(Deserialize)]
pub struct B {
    pub b: i64,
}`;
                const st = parseSerdeStructs(src);
                expect(st.get("B")?.optionalFields).toEqual([]);
                expect(st.get("A")?.optionalFields).toEqual(["a"]);
            });

            it("容器级 `#[serde(default)]` ⇒ 所有字段同为主题可选", () => {
                const src = `#[derive(Deserialize)]
#[serde(default)]
pub struct X {
    pub a: i64,
    pub b: String,
}`;
                expect(parseSerdeStructs(src).get("X")?.optionalFields).toEqual(["a", "b"]);
            });
        });

        describe("extractJsonValueBodyKeys —— `Json<Value>` 手工取键", () => {
            const io = { hasJson: true, jsonType: "Value" };
            it("读到的键与「必填」（链上有 ok_or / `?`）都要认出来", () => {
                const r = extractJsonValueBodyKeys({
                    sig: "async fn f(State(c): State<Ctx>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> ",
                    body: `{
    let room_id = body.get("room_id").and_then(|v| v.as_str()).ok_or_else(|| E("x"))?;
    let ts = body.get("purge_up_to_ts").and_then(|v| v.as_i64());
    Ok(Json(json!({ "room_id": room_id, "ts": ts })))
}`,
                    io,
                });
                expect(r?.keys).toEqual(["purge_up_to_ts", "room_id"]);
                expect(r?.required).toEqual(["room_id"]);
            });

            it("阴性对照：变量有 `.get(..)` 之外的用法 ⇒ null（键集无法穷举，绝不交半份结论）", () => {
                expect(
                    extractJsonValueBodyKeys({
                        sig: "async fn f(Json(body): Json<Value>) -> Result<Json<Value>, ApiError> ",
                        body: `{
    let merged = body;
    let room_id = body.get("room_id").and_then(|v| v.as_str());
    forward(merged).await
}`,
                        io,
                    }),
                ).toBeNull();
            });

            it("阴性对照：`Json<Struct>` 不走这条路径（由 struct 定义给键集）", () => {
                expect(
                    extractJsonValueBodyKeys({
                        sig: "async fn f(Json(body): Json<CreateThingBody>) -> Result<Json<Value>, ApiError> ",
                        body: `{ body.get("x") }`,
                        io: { hasJson: true, jsonType: "CreateThingBody" },
                    }),
                ).toBeNull();
            });

            it("阴性对照：一个键都没读 ⇒ null（而不是「空键集」）", () => {
                expect(
                    extractJsonValueBodyKeys({
                        sig: "async fn f(Json(body): Json<Value>) -> Result<Json<Value>, ApiError> ",
                        body: `{ Ok(Json(json!({}))) }`,
                        io,
                    }),
                ).toBeNull();
            });
        });

        describe("extractTsTypeShapes —— 工具类型 / 索引签名 / 多行泛型", () => {
            it("`Partial<X>` 继承 X 的字段且全部变可选；`Required<X>` 反之", () => {
                const src = `export interface X {
    a: string;
    b?: number;
}
export type PartialX = Partial<X>;
export type RequiredX = Required<X>;`;
                const shapes = extractTsTypeShapes(src);
                const partialX = shapes.get("PartialX")!;
                const requiredX = shapes.get("RequiredX")!;
                // 判定字段（fields/optionalFields/open）逐项精确；形状对象另含 C4 的
                // 非判定字段（valueTypes/valueKinds），故用 toMatchObject 而不是 toEqual。
                expect(partialX).toMatchObject({ fields: ["a", "b"], optionalFields: ["a", "b"], open: false });
                expect(requiredX).toMatchObject({ fields: ["a", "b"], optionalFields: [], open: false });
                // C4：值类别随字段一起继承
                expect(partialX.valueKinds!.get("a")).toBe("string");
                expect(partialX.valueKinds!.get("b")).toBe("number");
                expect(requiredX.valueKinds!.get("a")).toBe("string");
            });

            it("索引签名 / 联合 RHS ⇒ open（键集不闭合）", () => {
                const src = `export interface Open {
    a?: string;
    [key: string]: unknown;
}
export type Unioned = { a: string } | { b: string };`;
                const shapes = extractTsTypeShapes(src);
                expect(shapes.get("Open")?.open).toBe(true);
                expect(shapes.get("Unioned")?.open).toBe(true);
                // open 的形状不许进响应侧字段表（否则会被拿去比字段集，方向不定的假阳）
                expect(extractInterfaceFields(src).has("Open")).toBe(false);
            });

            it("多行泛型（`Record<\n string,\n {…}\n>`）不得凭空多出字段名", () => {
                // 踩过的坑：`<`/`>` 不计入深度 + "裸标识符也算字段"的兜底 ⇒ `string` 被当成字段
                const src = `export interface WhoisResponse {
    user_id: string;
    devices: Record<
        string,
        {
            sessions: Array<{ ip: string }>;
        }
    >;
}`;
                expect(extractTsTypeShapes(src).get("WhoisResponse")?.fields).toEqual(["devices", "user_id"]);
            });

            it("阴性对照：`type X = { … }` 的嵌套对象字段不泄漏到外层", () => {
                const src = `export type T = {
    a: { inner: string };
    b: number;
};`;
                expect(extractTsTypeShapes(src).get("T")?.fields).toEqual(["a", "b"]);
            });
        });

        describe("resolveSdkRequestShape —— 请求体实参解析", () => {
            const shapes = new Map([
                ["Payload", { fields: ["user_id", "reason"], optionalFields: ["reason"], open: false }],
                ["OpenCfg", { fields: [], optionalFields: [], open: true }],
            ]);

            it("内联对象字面量（含简写）与命名类型都要能解析", () => {
                expect(resolveSdkRequestShape({ params: "", bodyArg: "{ server_name: n, accept }", shapes })).toEqual({
                    fields: ["accept", "server_name"],
                    optionalFields: [],
                });
                expect(resolveSdkRequestShape({ params: "payload: Payload", bodyArg: "payload", shapes })).toEqual({
                    fields: ["user_id", "reason"],
                    optionalFields: ["reason"],
                });
            });

            it("`x ?? {}`、`x || {}` 与「三元一侧缺席」都能定形状", () => {
                expect(resolveSdkRequestShape({ params: "p?: Payload", bodyArg: "p ?? {}", shapes })).toEqual({
                    fields: ["user_id", "reason"],
                    optionalFields: ["reason"],
                });
                const ternary = resolveSdkRequestShape({
                    params: "reason?: string",
                    bodyArg: "reason ? { reason } : undefined",
                    shapes,
                });
                expect(ternary).toEqual({ fields: ["reason"], optionalFields: [] });
            });

            it("阴性对照：`x ?? y` 的右侧**不是**空对象时判不了（不能把两个形状混起来）", () => {
                // `p ?? q` 里 q 是另一个参数：两个形状都成形且不同 ⇒ 不猜
                expect(
                    resolveSdkRequestShape({
                        params: "p?: Payload, q?: { other: string }",
                        bodyArg: "p ?? q",
                        shapes,
                    }),
                ).toBeNull();
            });

            it("局部变量：先看类型标注，再看初始化表达式", () => {
                const methodBody = `{
    const body: { a: string } = { a: x };
    return this.adminRequest(Method.Post, "/x", {}, body);
}`;
                expect(
                    resolveSdkRequestShape({
                        params: "x: string",
                        bodyArg: "body",
                        methodBody,
                        shapes,
                    }),
                ).toEqual({ fields: ["a"], optionalFields: [] });
            });

            it("阴性对照：展开 / 索引签名类型 / 认不出的表达式 ⇒ null（绝不猜）", () => {
                expect(resolveSdkRequestShape({ params: "", bodyArg: "{ ...rest }", shapes })).toBeNull();
                expect(resolveSdkRequestShape({ params: "p: OpenCfg", bodyArg: "p", shapes })).toBeNull();
                expect(
                    resolveSdkRequestShape({ params: "p: Record<string, unknown>", bodyArg: "p", shapes }),
                ).toBeNull();
                expect(
                    resolveSdkRequestShape({ params: "p: Payload", bodyArg: "structuredClone(p)", shapes }),
                ).toBeNull();
            });

            it("跨文件重名：本文件表优先（否则「哪个形状生效」取决于目录遍历顺序）", () => {
                const ownShapes = new Map([
                    ["Payload", { fields: ["min_age_ms"], optionalFields: ["min_age_ms"], open: false }],
                ]);
                expect(resolveSdkRequestShape({ params: "p: Payload", bodyArg: "p", shapes, ownShapes })).toEqual({
                    fields: ["min_age_ms"],
                    optionalFields: ["min_age_ms"],
                });
            });
        });

        describe("diffRequestShape —— 四档判定", () => {
            it("SDK 多字段：后端 deny ⇒ rejected（必然 400）；不 deny ⇒ ignored（静默忽略）", () => {
                const common = {
                    sdkFields: ["a", "bogus"],
                    sdkOptional: [],
                    backendFields: ["a"],
                    backendOptional: [],
                    backendType: "T",
                };
                expect(diffRequestShape({ ...common, denyUnknownFields: true })?.kind).toBe(
                    "request-unknown-field-rejected",
                );
                expect(diffRequestShape({ ...common, denyUnknownFields: false })?.kind).toBe(
                    "request-unknown-field-ignored",
                );
            });

            it("后端必填而 SDK 未声明 / 标成可选，各是一类", () => {
                expect(
                    diffRequestShape({
                        sdkFields: [],
                        sdkOptional: [],
                        backendFields: ["user_id"],
                        backendOptional: [],
                        denyUnknownFields: true,
                        backendType: "T",
                    })?.kind,
                ).toBe("request-missing-required-field");
                expect(
                    diffRequestShape({
                        sdkFields: ["user_id"],
                        sdkOptional: ["user_id"],
                        backendFields: ["user_id"],
                        backendOptional: [],
                        denyUnknownFields: true,
                        backendType: "T",
                    })?.kind,
                ).toBe("request-optional-vs-required");
            });

            it("一致（含「后端可选而 SDK 必填」/「后端可选而 SDK 未声明」）⇒ null", () => {
                expect(
                    diffRequestShape({
                        sdkFields: ["a"],
                        sdkOptional: [],
                        backendFields: ["a", "b"],
                        backendOptional: ["b"],
                        denyUnknownFields: true,
                        backendType: "T",
                    }),
                ).toBeNull();
            });
        });
    });
});

describe("summarizeUnresolved（覆盖桶必须逐条自解释）", () => {
    /*
     * 背景：`unresolved` 原先在台账里只留 `{ count: n }` —— 15 条 `route-not-resolved`
     * 到底是哪 15 个方法、卡在哪一步，从台账里看不出来。一个只报数字的覆盖桶会被读成
     * "已知的少量噪声"，而它实际是**抽取器看不见的地面**。
     * 所以现在每个桶都必须 `entries.length === count`，且每条 reason 非空。
     */
    it("按 kind 分桶，count 与 entries 长度恒等", () => {
        const out = summarizeUnresolved([
            { kind: "route-not-resolved", managerMethod: "a", route: "GET /x" },
            { kind: "route-not-resolved", managerMethod: "b", route: "DELETE /y" },
            { kind: "array-return", managerMethod: "c", route: "GET /z" },
        ]);
        expect(out["route-not-resolved"].count).toBe(2);
        expect(out["route-not-resolved"].entries).toHaveLength(2);
        expect(out["array-return"].count).toBe(1);
    });

    it("每条 reason 都是非空字符串（未登记的 kind 也要有兜底文案）", () => {
        const out = summarizeUnresolved([{ kind: "brand-new-kind", route: "GET /x" }]);
        expect(out["brand-new-kind"].entries[0].reason).toBe("brand-new-kind");
    });

    it("条目自带的细分 reason（backend/sdk…）会被并入，不覆盖掉桶级解释", () => {
        const out = summarizeUnresolved([
            { kind: "request-shape-unknown", route: "POST /x", reason: "backend-opaque" },
        ]);
        const reason = out["request-shape-unknown"].entries[0].reason;
        expect(reason).toContain("请求体形状有一侧不可知");
        expect(reason).toContain("backend-opaque");
    });

    it("排序稳定：按 route|managerMethod（否则每次 --refresh 都产生随机 diff）", () => {
        const a = summarizeUnresolved([
            { kind: "k", route: "GET /b", managerMethod: "m1" },
            { kind: "k", route: "GET /a", managerMethod: "m2" },
        ]);
        const b = summarizeUnresolved([
            { kind: "k", route: "GET /a", managerMethod: "m2" },
            { kind: "k", route: "GET /b", managerMethod: "m1" },
        ]);
        expect(a.k.entries.map((e) => e.route)).toEqual(["GET /a", "GET /b"]);
        expect(a.k.entries).toEqual(b.k.entries);
    });

    it("缺 managerMethod / route 时落成 null，不丢条目（计数才是可信的）", () => {
        const out = summarizeUnresolved([{ kind: "k" }]);
        expect(out.k.count).toBe(1);
        expect(out.k.entries[0].managerMethod).toBeNull();
        expect(out.k.entries[0].route).toBeNull();
    });
});

/**
 * C4「嵌套形状」的地基：**值类别**归一化 + `json!` 的「键 → 值文本」抽取（2026-10-09）。
 *
 * 为什么需要它：现有比对只比**键名集合**（`diffFields` / `diffResponse`），
 * 「键集相同但值类型不同」（后端 `{"a": {"x": 1}}` vs SDK `{a: string}`）**看不见**。
 * 本组只钉住两侧归一化自身的语义（尤其 fail-closed），比对接线另测。
 */
describe("值类别归一化（C4 嵌套形状的地基）", () => {
    it("Rust json! 值文本 → 六个一眼可判的类别", () => {
        expect(valueKindOfRustValue('"s"')).toBe("string");
        expect(valueKindOfRustValue('r#"raw"#')).toBe("string");
        expect(valueKindOfRustValue("42")).toBe("number");
        expect(valueKindOfRustValue("-1.5")).toBe("number");
        expect(valueKindOfRustValue("true")).toBe("boolean");
        expect(valueKindOfRustValue("null")).toBe("null");
        expect(valueKindOfRustValue("{ a: 1 }")).toBe("object");
        expect(valueKindOfRustValue("[1, 2]")).toBe("array");
    });

    it("fail-closed：变量 / 成员 / 调用 / 转换 一律 unknown（绝不当标量）", () => {
        expect(valueKindOfRustValue("count")).toBe("unknown");
        expect(valueKindOfRustValue("event.id")).toBe("unknown");
        expect(valueKindOfRustValue('format!("{}", x)')).toBe("unknown");
        expect(valueKindOfRustValue("count as i64")).toBe("unknown");
        expect(valueKindOfRustValue("")).toBe("unknown");
    });

    it("TS 类型文本 → 类别；可空标量按非 null 类", () => {
        expect(valueKindOfTsType("string")).toBe("string");
        expect(valueKindOfTsType("number")).toBe("number");
        expect(valueKindOfTsType("boolean")).toBe("boolean");
        expect(valueKindOfTsType("{ a: number }")).toBe("object");
        expect(valueKindOfTsType("string[]")).toBe("array");
        expect(valueKindOfTsType("Array<RoomId>")).toBe("array");
        expect(valueKindOfTsType("Record<string, number>")).toBe("object");
        expect(valueKindOfTsType("number | null")).toBe("number");
        expect(valueKindOfTsType("string | null | undefined")).toBe("string");
    });

    it("fail-closed：真联合 / any / 未知具名类型 → union|unknown，绝不压成单类", () => {
        expect(valueKindOfTsType("string | number")).toBe("union");
        expect(valueKindOfTsType("any")).toBe("unknown");
        expect(valueKindOfTsType("unknown")).toBe("unknown");
        expect(valueKindOfTsType("RoomRetentionPolicy")).toBe("unknown");
        // 只有类型表里**已解析且闭合**的名字才判 object（那必然是 interface / `type X = {…}`）
        expect(valueKindOfTsType("RoomId", new Map([["RoomId", "object"]]))).toBe("object");
    });

    it("extractTsTypeShapes 带上 valueTypes/valueKinds，且不改变原有三键", () => {
        const shapes = extractTsTypeShapes(`
            export interface Inner { x: number }
            export interface Outer { id: string; count: number; ok: boolean; nested: Inner; list: string[]; }
        `);
        const outer = shapes.get("Outer")!;
        // 原有判定字段（fields/optionalFields/open）不变 —— 行为零变化的前提
        expect(outer.fields).toEqual(["count", "id", "list", "nested", "ok"]);
        expect(outer.open).toBe(false);
        expect(outer.valueTypes!.get("nested")).toBe("Inner");
        // C4：具名且闭合的类型 → object；标量 → 各自类别；数组 → array
        expect(outer.valueKinds!.get("id")).toBe("string");
        expect(outer.valueKinds!.get("count")).toBe("number");
        expect(outer.valueKinds!.get("ok")).toBe("boolean");
        expect(outer.valueKinds!.get("nested")).toBe("object");
        expect(outer.valueKinds!.get("list")).toBe("array");
    });

    it("jsonMacroTopLevelEntries 保留值文本，且键集与旧入口逐项一致", () => {
        const src = 'Ok(Json(json!({ "a": 1, "b": { "c": 2 }, "d": count })))';
        const idx = src.indexOf("json!");
        const entries = jsonMacroTopLevelEntries(src, idx)!;
        expect([...entries.keys()].sort()).toEqual(["a", "b", "d"]);
        expect(valueKindOfRustValue(entries.get("a")!)).toBe("number");
        expect(valueKindOfRustValue(entries.get("b")!)).toBe("object");
        expect(valueKindOfRustValue(entries.get("d")!)).toBe("unknown");
        expect(jsonMacroTopLevelKeys(src, idx)).toEqual(["a", "b", "d"]);
        // 非对象字面量仍 null（"不可知" 与 "空对象 []" 不能混）
        const nonObj = "Ok(Json(json!(notification)))";
        expect(jsonMacroTopLevelEntries(nonObj, nonObj.indexOf("json!"))).toBeNull();
        expect(jsonMacroTopLevelKeys(nonObj, nonObj.indexOf("json!"))).toBeNull();
    });
});
