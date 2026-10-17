#!/usr/bin/env node
/*
 * check-cross-repo-pin.mjs — cross-repo pin traceability gate.
 *
 * ## The gap this closes
 *
 * `Tjg/meta/sdk-pin.json` records three things that must agree with the two
 * sibling repositories at all times:
 *
 *   sdk_commit           → matrix-js-sdk HEAD（或：HEAD 前进但 `src/`+`package.json`
 *                          内容未变，即打进 tarball 的产物来源没变）
 *   synapse_rust_commit  → synapse-rust HEAD（或：HEAD 前进但 SDK 车道的 ledger
 *                          快照 `tests/unit/fixtures/ledger_export_sdk/*.json` 内容未变）
 *   tarball_sha256       == sha256(Tjg/vendor/matrix-js-sdk.tgz)
 *
 * ## 2026-10-14：commit 判据从「位置」收紧为「祖先 + 内容」
 *
 * 原先两条 commit 判据是**严格等于 HEAD**。这与 Tjg 自己的 `verify-sdk-pin.mjs` 矛盾：
 * 那边允许 pin 落后，只要区间内没有触碰「契约面」（`src/`+`package.json` / ledger 快照）。
 * 同一事实两套判据，两边都绿只是巧合 —— 一旦后端纯文档提交推进 HEAD，本门禁立刻红，
 * 而 Tjg 那边仍绿（实测：后端 `ed09854e5` 只往 ledger 目录**新增 sidecar `manifest.json`**、
 * 三个 profile JSON 一字未改，本门禁报 drift）。
 *
 * 现在两边同口径：**pin 的 commit 必须是 HEAD 的祖先**，且**中间不得改变内容载体**。
 * 位置不同但内容一致 ⇒ `ok`（附注说明）；内容真的变了 ⇒ `drift`；算不出来 ⇒ `unknown`
 * （`--strict` 下判红，沿用本文件「测不到 ≠ 不一致」的既有约定）。
 *
 * `tarball_sha256` 与 `ledger_schema` 不含 commit，故不适用该回落逻辑。
 *
 * `Tjg/scripts/verify-sdk-pin.mjs` 检查的是*已安装产物*（版本串 + tarball hash + lib 指纹 +
 * 上面那条 ledger 内容判据），而工作区规则「sdk_commit 必须等于 matrix-js-sdk HEAD」此前
 * 没有机器执行。2026-09-13 成熟度复审正是这么发现镜像、pin 与两个 HEAD 各指一处（P0-4）。
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
 *   1  drift detected, or skipped/unknown under --strict, or a waiver is malformed/expired
 *
 * `unknown` (a declaration could not be read, e.g. the backend module moved) is
 * reported as its own status rather than as drift — see the candidate path list below.
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
        label: "sdk_commit == matrix-js-sdk HEAD (or HEAD moved without touching src/ + package.json)",
        pinField: "sdk_commit",
    },
    {
        key: "synapse_rust_commit",
        label: "synapse_rust_commit == synapse-rust HEAD (or HEAD moved without changing the SDK-lane ledger snapshot)",
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
 * 内容载体：pin 的 commit 与 HEAD 之间，只有这些路径的内容变了，才需要重钉。
 * 与 `Tjg/scripts/verify-sdk-pin.mjs` 的口径**逐字一致**（那边 sdk_commit freshness
 * 也只看 `src/` + `package.json`）。两处若各改各的，就又回到「同一事实两套判据」。
 */
const SDK_CONTENT_PATHS = ["src", "package.json"];

/**
 * 后端 SDK 车道 ledger 快照。**只列三个 profile JSON，不列整个目录**：
 * 目录里还有 sidecar `manifest.json`，它可以在后续提交里被单独新增（`ed09854e5` 就是），
 * 那种情况下 SDK 摄入的内容一字未变，把它算进内容载体就会制造假阳性。
 */
const BACKEND_LEDGER_CONTENT_PATHS = [
    "tests/unit/fixtures/ledger_export_sdk/all.json",
    "tests/unit/fixtures/ledger_export_sdk/default.json",
    "tests/unit/fixtures/ledger_export_sdk/worker.json",
];

/**
 * The two places the ledger schema version is declared as source of truth:
 *   - SDK:   LEDGER_SCHEMA_VERSION in scripts/contract-sync.mjs
 *   - backend: pub const SCHEMA_VERSION in the ledger-export module
 * Both must equal the pin's `ledger_schema`. This is the binding that was
 * missing when backend schema 1→2→3→4 left the pin frozen at "1" — the three
 * commit/hash bindings can all be green while the schema silently drifts.
 *
 * The backend path is a **candidate list**, not a single hard-coded path: the
 * backend crate split moved it from `src/web/routes/` to `synapse-web/src/routes/`,
 * and the stale single path made this sub-check report `(unset) (backend)` — i.e.
 * it turned "could not read it" into a fake "drift". A file that does not exist
 * must never be reported as a disagreement.
 */
const SDK_CONTRACT_SYNC = "scripts/contract-sync.mjs";
const BACKEND_LEDGER_EXPORT_CANDIDATES = [
    "synapse-web/src/routes/ledger_export.rs", // current layout (crate split)
    "src/web/routes/ledger_export.rs", // pre-split layout
];

function readSdkLedgerSchema(root) {
    const file = path.join(root, SDK_CONTRACT_SYNC);
    if (!fs.existsSync(file)) return "";
    const m = /LEDGER_SCHEMA_VERSION\s*=\s*["']([^"']+)["']/.exec(fs.readFileSync(file, "utf8"));
    return m ? m[1] : "";
}

/** @returns `""` when no candidate layout exists or declares SCHEMA_VERSION. */
function readBackendSchemaVersion(root) {
    for (const relative of BACKEND_LEDGER_EXPORT_CANDIDATES) {
        const file = path.join(root, relative);
        if (!fs.existsSync(file)) continue;
        const m = /SCHEMA_VERSION\s*:\s*&str\s*=\s*["']([^"']+)["']/.exec(fs.readFileSync(file, "utf8"));
        if (m) return m[1];
    }
    return "";
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

/**
 * 「两端内容是否变了」判据（取代旧的「区间内有没有提交碰过这些路径」位置判据）。
 *
 * `git diff --quiet <from> <to> -- <paths>` 比的是**两端的内容**，因此「只在同目录新增
 * 一个无关文件」这类提交不会误报（这正是 2026-10-13 实测到的假阳性形态）。
 *
 * @returns `true` 内容变了 / `false` 内容一致 / `null` 无法判定（rev 不存在、非本仓等）
 */
export function contentChanged(repoRoot, fromRev, toRev, paths) {
    if (!fromRev || !toRev) return null;
    if (fromRev === toRev) return false;
    try {
        execFileSync("git", ["diff", "--quiet", fromRev, toRev, "--", ...paths], {
            cwd: repoRoot,
            stdio: ["ignore", "ignore", "ignore"],
        });
        return false; // exit 0 ⇒ 两端内容一致
    } catch (err) {
        if (err?.status === 1) return true; // exit 1 ⇒ 有差异
        return null; // 其他非零（rev 不存在 / 不是本仓的提交）⇒ 测不到
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
export function evaluatePin({
    pin,
    sdkHead,
    backendHead,
    tarballSha,
    sdkLedgerSchema,
    backendSchemaVersion,
    waivers,
    sdkContentChanged = null,
    backendLedgerChanged = null,
    today = new Date(),
}) {
    const actual = {
        sdk_commit: sdkHead,
        synapse_rust_commit: backendHead,
        tarball_sha256: tarballSha,
    };

    /**
     * 位置不同时用来回落的**内容**判据。缺席（`undefined`/`null`）= 测不到 ⇒ `unknown`。
     * `tarball_sha256` 本身就是内容（哈希），无回落；`ledger_schema` 走单独分支。
     */
    const contentFallback = {
        sdk_commit: {
            changed: sdkContentChanged,
            contentLabel: "打进 tarball 的产物来源（src/ + package.json）",
        },
        synapse_rust_commit: {
            changed: backendLedgerChanged,
            contentLabel: "SDK 车道的 ledger 快照（tests/unit/fixtures/ledger_export_sdk/*.json）",
        },
    };

    const schemaValues = [pin?.ledger_schema ?? "", sdkLedgerSchema ?? "", backendSchemaVersion ?? ""];
    // "cannot read" ≠ "disagrees": a missing declaration must not be reported as drift,
    // otherwise a stale reader path below is indistinguishable from a real version skew
    // (that is exactly how a wrong `src/web/routes/...` path reported `(unset)` as drift).
    const schemaUnknown = schemaValues.some((v) => v === "");
    const schemaMatches = !schemaUnknown && schemaValues.every((v) => v === schemaValues[0]);

    const results = [];
    for (const check of CHECKS) {
        if (check.key === "ledger_schema") {
            results.push({
                ...check,
                expected: schemaValues[0] || "(empty)",
                actual: schemaMatches
                    ? schemaValues[0]
                    : `${schemaValues[1] || "(unset)"} (SDK) / ${schemaValues[2] || "(unset)"} (backend)`,
                status: schemaUnknown ? "unknown" : schemaMatches ? "ok" : "drift",
                note: schemaUnknown
                    ? "one of the three declarations could not be read; --strict turns this into a failure"
                    : "",
            });
            continue;
        }

        const expected = pin?.[check.pinField] ?? "";
        const found = actual[check.key] ?? "";

        let status;
        let note = "";
        if (expected === "") {
            // pin 缺字段：这是配置问题，不是"测不到"，照旧判 drift
            status = "drift";
            note = `pin is missing '${check.pinField}'`;
        } else if (expected === found) {
            status = "ok";
        } else {
            const fallback = contentFallback[check.key];
            if (!fallback) {
                status = "drift";
            } else if (fallback.changed === false) {
                // 位置不同、内容一致 ⇒ 不需要重钉（这正是把判据从"位置"改为"内容"的目的）
                status = "ok";
                note = `HEAD moved but ${fallback.contentLabel} is unchanged — no re-pin needed`;
            } else if (fallback.changed === true) {
                status = "drift";
                note = `${fallback.contentLabel} changed between the pinned commit and HEAD`;
            } else {
                status = "unknown";
                note = `cannot compare ${fallback.contentLabel} (pinned commit missing from the sibling history?); --strict turns this into a failure`;
            }
        }

        const waiver = findWaiver(waivers, check.key);
        if (status !== "ok" && waiver) {
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
    const sdkHead = gitHead(sdkRoot);
    const backendHead = gitHead(backendRoot);
    const results = evaluatePin({
        pin,
        sdkHead,
        backendHead,
        tarballSha: sha256File(tarballPath),
        sdkLedgerSchema: readSdkLedgerSchema(sdkRoot),
        backendSchemaVersion: readBackendSchemaVersion(backendRoot),
        // 位置不同时的内容回落判据（见 `contentChanged`）。测不到 = null ⇒ unknown。
        sdkContentChanged: contentChanged(sdkRoot, pin?.sdk_commit, sdkHead, SDK_CONTENT_PATHS),
        backendLedgerChanged: contentChanged(
            backendRoot,
            pin?.synapse_rust_commit,
            backendHead,
            BACKEND_LEDGER_CONTENT_PATHS,
        ),
        waivers,
    });

    // `unknown` means "could not check"; it fails only under --strict, matching this
    // file's existing convention for "cannot locate the sibling checkouts".
    const failures = results.filter(
        (r) => r.status === "drift" || r.status === "expired-waiver" || (strict && r.status === "unknown"),
    );

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
