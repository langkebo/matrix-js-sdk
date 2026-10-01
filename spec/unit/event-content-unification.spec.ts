/*
 * ADR-0005 / DTO-2 的回归防线：事件内容只能有一种写法（`IContent`）。
 *
 * 改造前同一概念有三种写法：`content: unknown`（sliding-sync）、
 * `content: Record<string, unknown>`（ephemeral/sync/room）、以及 `IContent`（运行时模型）。
 * 消费端因此无法用同一套代码处理，类型也随模块而异。这个用例把"一种写法"钉住：
 *   - 四个模块的生成 DTO 里不再出现 `content: unknown` / `content: Record<string, unknown>`；
 *   - sliding-sync 的 timeline 与运行时 `MSC3575RoomData.timeline` **形状等价**（编译期双向可赋值）；
 *   - `IContent` 的开放性（未知键可写）与具名键（`body: string | undefined`）都在。
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { IContent } from "../../src/models/event";
import type { MSC3575RoomData } from "../../src/sliding-sync";
import type { SlidingSyncTimeline } from "../../src/sliding-sync/__generated__/dto";

const UNIFIED_MODULES = ["sliding-sync", "ephemeral", "sync", "room"] as const;

describe("事件内容统一到 IContent（ADR-0005 / DTO-2）", () => {
    it.each(UNIFIED_MODULES)("src/%s 的生成 DTO 不再有第二种内容写法", (moduleName) => {
        const content = fs.readFileSync(path.resolve(`src/${moduleName}/__generated__/dto.ts`), "utf8");

        expect(content).not.toMatch(/\bcontent\??:\s*unknown\b/);
        expect(content).not.toMatch(/\bcontent\??:\s*Record<string,\s*unknown>/);
        // 且必须真的用上了 canonical 类型（不是把字段删了了事）
        expect(content).toMatch(/import type \{ IContent \} from "\.\.\/\.\.\/models\/event\.ts";/);
    });

    it("sliding-sync 的 timeline 与运行时 MSC3575RoomData.timeline 形状等价（编译期双向可赋值）", () => {
        type RuntimeTimeline = NonNullable<MSC3575RoomData["timeline"]>;
        type GeneratedTimeline = SlidingSyncTimeline["events"];

        const asRuntime: RuntimeTimeline = [] as GeneratedTimeline;
        const asGenerated: GeneratedTimeline = [] as RuntimeTimeline;

        expect(asRuntime).toEqual([]);
        expect(asGenerated).toEqual([]);
    });

    it("IContent 保留具名键类型，同时接受未知键", () => {
        const content: IContent = { msgtype: "m.text", body: "hi", future_field: 42 };

        // 编译期：具名键是真实类型
        const body: string | undefined = content.body;
        const msgtype: string | undefined = content.msgtype;
        // 编译期：未知键可读且为 unknown
        const unknownRead: unknown = content["m.unknown.future"];

        expect(body).toBe("hi");
        expect(msgtype).toBe("m.text");
        expect(unknownRead).toBeUndefined();
    });

    it("to-device 事件数组用 canonical 的 IToDeviceEvent，而不是 unknown[]", () => {
        const content = fs.readFileSync(path.resolve("src/sliding-sync/__generated__/dto.ts"), "utf8");

        expect(content).toMatch(/events: IToDeviceEvent\[\];/);
        expect(content).not.toMatch(/events: unknown\[\];/);
    });
});
