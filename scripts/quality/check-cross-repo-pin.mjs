#!/usr/bin/env node
/*
 * check-cross-repo-pin.mjs — cross-repo pin traceability gate.
 *
 * ## The gap this closes
 *
 * `Tjg/meta/sdk-pin.json` records three things that must agree with the two
 * sibling repositories at all times:
 *
 *   sdk_commit           == matrix-js-sdk HEAD
 *   synapse_rust_commit  == synapse-rust HEAD
 *   tarball_sha256       == sha256(Tjg/vendor/matrix-js-sdk.tgz)
 *
 * `Tjg/scripts/verify-sdk-pin.mjs` only checks the *installed artifact*
 * (version string + tarball hash), and the workspace `CLAUDE.md` rule
 * "sdk_commit must equal matrix-js-sdk HEAD" had no machine enforcement at all.
 * That is how the 2026-09-13 maturity review found the mirror, the pin and both
 * HEADs all pointing at different commits (P0-4).
 *
 * ## Where it runs
 *
 * This is a **workspace-time** check: it needs the sibling checkouts, so it is
 * NOT wired into the SDK's own CI (which checks out this repo alone) — there it
 * would only ever skip. Run it locally before committing an SDK change, and in
 * the workspace/release flow. `--strict` turns "cannot check" into a failure so
 * a release job can require that the check actually ran.
 *
 * ## Waivers
 *
 * Deliberate, time-boxed drift is expressed in
 * `scripts/quality/cross-repo-pin-waivers.json` (NOT in the pin itself: the pin
 * schema is `additionalProperties: false`). Every waiver needs a `reason` and an
 * `expires` date; an expired waiver fails the gate.
 *
 * Usage:
 *   node scripts/quality/check-cross-repo-pin.mjs
 *   node scripts/quality/check-cross-repo-pin.mjs --strict
 *
 * Env:
 *   SYNAPSE_RUST_REPO   backend repo root      (default ../synapse-rust)
 *   TJG_REPO            frontend repo root     (default ../Tjg)
 *   CROSS_REPO_PIN_STRICT=1  same as --strict
 *
 * Exit codes:
 *   0  all three bindings agree (or the check was skipped and not strict)
 *   1  drift detected, or skipped under --strict, or a waiver is malformed/expired
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const sdkRoot = process.cwd();
const backendRoot = process.env.SYNAPSE_RUST_REPO ?? path.resolve(sdkRoot, "..", "synapse-rust");
const tjgRoot = process.env.TJG_REPO ?? path.resolve(sdkRoot, "..", "Tjg");

const pinPath = path.join(tjgRoot, "meta", "sdk-pin.json");
const tarballPath = path.join(tjgRoot, "vendor", "matrix-js-sdk.tgz");
const waiversPath = path.join(sdkRoot, "scripts", "quality", "cross-repo-pin-waivers.json");

const strict = process.argv.includes("--strict") || process.env.CROSS_REPO_PIN_STRICT === "1";

/** The bindings, in reporting order. */
export const CHECKS = [
    {
        key: "sdk_commit",
        label: "sdk_commit == matrix-js-sdk HEAD",
        pinField: "sdk_commit",
    },
    {
        key: "synapse_rust_commit",
        label: "synapse_rust_commit == synapse-rust HEAD",
        pinField: "synapse_rust_commit",
    },
    {
        key: "ledger_schema",
        label: "ledger_schema == SDK LEDGER_SCHEMA_VERSION == backend SCHEMA_VERSION",
        pinField: "ledger_schema",
    },
    {
        key: "tarball_sha256",
        label: "tarball_sha256 == sha256(vendor/matrix-js-sdk.tgz)",
        pinField: "tarball_sha256",
    },
];

/**
 * The two places the ledger schema version is declared as source of truth:
 *   - SDK:   LEDGER_SCHEMA_VERSION in scripts/contract-sync.mjs
 *   - backend: pub const SCHEMA_VERSION in src/web/routes/ledger_export.rs
 * Both must equal the pin's `ledger_schema`. This is the binding that was
 * missing when backend schema 1→2→3→4 left the pin frozen at "1" — the three
 * commit/hash bindings can all be green while the schema silently drifts.
 */
const SDK_CONTRACT_SYNC = "scripts/contract-sync.mjs";
const BACKEND_LEDGER_EXPORT = "src/web/routes/ledger_export.rs";

function readSdkLedgerSchema(root) {
    const file = path.join(root, SDK_CONTRACT_SYNC);
    if (!fs.existsSync(file)) return "";
    const m = /LEDGER_SCHEMA_VERSION\s*=\s*["']([^"']+)["']/.exec(fs.readFileSync(file, "utf8"));
    return m ? m[1] : "";
}

function readBackendSchemaVersion(root) {
    const file = path.join(root, BACKEND_LEDGER_EXPORT);
    if (!fs.existsSync(file)) return "";
    const m = /SCHEMA_VERSION\s*:\s*&str\s*=\s*["']([^"']+)["']/.exec(fs.readFileSync(file, "utf8"));
    return m ? m[1] : "";
}

function gitHead(repoRoot) {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return "";
    }
}

function sha256File(absPath) {
    return `sha256-${crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex")}`;
}

/** Read the waiver file; malformed entries are reported rather than ignored. */
function readWaivers() {
    if (!fs.existsSync(waiversPath)) return { waivers: [], problems: [] };

    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(waiversPath, "utf8"));
    } catch (err) {
        return { waivers: [], problems: [`${path.relative(sdkRoot, waiversPath)} is not valid JSON: ${err.message}`] };
    }

    const problems = [];
    const waivers = [];
    for (const entry of payload.waivers ?? []) {
        const { check, reason, expires } = entry ?? {};
        if (!CHECKS.some((c) => c.key === check)) {
            problems.push(`waiver for unknown check '${check}'`);
            continue;
        }
        if (!reason || !expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
            problems.push(`waiver for '${check}' needs both 'reason' and an 'expires' date (YYYY-MM-DD)`);
            continue;
        }
        waivers.push({ check, reason, expires });
    }
    return { waivers, problems };
}

function findWaiver(waivers, check) {
    return waivers.find((w) => w.check === check);
}

/** Compare pin against the sibling repos. Exported so it can be unit-tested. */
export function evaluatePin({ pin, sdkHead, backendHead, tarballSha, sdkLedgerSchema, backendSchemaVersion, waivers, today = new Date() }) {
    const actual = {
        sdk_commit: sdkHead,
        synapse_rust_commit: backendHead,
        tarball_sha256: tarballSha,
    };

    const schemaActual = [pin?.ledger_schema ?? "", sdkLedgerSchema ?? "", backendSchemaVersion ?? ""];
    const schemaMatches = schemaActual.every((v) => v !== "" && v === schemaActual[0]);

    const results = [];
    for (const check of CHECKS) {
        if (check.key === "ledger_schema") {
            results.push({
                ...check,
                expected: schemaActual[0] || "(empty)",
                actual: schemaMatches ? schemaActual[0] : `${schemaActual[1] || "(unset)"} (SDK) / ${schemaActual[2] || "(unset)"} (backend)`,
                status: schemaMatches ? "ok" : "drift",
                note: "",
            });
            continue;
        }
        const expected = pin?.[check.pinField] ?? "";
        const found = actual[check.key] ?? "";
        const matches = expected !== "" && expected === found;
        const waiver = findWaiver(waivers, check.key);

        let status = matches ? "ok" : "drift";
        let note = "";
        if (!matches && waiver) {
            const expired = new Date(waiver.expires) < today;
            status = expired ? "expired-waiver" : "waived";
            note = expired
                ? `waiver expired on ${waiver.expires} (${waiver.reason})`
                : `waived until ${waiver.expires} — ${waiver.reason}`;
        }
        results.push({ ...check, expected, actual: found, status, note });
    }
    return results;
}

function main() {
    const missing = [];
    if (!fs.existsSync(pinPath)) missing.push(path.relative(sdkRoot, pinPath));
    if (!fs.existsSync(tarballPath)) missing.push(path.relative(sdkRoot, tarballPath));
    if (!fs.existsSync(path.join(backendRoot, "Cargo.toml"))) missing.push(`${backendRoot} (backend checkout)`);

    if (missing.length > 0) {
        const message = `[cross-repo-pin] skipped: cannot locate ${missing.join(", ")}`;
        if (strict) {
            process.stderr.write(`${message}\n[cross-repo-pin] --strict was requested, so this is a failure.\n`);
            return 1;
        }
        process.stdout.write(
            `${message}\n[cross-repo-pin] set SYNAPSE_RUST_REPO / TJG_REPO, or use --strict to require it.\n`,
        );
        return 0;
    }

    const { waivers, problems } = readWaivers();
    if (problems.length > 0) {
        process.stderr.write("[cross-repo-pin] invalid waiver file:\n");
        for (const problem of problems) process.stderr.write(`- ${problem}\n`);
        return 1;
    }

    const pin = JSON.parse(fs.readFileSync(pinPath, "utf8"));
    const results = evaluatePin({
        pin,
        sdkHead: gitHead(sdkRoot),
        backendHead: gitHead(backendRoot),
        tarballSha: sha256File(tarballPath),
        sdkLedgerSchema: readSdkLedgerSchema(sdkRoot),
        backendSchemaVersion: readBackendSchemaVersion(backendRoot),
        waivers,
    });

    const failures = results.filter((r) => r.status === "drift" || r.status === "expired-waiver");

    for (const result of results) {
        const marker = result.status === "ok" ? "ok" : result.status;
        process.stdout.write(`[cross-repo-pin] ${marker.padEnd(15)} ${result.label}\n`);
        if (result.status !== "ok") {
            process.stdout.write(`                 pin:    ${result.expected || "(empty)"}\n`);
            process.stdout.write(`                 actual: ${result.actual || "(empty)"}\n`);
            if (result.note) process.stdout.write(`                 ${result.note}\n`);
        }
    }

    if (failures.length > 0) {
        process.stderr.write(
            "\n[cross-repo-pin] the pin disagrees with the sibling repositories.\n" +
                "  Fix by refreshing the pin from a committed SDK/backend state:\n" +
                "    1. commit the SDK and backend changes\n" +
                "    2. node ../Tjg/scripts/pack-sdk-tarball.mjs --apply --allow-commit-drift\n" +
                "    3. node scripts/quality/check-cross-repo-pin.mjs\n" +
                "  Or record time-boxed, justified drift in scripts/quality/cross-repo-pin-waivers.json.\n",
        );
        return 1;
    }

    const waived = results.filter((r) => r.status === "waived").length;
    process.stdout.write(`[cross-repo-pin] ok (${results.length - waived} bound, ${waived} waived)\n`);
    return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    process.exit(main());
}
