/*
 * `scripts/quality/check-sdk-contract-alignment.mjs` 的单元测试。
 *
 * 这个门禁把「后端路由追踪表（docs）」和「SDK 里的 HTTP 调用 + synapse-rust 的 axum 路由」
 * 三方对齐。它是全仓最大的门禁（1700+ 行），核心逻辑依赖 TS AST 与 Rust 源码扫描，
 * 直接端到端测代价太高，所以这里钉的是它**判定链上那批纯函数**——它们决定了
 * 「两条路径算不算同一个端点」「文档里的一行算不算解析出了 SDK 引用」，
 * 也就是这个门禁真正在判的东西。
 *
 * 值得钉的口径：
 *
 *   · **版本段归一**：`/client/v1`、`/client/r0`、`/client/{version}` 必须归一成同一个形状。
 *     删掉这条正则，SDK 用 v3 而文档写 r0 的每一行都会假红。
 *   · **`VendorPrefix` 必须能解析**：ISSUE-13 的真实事故——它没登记进 `PREFIX_MAP` 时，
 *     会被当成「解析不出前缀」静默回退成默认 V3，于是 vendor 端点全线假红。
 *     未知前缀返回 `undefined`（保留多候选）而不是猜一个默认值，是同一条纪律的另一半。
 *   · **不等长时对齐尾缀、不是对齐前缀**：Rust 侧以相对路径注册（`/rooms/{room_id}/state`），
 *     axum 在运行时才拼前缀；文档侧带完整前缀。改成前缀对齐会让这类端点永远匹配不上。
 *   · **归一化后的空占位 `{}` 不参与通配**：只有 `{roomId}` 这种带名字的才算通配段。
 *     放开成 `{}` 也算，版本段就会互相通配，跨版本路径被误判成同一个端点。
 *   · **引号感知的 Rust 词法**：`.route("/a,b", handler)` 里的逗号在引号内，不能切。
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
    canonicalizeMethod,
    extractInlineCode,
    findMatchingDelimiter,
    isDividerRow,
    isWildcardSegment,
    joinPrefixAndPath,
    joinRustRoutePrefix,
    normalizeMethod,
    normalizeOwner,
    normalizePathForMatch,
    normalizePathLiteral,
    parseRustStringLiteral,
    parseSdkReferenceFromCell,
    pathEndsWithPattern,
    pathsMatchWithWildcards,
    resolvePrefix,
    splitPathSegments,
    splitTableCells,
    splitTopLevelArgs,
    upperFirst,
} from "../../scripts/quality/check-sdk-contract-alignment.mjs";

const GATE_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../scripts/quality/check-sdk-contract-alignment.mjs",
);

describe("check-sdk-contract-alignment: 追踪表格词法", () => {
    it("按 | 切分并 trim 每格", () => {
        expect(splitTableCells("|  Method  | Path | `client.foo()` |")).toEqual(["Method", "Path", "`client.foo()`"]);
    });

    it("非 | 开头的行返回空数组（不是表行就不解析）", () => {
        expect(splitTableCells("plain prose line")).toEqual([]);
    });

    it("只有一个 | 时返回空数组，不会切出幽灵格", () => {
        expect(splitTableCells("|")).toEqual([]);
    });

    it("识别分隔行的三种对齐写法", () => {
        expect(isDividerRow(["---", "---"])).toBe(true);
        expect(isDividerRow([":---:", "---:"])).toBe(true);
    });

    it("混入内容格就不是分隔行", () => {
        expect(isDividerRow(["Method", "---"])).toBe(false);
    });

    it("空格数组不是分隔行", () => {
        expect(isDividerRow([])).toBe(false);
    });

    it("单元格优先取第一个 inline code", () => {
        expect(extractInlineCode("`client.getFoo()`")).toBe("client.getFoo()");
    });

    it("没有 inline code 时去掉加粗标记后取整格", () => {
        expect(extractInlineCode("**Foo**")).toBe("Foo");
        expect(extractInlineCode("**`x.y()`**")).toBe("x.y()");
    });
});

describe("check-sdk-contract-alignment: 字面量与 owner/method 归一化", () => {
    it("成对的反引号/单引号/双引号都会被剥掉", () => {
        expect(normalizePathLiteral("`/a/b`")).toBe("/a/b");
        expect(normalizePathLiteral("'/a/b'")).toBe("/a/b");
        expect(normalizePathLiteral('"/a/b"')).toBe("/a/b");
        expect(normalizePathLiteral("/a/b")).toBe("/a/b");
    });

    it("长度不足 2 时不做剥离，非字符串返回 undefined", () => {
        expect(normalizePathLiteral("/")).toBe("/");
        expect(normalizePathLiteral(undefined)).toBeUndefined();
    });

    it("upperFirst 只动首字母，空值原样返回", () => {
        expect(upperFirst("roomManager")).toBe("RoomManager");
        expect(upperFirst("")).toBe("");
        expect(upperFirst(undefined as unknown as string)).toBeUndefined();
    });

    it("client / Client / MatrixClient 三种写法归一到 MatrixClient", () => {
        expect(normalizeOwner("client")).toBe("MatrixClient");
        expect(normalizeOwner("Client")).toBe("MatrixClient");
        expect(normalizeOwner("MatrixClient")).toBe("MatrixClient");
    });

    it("占位符 `-` 与空串是「未填写」，返回 null", () => {
        expect(normalizeOwner("-")).toBeNull();
        expect(normalizeOwner("")).toBeNull();
    });

    it("getter 与小驼峰写法都还原成 Manager 类名", () => {
        expect(normalizeOwner("getRoomManager")).toBe("RoomManager");
        expect(normalizeOwner("client.getRoomManager()")).toBe("RoomManager");
        expect(normalizeOwner("roomManager")).toBe("RoomManager");
        expect(normalizeOwner("RoomManager")).toBe("RoomManager");
    });

    it("方法列取 `(` 前的标识符；无法解析返回 null", () => {
        expect(normalizeMethod("sendMessage(")).toBe("sendMessage");
        expect(normalizeMethod("sendMessage")).toBe("sendMessage");
        expect(normalizeMethod("-")).toBeNull();
        expect(normalizeMethod("a b c(")).toBeNull();
    });

    it("从单元格解析 client.getXxxManager().y() 形式的引用", () => {
        expect(parseSdkReferenceFromCell("`client.getRoomManager().send(1)`")).toEqual({
            owner: "RoomManager",
            method: "send",
            raw: "client.getRoomManager().send(1)",
        });
    });

    it("client 上的直接方法归到 MatrixClient 名下", () => {
        expect(parseSdkReferenceFromCell("`client.sendMessage(`")).toEqual({
            owner: "MatrixClient",
            method: "sendMessage",
            raw: "client.sendMessage(",
        });
    });

    it("占位符与裸方法名都不算解析出引用", () => {
        expect(parseSdkReferenceFromCell("-")).toBeNull();
        expect(parseSdkReferenceFromCell("`sendMessage()`")).toBeNull();
    });
});

describe("check-sdk-contract-alignment: method 与前缀", () => {
    it("Method.Get / GET / 带引号 / 带空白都归一成 GET", () => {
        expect(canonicalizeMethod("Method.Get")).toBe("GET");
        expect(canonicalizeMethod("GET")).toBe("GET");
        expect(canonicalizeMethod('"GET"')).toBe("GET");
        expect(canonicalizeMethod("Method.Get\t")).toBe("GET");
        expect(canonicalizeMethod("Method . Get")).toBe("GET");
    });

    it("五种 HTTP method 都能从 Method.* 归一", () => {
        expect(canonicalizeMethod("Method.Post")).toBe("POST");
        expect(canonicalizeMethod("Method.Put")).toBe("PUT");
        expect(canonicalizeMethod("Method.Delete")).toBe("DELETE");
        expect(canonicalizeMethod("Method.Patch")).toBe("PATCH");
    });

    it("无法识别的表达式原样返回，非字符串返回 undefined", () => {
        expect(canonicalizeMethod("Options")).toBe("Options");
        expect(canonicalizeMethod(undefined)).toBeUndefined();
        expect(canonicalizeMethod(123)).toBeUndefined();
    });

    it("VendorPrefix 必须能解析出来（ISSUE-13：未登记会静默回退 V3 造成全线假红）", () => {
        expect(resolvePrefix("VendorPrefix")).toBe("/_matrix/vendor/v1");
        expect(resolvePrefix("ClientPrefix.V1")).toBe("/_matrix/client/v1");
        expect(resolvePrefix("MediaPrefix.V1")).toBe("/_matrix/media/v1");
        expect(resolvePrefix("IdentityPrefix.V2")).toBe("/_matrix/identity/v2");
    });

    it("未知前缀返回 undefined 而不是猜一个默认值", () => {
        expect(resolvePrefix("PREFIX_UNKNOWN")).toBeUndefined();
        expect(resolvePrefix("ClientPrefix")).toBeUndefined();
    });

    it("空前缀意为「无前缀」，绝对路径原样保留", () => {
        expect(resolvePrefix("")).toBe("");
        expect(resolvePrefix("/custom")).toBe("/custom");
    });

    it("拼接前缀与路径时补斜杠；缺路径返回 undefined", () => {
        expect(joinPrefixAndPath("/_matrix/client/v1", "/rooms/x")).toBe("/_matrix/client/v1/rooms/x");
        expect(joinPrefixAndPath("/_matrix", "rooms/x")).toBe("/_matrix/rooms/x");
        expect(joinPrefixAndPath(undefined, "/rooms")).toBe("/rooms");
        expect(joinPrefixAndPath("", "/rooms")).toBe("/rooms");
        expect(joinPrefixAndPath("/a", "")).toBeUndefined();
    });
});

describe("check-sdk-contract-alignment: 路径归一与匹配", () => {
    it("client / media / identity 的版本段归一成同一个形状", () => {
        expect(normalizePathForMatch("/_matrix/client/v1/rooms/{roomId}/state")).toBe(
            "/_matrix/client/{}/rooms/{}/state",
        );
        expect(normalizePathForMatch("/_matrix/client/r0/rooms/{roomId}/state")).toBe(
            "/_matrix/client/{}/rooms/{}/state",
        );
        expect(normalizePathForMatch("/_matrix/client/{version}/rooms/{roomId}/state")).toBe(
            "/_matrix/client/{}/rooms/{}/state",
        );
        expect(normalizePathForMatch("/_matrix/media/v1/upload")).toBe("/_matrix/media/{}/upload");
        expect(normalizePathForMatch("/_matrix/identity/v2/foo")).toBe("/_matrix/identity/{}/foo");
    });

    it("SDK 的 $var 与文档的 {var} 都归一成同一个占位", () => {
        expect(normalizePathForMatch("/rooms/$roomId/state")).toBe("/rooms/{}/state");
        expect(normalizePathForMatch("/rooms/{roomId}/state")).toBe("/rooms/{}/state");
    });

    it("字面 event type（m.reaction 等）归一成占位，与 /send/$eventType 对齐", () => {
        expect(normalizePathForMatch("/send/m.reaction/{roomId}")).toBe("/send/{}/{}");
        expect(normalizePathForMatch("/send/m.room.message/x")).toBe("/send/{}/x");
    });

    it("丢掉 query、折叠重复斜杠；相对路径与非字符串返回 undefined", () => {
        expect(normalizePathForMatch("/rooms/{roomId}/state?a=1")).toBe("/rooms/{}/state");
        expect(normalizePathForMatch("//a//b")).toBe("/a/b");
        expect(normalizePathForMatch("relative/path")).toBeUndefined();
        expect(normalizePathForMatch(undefined)).toBeUndefined();
    });

    it("只有带名字的 {var} 算通配段；归一化后的空占位 {} 不算", () => {
        expect(isWildcardSegment("{roomId}")).toBe(true);
        expect(isWildcardSegment("{room_id}")).toBe(true);
        expect(isWildcardSegment("rooms")).toBe(false);
        expect(isWildcardSegment("{}")).toBe(false);
    });

    it("按 / 切段并丢弃空段", () => {
        expect(splitPathSegments("/a/b/")).toEqual(["a", "b"]);
    });

    it("版本写法不同但归一化后相同的两条路径算匹配", () => {
        expect(
            pathsMatchWithWildcards(
                "/_matrix/client/v3/rooms/{roomId}/state",
                "/_matrix/client/r0/rooms/{roomId}/state",
            ),
        ).toBe(true);
    });

    it("段数不同时对齐尾缀：Rust 相对路由 vs 文档全前缀", () => {
        expect(pathsMatchWithWildcards("/rooms/{roomId}/state", "/_matrix/client/v1/rooms/{roomId}/state")).toBe(true);
        expect(
            pathsMatchWithWildcards(
                "/_matrix/client/v1/rooms/{roomId}/state/m.room.topic",
                "/rooms/{roomId}/state/{eventType}",
            ),
        ).toBe(true);
    });

    it("对齐的是尾缀不是前缀：短侧是长侧的前缀时不应匹配", () => {
        expect(pathsMatchWithWildcards("/a/b", "/a/b/c")).toBe(false);
        expect(pathsMatchWithWildcards("/b/c", "/a/b/c")).toBe(true);
    });

    it("确实不同的路径不匹配", () => {
        expect(pathsMatchWithWildcards("/a/b/c", "/x/y/z")).toBe(false);
        expect(
            pathsMatchWithWildcards(
                "/_matrix/client/v1/rooms/{roomId}/state",
                "/_matrix/client/v1/rooms/{roomId}/members",
            ),
        ).toBe(false);
    });

    it("任一侧无法归一化（相对路径）就不匹配", () => {
        expect(pathsMatchWithWildcards("rel", "/a")).toBe(false);
    });

    it("pathEndsWithPattern 认定尾缀命中，且 suffix 更长时直接 false", () => {
        expect(pathEndsWithPattern("/_matrix/client/v1/rooms/{roomId}/state", "/rooms/{roomId}/state")).toBe(true);
        expect(pathEndsWithPattern("/a/b/c", "/b/c")).toBe(true);
        expect(pathEndsWithPattern("/a/b/c", "/a/b")).toBe(false);
        expect(pathEndsWithPattern("/a/b", "/a/b/c")).toBe(false);
    });
});

describe("check-sdk-contract-alignment: Rust 路由词法", () => {
    it("找到配对闭合符，嵌套括号正确计数", () => {
        expect(findMatchingDelimiter("(a(b)c)", 0)).toBe(6);
        expect(findMatchingDelimiter("[a[b]c]", 0, "[", "]")).toBe(6);
    });

    it("引号内的括号不计数，反斜杠转义的引号不算收尾", () => {
        expect(findMatchingDelimiter('("a\\")b")', 0)).toBe(8);
    });

    it("不配对时返回 -1 而不是越界", () => {
        expect(findMatchingDelimiter("((", 0)).toBe(-1);
    });

    it("按顶层逗号切两半", () => {
        expect(splitTopLevelArgs('"/a", get(1,2)')).toEqual(['"/a"', "get(1,2)"]);
    });

    it("引号与三种括号内的逗号都不切", () => {
        expect(splitTopLevelArgs('"/a,b", x')).toEqual(['"/a,b"', "x"]);
        expect(splitTopLevelArgs("f(1,2), x")).toEqual(["f(1,2)", "x"]);
        expect(splitTopLevelArgs("{a:1,b:2}, x")).toEqual(["{a:1,b:2}", "x"]);
        expect(splitTopLevelArgs("[1,2], x")).toEqual(["[1,2]", "x"]);
    });

    it("没有顶层逗号时后半为空串", () => {
        expect(splitTopLevelArgs('"/a"')).toEqual(['"/a"', ""]);
    });

    it("解析 Rust 字符串字面量；非双引号形式返回 undefined", () => {
        expect(parseRustStringLiteral('"/rooms/x"')).toBe("/rooms/x");
        expect(parseRustStringLiteral('  "/rooms/x"  ')).toBe("/rooms/x");
        expect(parseRustStringLiteral('r"/rooms/x"')).toBeUndefined();
    });

    it("拼接 Rust 路由前缀时避免重复斜杠", () => {
        expect(joinRustRoutePrefix("/_matrix/client/v1", "/rooms")).toBe("/_matrix/client/v1/rooms");
        expect(joinRustRoutePrefix("/a/", "/b")).toBe("/a/b");
        expect(joinRustRoutePrefix("", "/b")).toBe("/b");
        expect(joinRustRoutePrefix("/a", "")).toBe("/a");
    });
});

describe("check-sdk-contract-alignment: 模块入口", () => {
    it("import 时不跑 main —— 顶层逻辑必须包在函数里，否则 spec 一 import 就扫全仓并 exit", () => {
        const source = fs.readFileSync(GATE_PATH, "utf8");
        expect(source).toMatch(/if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\)/);
        // 顶层裸调用 main();（行首无缩进）会让 import 产生副作用
        expect(source).not.toMatch(/^main\(\);$/m);
    });
});
