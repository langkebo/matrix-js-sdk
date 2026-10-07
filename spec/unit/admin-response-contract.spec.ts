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
    diffResponse,
    extractHandlerIo,
    extractInterfaceFields,
    extractJsonReturnExprs,
    extractResponseVariants,
    extractReturnType,
    findLetBinding,
    jsonMacroTopLevelKeys,
    normalizePath,
    normalizeReturnType,
    parseJsonObjectTopLevel,
    parseRouteTable,
    parseSerdeStructs,
    splitTopLevelArgs,
    stripRustComments,
    stripTsComments,
    structLiteralShape,
    tailExpression,
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
});
