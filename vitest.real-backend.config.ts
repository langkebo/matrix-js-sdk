import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        globals: true,
        pool: "forks",
        // @ts-expect-error -- forks is top-level in Vitest 4 but types might lag
        forks: {
            isolate: false,
        },
        setupFiles: ["./spec/integ/real-backend/vitest.setup.ts"],
        teardownTimeout: 30000,
        exclude: ["**/node_modules/**", "**/dist/**"],
    } as any,
});
