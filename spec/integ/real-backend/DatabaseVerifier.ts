/// <reference types="node" />

/**
 * Database Verifier for SDK Real Backend Testing
 *
 * This utility provides database state verification capabilities using docker exec
 * to avoid needing pg dependency in the SDK project.
 */

import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execCallback);

export interface VerificationResult {
    passed: boolean;
    error?: string;
    expected?: unknown;
    actual?: unknown;
}

export interface QueryResult {
    rows: string[][];
    rowCount: number;
}

export class DatabaseVerifier {
    private requestedContainerName: string;
    private resolvedContainerName: string | null = null;

    constructor(containerName: string = "docker-postgres") {
        this.requestedContainerName = containerName;
    }

    private async resolveContainerName(): Promise<string> {
        if (this.resolvedContainerName) {
            return this.resolvedContainerName;
        }

        const configured = process.env.MATRIX_REAL_BACKEND_DB_CONTAINER;
        const candidates = [
            configured,
            this.requestedContainerName,
            "synapse-postgres",
            "docker-postgres",
        ].filter((name): name is string => Boolean(name));

        try {
            const { stdout } = await execAsync("docker ps --format '{{.Names}}'");
            const running = new Set(
                stdout
                    .split("\n")
                    .map((name) => name.trim())
                    .filter(Boolean),
            );

            const matched = candidates.find((name) => running.has(name));
            if (matched) {
                this.resolvedContainerName = matched;
                return matched;
            }

            throw new Error(
                `No matching postgres container found. Candidates: ${candidates.join(", ")}. Running: ${Array.from(running).join(", ")}`,
            );
        } catch (error: unknown) {
            const err = error as { message?: string };
            throw new Error(`Failed to resolve database container: ${err.message || String(error)}`);
        }
    }

    private async execPsql(sql: string): Promise<string> {
        const containerName = await this.resolveContainerName();
        const cmd = `docker exec ${containerName} psql -U synapse -d synapse -t -c "${sql.replace(/"/g, '\\"')}"`;

        try {
            const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
            return stdout.trim();
        } catch (error: unknown) {
            const err = error as { message?: string; stderr?: string };
            throw new Error(`psql error: ${err.stderr || err.message || String(error)}`);
        }
    }

    private async execPsqlWithHeaders(sql: string): Promise<string> {
        const containerName = await this.resolveContainerName();
        const cmd = `docker exec ${containerName} psql -U synapse -d synapse -c "${sql.replace(/"/g, '\\"')}"`;

        try {
            const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
            return stdout.trim();
        } catch (error: unknown) {
            const err = error as { message?: string; stderr?: string };
            throw new Error(`psql error: ${err.stderr || err.message || String(error)}`);
        }
    }

    private isHeaderOrSeparator(line: string): boolean {
        const trimmed = line.trim();
        // Skip empty lines
        if (!trimmed) return true;
        // Skip rows count line: "(XX rows)"
        if (trimmed.includes(" rows)")) return true;
        // Check if this is a pipe-separated format
        if (line.includes("|")) {
            // Skip separator lines: only dashes and/or plus signs
            if (/^[\s\-+|]+$/.test(trimmed)) return true;
            // For pipe format, skip the header line (first line with | that isn't a separator)
            // Header has 2 columns with short column names like "table_name | column_name"
            const parts = trimmed
                .split("|")
                .map((p) => p.trim())
                .filter(Boolean);
            if (parts.length === 2 && parts.every((p) => /^[a-z_]+$/.test(p))) {
                return true;
            }
            return false;
        }
        // Non-pipe format (aligned columns with spaces)
        // Skip separator lines: only dashes
        if (/^[\s-]+$/.test(trimmed)) return true;
        return false;
    }

    private parseDataLine(line: string): string[] {
        if (line.includes("|")) {
            return line
                .split("|")
                .map((v) => v.trim())
                .filter(Boolean);
        }
        // Non-pipe format: parse by multiple spaces
        const words = line
            .trim()
            .split(/\s{2,}/)
            .map((v) => v.trim())
            .filter(Boolean);
        return words;
    }

    async healthCheck(): Promise<boolean> {
        try {
            await this.execPsql("SELECT 1");
            return true;
        } catch {
            return false;
        }
    }

    async getTableCount(): Promise<number> {
        const result = await this.execPsql(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'",
        );
        return parseInt(result, 10) || 0;
    }

    async getIndexCount(): Promise<number> {
        const result = await this.execPsql("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public'");
        return parseInt(result, 10) || 0;
    }

    async getConfig(parameter: string): Promise<string | null> {
        try {
            return await this.execPsql(`SHOW ${parameter}`);
        } catch {
            return null;
        }
    }

    async getTableColumns(tableName: string): Promise<string[]> {
        const sql = `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}' AND table_schema = 'public' ORDER BY ordinal_position`;

        const output = await this.execPsqlWithHeaders(sql);
        if (!output) return [];

        const lines = output.split("\n").filter((line) => {
            const trimmed = line.trim();
            return trimmed && !this.isHeaderOrSeparator(trimmed);
        });

        return lines
            .map((line) => {
                // Use flexible parsing for both pipe and space-separated formats
                const trimmed = line.trim();
                if (trimmed.includes("|")) {
                    return (
                        trimmed
                            .split("|")
                            .map((v) => v.trim())
                            .filter(Boolean)[0] || ""
                    );
                }
                // Space-separated format (aligned columns)
                const words = trimmed.split(/\s{2,}/).filter(Boolean);
                return words[0] || "";
            })
            .filter((columnName) => Boolean(columnName) && columnName !== "column_name");
    }

    async getColumnType(tableName: string, columnName: string): Promise<string | null> {
        try {
            const sql = `SELECT data_type FROM information_schema.columns WHERE table_name = '${tableName}' AND column_name = '${columnName}' AND table_schema = 'public'`;
            return await this.execPsql(sql);
        } catch {
            return null;
        }
    }

    async verifyNoTimestampViolations(): Promise<{
        passed: boolean;
        violations: Array<{ table: string; column: string }>;
    }> {
        const sql = `SELECT table_name, column_name FROM information_schema.columns WHERE data_type LIKE '%timestamp%' AND table_schema = 'public' AND table_name NOT IN ('pg_stat_statements_info', 'schema_migrations', 'voice_usage_stats') ORDER BY table_name, column_name`;

        const output = await this.execPsqlWithHeaders(sql);
        if (!output) {
            return { passed: true, violations: [] };
        }

        const lines = output.split("\n").filter((line) => {
            const trimmed = line.trim();
            return trimmed && !this.isHeaderOrSeparator(trimmed);
        });

        const violations: Array<{ table: string; column: string }> = [];

        for (const line of lines) {
            const parts = this.parseDataLine(line);
            if (parts.length >= 2 && parts[0] && parts[1]) {
                violations.push({ table: parts[0], column: parts[1] });
            }
        }

        return { passed: violations.length === 0, violations };
    }

    async verifyPostgresConfig(): Promise<{ passed: boolean; issues: string[] }> {
        const issues: string[] = [];

        const sharedBuffers = await this.getConfig("shared_buffers");
        if (sharedBuffers !== "256MB") {
            issues.push(`shared_buffers: expected 256MB, got ${sharedBuffers}`);
        }

        const workMem = await this.getConfig("work_mem");
        if (workMem !== "16MB") {
            issues.push(`work_mem: expected 16MB, got ${workMem}`);
        }

        const randomPageCost = await this.getConfig("random_page_cost");
        if (randomPageCost !== "1.1") {
            issues.push(`random_page_cost: expected 1.1, got ${randomPageCost}`);
        }

        const effectiveIo = await this.getConfig("effective_io_concurrency");
        if (effectiveIo !== "200") {
            issues.push(`effective_io_concurrency: expected 200, got ${effectiveIo}`);
        }

        return { passed: issues.length === 0, issues };
    }

    async querySingle(sql: string): Promise<string> {
        return this.execPsql(sql);
    }

    async queryParsed(sql: string): Promise<string[][]> {
        const output = await this.execPsqlWithHeaders(sql);
        if (!output) return [];

        const lines = output.split("\n").filter((line) => {
            const trimmed = line.trim();
            return trimmed && !this.isHeaderOrSeparator(trimmed);
        });

        return lines.map((line) => this.parseDataLine(line));
    }

    async cleanup(testId: string): Promise<void> {
        try {
            await this.execPsql(`DELETE FROM rooms WHERE name LIKE '%${testId}%'`);
            await this.execPsql(`DELETE FROM users WHERE name LIKE '%${testId}%'`);
        } catch (error) {
            console.warn(`Cleanup warning:`, error);
        }
    }
}

export default DatabaseVerifier;
