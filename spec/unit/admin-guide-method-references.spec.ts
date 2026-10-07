/*
Copyright 2026 The Matrix.org Foundation C.I.C.

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

/**
 * 守卫：`docs/ADMIN_GUIDE.md` 里出现的 `adminManager.<name>(...)` 必须真的存在于
 * `src/admin/**` 的公开面里。
 *
 * 为什么需要它：这份指南**不在** `quality:docs-examples` 的扫描集内
 * （该门禁的 `SCOPE_DIR` 硬编码 `docs/guide`，且只抽带 `title="..."` 的围栏），
 * 于是它的示例长期无人校验 —— 实测曾有 7 个方法、12 处调用指向**不存在的 API**
 * （`getUsers` / `getRooms` / `forceJoinRoom` / `forceLeaveRoom` / `banUser` /
 * `unbanUser` / `kickUser`），而示例里的响应字段也是编的
 * （`room.public`、`members.join(...)`、`user.last_seen_ts`）。对照审计
 * `artifacts/quality-gate-fingerprint-audit-2026-10-06.md` §7.15-24。
 *
 * 判据只要求「名字在 admin 层出现过」，不做签名/返回类型比对：
 * 指南是文档、示例允许省略参数，但**不允许调用不存在的方法**。
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.join(__dirname, "..", "..");
const GUIDE_PATH = path.join(REPO_ROOT, "docs", "ADMIN_GUIDE.md");
const ADMIN_DIR = path.join(REPO_ROOT, "src", "admin");

/** 收集 `adminManager.<name>(` 里的方法名（去重、排序）。 */
export function collectGuideMethodNames(guideSource: string): string[] {
    return [...new Set([...guideSource.matchAll(/adminManager\.([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]))].sort();
}

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (entry.name.endsWith(".ts")) acc.push(full);
    }
    return acc;
}

/**
 * admin 层里所有「像方法名」的标识符集合：方法声明 / 接口成员 / 对象字面量方法。
 *
 * 用 `(?<![A-Za-z0-9_$])NAME(?![A-Za-z0-9_$])` 做全词匹配，避免 `getUsers` 被
 * `getUsersPaginated` 误判为存在（这是本守卫最容易失效的地方）。
 */
export function collectAdminMethodNames(adminSources: string[]): Set<string> {
    const names = new Set<string>();
    for (const src of adminSources) {
        for (const m of src.matchAll(/(?<![A-Za-z0-9_$])([A-Za-z_]\w*)(?![A-Za-z0-9_$])\s*[(<]/g)) {
            names.add(m[1]);
        }
    }
    return names;
}

describe("docs/ADMIN_GUIDE.md", () => {
    const guideSource = fs.readFileSync(GUIDE_PATH, "utf8");
    const adminSources = walk(ADMIN_DIR).map((f) => fs.readFileSync(f, "utf8"));
    const adminNames = collectAdminMethodNames(adminSources);
    const referenced = collectGuideMethodNames(guideSource);

    it("引用到的 adminManager 方法数量非零（防止解析器失效导致恒真）", () => {
        // 阴性对照的一部分：如果正则失效，referenced 会是空数组，本断言先红。
        expect(referenced.length).toBeGreaterThan(10);
    });

    it("每个被引用的方法都能在 src/admin/** 里找到", () => {
        const missing = referenced.filter((name) => !adminNames.has(name));
        expect(missing, `docs/ADMIN_GUIDE.md 引用了不存在的 admin 方法: ${missing.join(", ")}`).toEqual([]);
    });

    it("阳性对照：合成一个不存在的方法名时必须报出来", () => {
        // 只用**确定不存在**的名字 —— `getUserId` 会被 admin 层里 `client.getUserId()` 命中，
        // 故不能当对照组（第一版就是这么写错的）。
        const synthetic = collectGuideMethodNames("adminManager.getBogusCapability(); adminManager.anotherGhost();");
        expect(synthetic).toEqual(["anotherGhost", "getBogusCapability"]);
        const missing = synthetic.filter((name) => !adminNames.has(name));
        expect(missing).toEqual(["anotherGhost", "getBogusCapability"]);
    });

    it("阴性对照：合成`getUsersPaginated` 不得被判成 `getUsers` 存在", () => {
        const names = collectAdminMethodNames(["class X { async getUsersPaginated() {} }"]);
        expect(names.has("getUsersPaginated")).toBe(true);
        expect(names.has("getUsers")).toBe(false);
    });
});
