import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["spec/integ/real-backend/**/*.test.ts", "spec/integ/real-backend/**/*.spec.ts"],
        testTimeout: 30000,
        hookTimeout: 30000,
        reporters: ["verbose"],
        globals: true,
        setupFiles: [],
    },
});
