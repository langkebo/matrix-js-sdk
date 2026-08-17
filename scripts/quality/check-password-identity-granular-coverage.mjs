#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const CHECKS = [
    {
        module: "password-reset",
        groups: [
            {
                name: "PasswordResetManager password recovery routes",
                ownerFile: "src/password-reset/index.ts",
                methods: ["requestPasswordEmailToken", "requestPasswordMsisdnToken", "setPassword"],
                testFiles: ["spec/unit/password-reset.spec.ts"],
            },
            {
                name: "MatrixClient password recovery compatibility surface",
                ownerFile: "src/client.ts",
                methods: ["requestPasswordEmailToken", "requestPasswordMsisdnToken", "setPassword"],
                testFiles: ["spec/unit/matrix-client.spec.ts"],
            },
        ],
    },
    {
        module: "identity",
        groups: [
            {
                name: "IdentityManager identity lookup routes",
                ownerFile: "src/identity/index.ts",
                methods: ["getIdentityServerUrl", "lookup3pid", "store3pid", "requestVerificationToken", "bind3pid"],
                testFiles: ["spec/unit/identity.spec.ts"],
            },
            {
                name: "IdentityServerManager identity server config surface",
                ownerFile: "src/identity-server/index.ts",
                methods: ["getIdentityServerUrl", "setIdentityServerUrl"],
                testFiles: ["spec/unit/identity-server.spec.ts"],
            },
            // getIdentityServerUrl/setIdentityServerUrl 已迁 IdentityServerManager（前端经 getIdentityServerManager 调用），client 入口有意移除
        ],
    },
];

function readRelative(file) {
    return fs.readFileSync(path.join(projectRoot, file), "utf8");
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasMethod(content, method) {
    const escapedMethod = escapeRegex(method);
    const methodCall = new RegExp(`\\b${escapedMethod}(?:<[^>]+>)?\\s*\\(`);
    const propertyShape = new RegExp(`\\b${escapedMethod}\\s*:`);
    const delegatedCall = new RegExp(`\\.${escapedMethod}(?:<[^>]+>)?\\s*\\(`);
    return methodCall.test(content) || propertyShape.test(content) || delegatedCall.test(content);
}

function collectMissing(items, predicate) {
    return items.filter((item) => !predicate(item));
}

function main() {
    const failures = [];
    let totalGroups = 0;
    let passedGroups = 0;

    console.log("=== Password / Identity Granular Coverage ===");

    for (const moduleCheck of CHECKS) {
        console.log(`\n[${moduleCheck.module}]`);

        for (const group of moduleCheck.groups) {
            totalGroups += 1;
            const ownerContent = readRelative(group.ownerFile);
            const testContents = group.testFiles.map((file) => ({ file, content: readRelative(file) }));

            const missingMethods = collectMissing(group.methods, (method) => hasMethod(ownerContent, method));
            const methodsWithoutTests = collectMissing(group.methods, (method) =>
                testContents.some(({ content }) => content.includes(`${method}(`)),
            );

            if (missingMethods.length === 0 && methodsWithoutTests.length === 0) {
                passedGroups += 1;
                console.log(`  PASS: ${group.name}`);
                continue;
            }

            console.log(`  FAIL: ${group.name}`);
            if (missingMethods.length > 0) {
                console.log(`    missing methods in ${group.ownerFile}: ${missingMethods.join(", ")}`);
            }
            if (methodsWithoutTests.length > 0) {
                console.log(`    methods without test hits: ${methodsWithoutTests.join(", ")}`);
            }

            failures.push({
                module: moduleCheck.module,
                group: group.name,
                ownerFile: group.ownerFile,
                missingMethods,
                methodsWithoutTests,
            });
        }
    }

    console.log(`\nGroups passed: ${passedGroups}/${totalGroups}`);

    if (failures.length > 0) {
        console.log("\nGranular coverage gaps detected.");
        process.exitCode = 1;
        return;
    }

    console.log("\nGranular coverage check passed.");
}

main();
