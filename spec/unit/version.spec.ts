/*
Copyright 2026 HuLa/Tjg IM Project

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { describe, expect, it, vi } from "vitest";

import { SDK_NAME, buildUserAgent, getSdkVersion, getUserAgentToken, isReleaseBuild } from "../../src/version";

describe("version", () => {
    describe("SDK_NAME", () => {
        it("是带 scope 的 fork 包名，与 package.json 保持一致", () => {
            expect(SDK_NAME).toBe("@langkebo/matrix-js-sdk");
        });

        it("带 scope，从而与上游 matrix-js-sdk 可区分", () => {
            expect(SDK_NAME.startsWith("@")).toBe(true);
            expect(SDK_NAME).not.toBe("matrix-js-sdk");
        });
    });

    describe("getSdkVersion", () => {
        it("永不返回构建期占位符", () => {
            // 这是本模块的核心保证：Vitest 走 esbuild 而非 Babel，占位符不会被替换，
            // 因而这里必然命中降级分支。若哪天测试环境改走 Babel，此断言依然成立，
            // 因为那时返回的是真实版本号，同样不含 "__"。
            expect(getSdkVersion()).not.toMatch(/^__.*__$/);
            expect(getSdkVersion()).not.toContain("__");
        });

        it("返回一个可用的字符串", () => {
            const version = getSdkVersion();
            expect(typeof version).toBe("string");
            expect(version.length).toBeGreaterThan(0);
        });
    });

    describe("isReleaseBuild", () => {
        it("与 getSdkVersion 的取值自洽", () => {
            // 未注入时降级版本号以 0.0.0 开头；反之则是真实构建版本。
            expect(isReleaseBuild()).toBe(!getSdkVersion().startsWith("0.0.0-dev"));
        });

        it("在测试环境下为 false，因为 Vitest 不执行 Babel 注入", () => {
            // Vitest 用 esbuild 转换 TS，src/version.ts 里的占位符原样保留。
            expect(isReleaseBuild()).toBe(false);
        });
    });

    describe("getUserAgentToken", () => {
        it("格式为 name/version", () => {
            const token = getUserAgentToken();
            expect(token).toBe(`${SDK_NAME}/${getSdkVersion()}`);
            expect(token).toContain("/");
        });

        it("以 SDK 包名开头，便于在服务端日志中检索", () => {
            expect(getUserAgentToken().startsWith(SDK_NAME)).toBe(true);
        });

        it("不含会破坏 User-Agent 语法的空白字符", () => {
            expect(getUserAgentToken()).not.toMatch(/\s/);
        });
    });

    describe("buildUserAgent", () => {
        it("省略 base 时只返回 SDK token", () => {
            expect(buildUserAgent()).toBe(getUserAgentToken());
        });

        it("空字符串视为未提供 base", () => {
            expect(buildUserAgent("")).toBe(getUserAgentToken());
            expect(buildUserAgent("   ")).toBe(getUserAgentToken());
        });

        it("把 SDK token 追加到已有 UA 之后，用空格分隔", () => {
            const base = "Tjg/1.0 (Macintosh; Intel Mac OS X 10_15_7)";
            const result = buildUserAgent(base);
            expect(result).toBe(`${base} ${getUserAgentToken()}`);
            expect(result.startsWith(base)).toBe(true);
        });

        it("保留宿主 UA 中原有的 product token", () => {
            const base = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0";
            const result = buildUserAgent(base);
            expect(result).toContain("Chrome/120.0.0.0");
            expect(result.endsWith(getUserAgentToken())).toBe(true);
        });

        it("舍弃 base 首尾空白，避免产生连续空格", () => {
            const result = buildUserAgent("  Tjg/1.0  ");
            expect(result).toBe(`Tjg/1.0 ${getUserAgentToken()}`);
            expect(result).not.toMatch(/\s{2,}/);
        });
    });

    describe("warnIfUserAgentDoesNotAdvertiseFork（S-9 启动自检）", () => {
        it("浏览器/WebView 环境下 UA 缺少 fork 标识时仅告警一次", async () => {
            vi.resetModules();
            vi.stubGlobal("window", {});
            vi.stubGlobal("navigator", { userAgent: "Tjg/1.0 (Macintosh)" });

            const { logger } = await import("../../src/logger");
            const { warnIfUserAgentDoesNotAdvertiseFork } = await import("../../src/version");
            const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

            warnIfUserAgentDoesNotAdvertiseFork();
            warnIfUserAgentDoesNotAdvertiseFork();

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0][0])).toContain(SDK_NAME);

            vi.unstubAllGlobals();
            warnSpy.mockRestore();
        });

        it("UA 已包含 fork 标识时不告警", async () => {
            vi.resetModules();
            vi.stubGlobal("window", {});
            vi.stubGlobal("navigator", { userAgent: `Tjg/1.0 ${getUserAgentToken()}` });

            const { logger } = await import("../../src/logger");
            const { warnIfUserAgentDoesNotAdvertiseFork } = await import("../../src/version");
            const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

            warnIfUserAgentDoesNotAdvertiseFork();

            expect(warnSpy).not.toHaveBeenCalled();

            vi.unstubAllGlobals();
            warnSpy.mockRestore();
        });

        it("非浏览器环境（Node / 测试）下静默跳过，避免日志噪音", async () => {
            vi.resetModules();
            vi.stubGlobal("window", undefined);
            vi.stubGlobal("navigator", { userAgent: "Node.js/22" });

            const { logger } = await import("../../src/logger");
            const { warnIfUserAgentDoesNotAdvertiseFork } = await import("../../src/version");
            const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

            warnIfUserAgentDoesNotAdvertiseFork();

            expect(warnSpy).not.toHaveBeenCalled();

            vi.unstubAllGlobals();
            warnSpy.mockRestore();
        });
    });
});
