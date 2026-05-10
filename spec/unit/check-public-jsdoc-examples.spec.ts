import { describe, expect, it } from "vitest";

import {
    collectJSDocIndexFromSource,
    filterIssuesByChangedFiles,
    findMissingJSDocExamples,
    parseContractPublicApiReferences,
} from "../../scripts/quality/check-public-jsdoc-examples.mjs";

describe("check-public-jsdoc-examples", () => {
    it("passes when a documented public API method has an @example tag", () => {
        const references = parseContractPublicApiReferences(
            `
## 三、SDK 对齐状态
| 后端端点 | SDK 方法 | 状态 |
|---------|---------|------|
| \`GET /_matrix/client/v3/direct\` | \`dmManager.getDirectRoomsFromServer()\` | ✅ 已封装 |
`,
            "docs/api-contract/dm.md",
        );
        const methodIndex = collectJSDocIndexFromSource(
            `
export class DmManager {
    /**
     * 获取 direct map
     * @example
     * \`\`\`typescript
     * await dmManager.getDirectRoomsFromServer();
     * \`\`\`
     */
    public getDirectRoomsFromServer(): Promise<void> {
        throw new Error("not implemented");
    }
}
`,
            "src/dm/index.ts",
        );

        expect(findMissingJSDocExamples(references, methodIndex)).toEqual([]);
    });

    it("fails when a documented public API method is missing JSDoc", () => {
        const references = parseContractPublicApiReferences(
            `
## 三、SDK 对齐状态
| 后端端点 | SDK 方法 | 状态 |
|---------|---------|------|
| \`PUT /_matrix/client/v3/direct/{room_id}\` | \`dmManager.updateDirectRoom()\` | ✅ 已封装 |
`,
            "docs/api-contract/dm.md",
        );
        const methodIndex = collectJSDocIndexFromSource(
            `
export class DmManager {
    public updateDirectRoom(): Promise<void> {
        throw new Error("not implemented");
    }
}
`,
            "src/dm/index.ts",
        );

        expect(findMissingJSDocExamples(references, methodIndex)).toMatchObject([
            { reason: "missing-jsdoc", owner: "DmManager", method: "updateDirectRoom" },
        ]);
    });

    it("fails when JSDoc exists but omits the required @example tag", () => {
        const references = parseContractPublicApiReferences(
            `
## 三、SDK 对齐状态
| 后端端点 | SDK 方法 | 状态 |
|---------|---------|------|
| \`GET /_matrix/client/v3/rooms/{room_id}/dm/partner\` | \`dmManager.getDmPartnerFromServer()\` | ✅ 已封装 |
`,
            "docs/api-contract/dm.md",
        );
        const methodIndex = collectJSDocIndexFromSource(
            `
export class DmManager {
    /**
     * 返回私聊对端资料。
     * @throws {AuthError} 当 access token 失效时抛出。
     */
    public getDmPartnerFromServer(): Promise<void> {
        throw new Error("not implemented");
    }
}
`,
            "src/dm/index.ts",
        );

        expect(findMissingJSDocExamples(references, methodIndex)).toMatchObject([
            { reason: "missing-example", owner: "DmManager", method: "getDmPartnerFromServer" },
        ]);
    });

    it("filters issues based on changed files (diff-scoping)", () => {
        const issues = [
            {
                file: "docs/api-contract/dm.md",
                implementationFile: "src/dm/index.ts",
                owner: "DmManager",
                method: "m1",
            },
            {
                file: "docs/api-contract/auth.md",
                implementationFile: "src/auth/index.ts",
                owner: "AuthManager",
                method: "m2",
            },
        ];

        // 1. Full scan (changedFiles is null)
        expect(filterIssuesByChangedFiles(issues, null)).toHaveLength(2);

        // 2. Scoped to docs change
        expect(filterIssuesByChangedFiles(issues, new Set(["docs/api-contract/dm.md"]))).toHaveLength(1);
        expect(filterIssuesByChangedFiles(issues, new Set(["docs/api-contract/dm.md"]))[0].method).toBe("m1");

        // 3. Scoped to source change
        expect(filterIssuesByChangedFiles(issues, new Set(["src/auth/index.ts"]))).toHaveLength(1);
        expect(filterIssuesByChangedFiles(issues, new Set(["src/auth/index.ts"]))[0].method).toBe("m2");

        // 4. No relevant changes
        expect(filterIssuesByChangedFiles(issues, new Set(["README.md"]))).toHaveLength(0);
    });
});
