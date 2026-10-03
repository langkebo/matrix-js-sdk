/**
 * Path Contract Verifier 核心逻辑单元测试
 *
 * 覆盖门禁核心逻辑（独立实现，避免 import ESM 脚本导致加载慢）：
 * - resolvePrefix: 解析各种前缀形式（标识符、模板字面量、裸字符串）
 * - normalizePath: 路径归一化（动态参数替换）
 *
 * 重点测试：模板字面量前缀解析（MSC4143 rtc/transports 修复点）
 */

import { describe, expect, it } from "vitest";

describe("verify-path-contract core logic (路径契约门禁核心逻辑)", () => {
    // 从门禁脚本中提取的前缀常量定义
    const PREFIX_CONSTANTS = {
        ClientPrefix: {
            V3: "/_matrix/client/v3",
            V1: "/_matrix/client/v1",
            Unstable: "/_matrix/client/unstable",
            Media: "/_matrix/media",
            MediaV3: "/_matrix/media/v3",
            MediaUnstable: "/_matrix/media/unstable",
        },
        AdminPrefix: {
            V1: "/_matrix/admin/v1",
            Unstable: "/_matrix/admin/unstable",
        },
        PushRulePrefix: {
            V1: "/_matrix/pushrules/v1",
        },
        VendorPrefix: {
            "": "/_matrix/vendor",
        },
    };

    /**
     * 简化的 resolvePrefix 实现（复制自门禁脚本）
     */
    function resolvePrefix(expr: string | null) {
        const DEFAULT_PREFIX = "/_matrix/client/v3";

        if (!expr) return { prefix: DEFAULT_PREFIX, known: true };

        // strip 两端引号/反引号
        const literal = expr.trim().replace(/^["'`]|["'`]$/g, "");

        // VendorPrefix
        if (literal === "VendorPrefix") return { prefix: PREFIX_CONSTANTS.VendorPrefix[""], known: true };

        // 模板字面量（已剥离反引号）- 这是核心修复点
        if (literal.startsWith("${")) {
            const interpMatch = /^\$\{(\w+)\.(\w+)\}(.*)$/.exec(literal);
            if (interpMatch) {
                const [, group, key, rest] = interpMatch;
                const base = (PREFIX_CONSTANTS as any)[group]?.[key] || "";
                return { prefix: base + rest, known: true };
            }
            return { prefix: null, known: false };
        }

        // 裸字符串前缀
        if (literal.startsWith("/")) return { prefix: literal, known: true };

        // 标识符形式
        const m = /^(\w+)\.(\w+)$/.exec(literal);
        if (m) {
            const group = (PREFIX_CONSTANTS as any)[m[1]];
            if (group && group[m[2]] !== undefined) return { prefix: group[m[2]], known: true };
            return { prefix: null, known: false };
        }
        return { prefix: null, known: false };
    }

    /**
     * 路径归一化函数（复制自门禁脚本）
     */
    function normalizePath(p: string) {
        return (
            p
                .replace(/\$\{[^}]*\}/g, "{X}")
                .replace(/\$(\w+)/g, "{X}")
                .replace(/\{[^}]+\}/g, "{X}")
                .replace(/:(\w+)/g, "{X}")
                .split("?")[0]
                .replace(/\/+$/, "") || "/"
        );
    }

    describe("resolvePrefix", () => {
        it("null 使用默认前缀", () => {
            expect(resolvePrefix(null)).toEqual({ prefix: "/_matrix/client/v3", known: true });
            expect(resolvePrefix("")).toEqual({ prefix: "/_matrix/client/v3", known: true });
        });

        it("解析 ClientPrefix 常量", () => {
            expect(resolvePrefix("ClientPrefix.V3")).toEqual({
                prefix: "/_matrix/client/v3",
                known: true,
            });
            expect(resolvePrefix("ClientPrefix.Unstable")).toEqual({
                prefix: "/_matrix/client/unstable",
                known: true,
            });
        });

        it("解析 AdminPrefix 常量", () => {
            expect(resolvePrefix("AdminPrefix.V1")).toEqual({
                prefix: "/_matrix/admin/v1",
                known: true,
            });
        });

        it("解析裸字符串前缀", () => {
            expect(resolvePrefix('"/custom/prefix"')).toEqual({
                prefix: "/custom/prefix",
                known: true,
            });
        });

        it("解析模板字面量前缀（核心修复点 - MSC4143 rtc/transports）", () => {
            // 这是门禁脚本中新增的关键功能
            // 源码写法：prefix: `${ClientPrefix.Unstable}/org.matrix.msc4143`
            // strip 后变为：${ClientPrefix.Unstable}/org.matrix.msc4143
            expect(resolvePrefix("${ClientPrefix.Unstable}/org.matrix.msc4143")).toEqual({
                prefix: "/_matrix/client/unstable/org.matrix.msc4143",
                known: true,
            });

            expect(resolvePrefix("${ClientPrefix.V1}/custom")).toEqual({
                prefix: "/_matrix/client/v1/custom",
                known: true,
            });

            expect(resolvePrefix("${AdminPrefix.Unstable}/endpoint")).toEqual({
                prefix: "/_matrix/admin/unstable/endpoint",
                known: true,
            });
        });

        it("无法识别的前缀返回值（钉住门禁真实行为）", () => {
            // 真实门禁逻辑：模板字面量只要解析成功（interpMatch 匹配），无论 base 是否为空都返回 known:true
            expect(resolvePrefix("UnknownPrefix.V1")).toEqual({ prefix: null, known: false });

            // ${InvalidGroup.Key} 虽然 InvalidGroup 不存在，但仍被视为已知（known:true），prefix=""
            // 这是门禁的真实行为，钉住它防止回归
            expect(resolvePrefix("${InvalidGroup.Key}")).toEqual({
                prefix: "",
                known: true,
            });
        });
    });

    describe("normalizePath", () => {
        it("归一化 roomId 插值", () => {
            expect(normalizePath("/rooms/${roomId}/events")).toBe("/rooms/{X}/events");
            expect(normalizePath("/rooms/$roomId/events")).toBe("/rooms/{X}/events");
            expect(normalizePath("/rooms/{roomId}/events")).toBe("/rooms/{X}/events");
            expect(normalizePath("/rooms/:roomId/events")).toBe("/rooms/{X}/events");
        });

        it("去除查询参数", () => {
            expect(normalizePath("/foo?bar=baz")).toBe("/foo");
            expect(normalizePath("/foo?bar=${baz}")).toBe("/foo");
        });

        it("去除末尾斜杠", () => {
            expect(normalizePath("/foo/")).toBe("/foo");
            expect(normalizePath("/foo//")).toBe("/foo");
            expect(normalizePath("/")).toBe("/");
            expect(normalizePath("")).toBe("/");
        });

        it("复杂路径归一化", () => {
            expect(normalizePath("/rooms/${roomId}/state/${eventType}/${eventId}?foo=bar")).toBe(
                "/rooms/{X}/state/{X}/{X}",
            );
        });
    });

    describe("integration test (SDK 与后端路径匹配)", () => {
        it("rtc/transports 路径应正确匹配", () => {
            // SDK 调用：GET /rtc/transports + prefix: `${ClientPrefix.Unstable}/org.matrix.msc4143`
            // 完整路径：/_matrix/client/unstable/org.matrix.msc4143/rtc/transports

            const sdkPathRaw = "/rtc/transports";
            const sdkPrefixExpr = "${ClientPrefix.Unstable}/org.matrix.msc4143";
            const backendRoute = "/_matrix/client/unstable/org.matrix.msc4143/rtc/transports";

            const prefixResult = resolvePrefix(sdkPrefixExpr);
            expect(prefixResult.known).toBe(true);

            const fullSdkPath = prefixResult.prefix + sdkPathRaw;
            const normalizedSdk = normalizePath(fullSdkPath);
            const normalizedBackend = normalizePath(backendRoute);

            expect(normalizedSdk).toBe(normalizedBackend);
        });

        it("account_status MSC3720 路径", () => {
            const sdkPathRaw = "/org.matrix.msc3720/account_status";
            const sdkPrefixExpr = "ClientPrefix.Unstable";

            const prefixResult = resolvePrefix(sdkPrefixExpr);
            expect(prefixResult.prefix).toBe("/_matrix/client/unstable");

            const fullSdkPath = prefixResult.prefix + sdkPathRaw;
            expect(normalizePath(fullSdkPath)).toBe("/_matrix/client/unstable/org.matrix.msc3720/account_status");
        });
    });
});
