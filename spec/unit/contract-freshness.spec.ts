import path from "node:path";
import { describe, expect, it } from "vitest";

import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const SCRIPT = path.join(repoRoot, "scripts", "quality", "check-contract-freshness.mjs");
const GENERATED = path.join(repoRoot, "docs", "api-contract", "generated");

/** Run check-contract-freshness.mjs and return { exitCode, stdout, stderr } */
function runFreshness(args: string[] = []): { exitCode: number; stdout: string; stderr: string } {
    try {
        const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { exitCode: 0, stdout, stderr: "" };
    } catch (e: unknown) {
        const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
        return {
            exitCode: err.status ?? 1,
            stdout: err.stdout ?? "",
            stderr: err.stderr ?? err.message ?? "",
        };
    }
}

describe("check-contract-freshness", () => {
    it("fresh mirror passes (source_timestamp today)", () => {
        const result = runFreshness();
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("RESULT: fresh");
        expect(result.stdout).toContain("age source: mirror refresh");
        // mirror age 可能是今天或几天前（只要在阈值内就算 fresh）
        expect(result.stdout).toMatch(/mirror age: (\d+ day\(s\) ago|today)/);
    });

    it("stale mirror fails with explicit --now in the far future", () => {
        const result = runFreshness(["--days=1", "--now=2030-01-01"]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("STALE");
        // 使用正则匹配天数（动态）
        expect(result.stderr).toMatch(/\d+ day\(s\) ago/);
    });

    it("default threshold is 30 days", () => {
        const result = runFreshness(["--help"]);
        expect(result.stdout).toContain("(default: 30)");
    });

    it("--source triggers semantic drift check and passes when mirror matches generated/", () => {
        const result = runFreshness([`--source=${GENERATED}`]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("semantic-check: mirror entries match the backend source");
    });

    it("missing --source directory is a hard failure", () => {
        const result = runFreshness(["--source=/nonexistent/path"]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("FAIL: source dir not found");
    });
});
