/*
 * `scripts/quality/check-generated-dto-placeholders.mjs` 的单元测试。
 *
 * 它给生成 DTO 里的 `= never` 空占位建一份**只降不升**台账：
 * 新增占位必须红（要显式 --accept-new），占位消失属棘轮下降。
 *
 * 最值得钉的是两点：
 *   1. 扫描面只认 `src/<module>/__generated__/dto.ts`，且只认 `export type X = never;`
 *      这一种形态 —— 放宽成"任何含 never 的行"会把 `foo: never` 之外的东西也卷进来；
 *   2. 台账文件缺失/损坏时**不抛异常**（门禁要能报"台账坏了"，而不是自己崩在 IO 上）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    moduleFromDtoPath,
    placeholderId,
    readPlaceholderBaseline,
    scanDtoPlaceholders,
} from "../../scripts/quality/check-generated-dto-placeholders.mjs";

function makeRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "dto-placeholders-"));
}

function writeDto(root: string, moduleName: string, body: string): string {
    const dir = path.join(root, "src", moduleName, "__generated__");
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, "dto.ts");
    fs.writeFileSync(abs, body);
    return abs;
}

describe("moduleFromDtoPath", () => {
    it("取 src/<module>/__generated__/dto.ts 里的 module（含多级目录）", () => {
        expect(moduleFromDtoPath("src/cas/__generated__/dto.ts")).toBe("cas");
        expect(moduleFromDtoPath("src/worker-admin/__generated__/dto.ts")).toBe("worker-admin");
    });

    it("路径形态不符 → null", () => {
        expect(moduleFromDtoPath("src/cas/dto.ts")).toBeNull();
        expect(moduleFromDtoPath("spec/unit/cas/__generated__/dto.ts")).toBeNull();
    });
});

describe("scanDtoPlaceholders", () => {
    it("只认 `export type X = never;`，其余声明不算占位", () => {
        const root = makeRoot();
        writeDto(
            root,
            "cas",
            [
                "export type CasContractDtoPlaceholder = never;",
                "export type CasRequest = { user: string };",
                "// never mentioned in a comment",
                "export type CasNeverField = { value: never };",
            ].join("\n"),
        );
        writeDto(root, "media", "export type MediaRequest = { id: string };\n");

        const { entries, dtoFileCount } = scanDtoPlaceholders(root);
        expect(dtoFileCount).toBe(2);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ module: "cas", typeName: "CasContractDtoPlaceholder", line: 1 });
    });

    it("扫描面不含非 __generated__/dto.ts 文件", () => {
        const root = makeRoot();
        const dir = path.join(root, "src", "cas");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "dto.ts"), "export type CasX = never;\n");
        fs.writeFileSync(path.join(dir, "types.ts"), "export type CasY = never;\n");

        const { entries } = scanDtoPlaceholders(root);
        expect(entries).toHaveLength(0);
    });

    it("多个占位按 filePath/typeName 稳定排序", () => {
        const root = makeRoot();
        writeDto(root, "zeta", "export type ZSecond = never;\nexport type ZFirst = never;\n");
        writeDto(root, "alpha", "export type AOnly = never;\n");

        const { entries } = scanDtoPlaceholders(root);
        expect(entries.map((entry) => entry.typeName)).toEqual(["AOnly", "ZFirst", "ZSecond"]);
    });
});

describe("readPlaceholderBaseline", () => {
    it("文件缺失 → 空台账（不抛异常）", () => {
        expect(readPlaceholderBaseline("/nonexistent/baseline.json")).toEqual({ count: 0, entries: [] });
    });

    it("内容损坏 → parseError 标记（门禁可据此报「台账坏了」）", () => {
        const dir = makeRoot();
        const file = path.join(dir, "broken.json");
        fs.writeFileSync(file, "{not json");
        expect(readPlaceholderBaseline(file)).toMatchObject({ count: 0, parseError: true });
    });

    it("正常台账读出 count 与 entries", () => {
        const dir = makeRoot();
        const file = path.join(dir, "ok.json");
        const entries = [{ module: "cas", filePath: "src/cas/__generated__/dto.ts", typeName: "CasX", line: 1 }];
        fs.writeFileSync(file, JSON.stringify({ count: 1, entries }));
        expect(readPlaceholderBaseline(file).entries).toHaveLength(1);
    });
});

describe("placeholderId", () => {
    it("稳定标识 = filePath::typeName（与行号无关，生成物重排不误判）", () => {
        expect(
            placeholderId({ module: "cas", filePath: "src/cas/__generated__/dto.ts", typeName: "CasX", line: 9 }),
        ).toBe("src/cas/__generated__/dto.ts::CasX");
    });
});
