import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        coverage: {
            include: ["src/codegen/**/*.ts"],
            provider: "v8",
            reporter: ["text", "lcov"],
            thresholds: {
                branches: 90,
                functions: 90,
                lines: 90,
                statements: 90,
            },
        },
        environment: "node",
        globals: true,
        include: [
            "spec/unit/codegen-tools.spec.ts",
            "spec/unit/codegen-template-validation.spec.ts",
            "spec/unit/sdk-contract-codegen.spec.ts",
            "spec/unit/contract-sync.spec.ts",
        ],
        pool: "threads",
        setupFiles: "spec/setupTests.ts",
        testTimeout: 30000,
    },
});
