#!/usr/bin/env node
/*
 * L4 弱网用例入口（阶段 3 · P3-2）。
 *
 * 把 SDK 的 baseUrl 指到 toxiproxy 的代理端口，再交给已有的 CA 注入 runner 执行
 * `spec/integ/real-backend/weak-network/`（CA 会从**代理**上抓取证书，所以自签证书
 * 在 proxy 后面同样可用 —— 已实测 openssl s_client 经代理可取到 matrix.test 的证书）。
 *
 * 用法：
 *   docker compose -f spec/integ/real-backend/weak-network/docker-compose.toxiproxy.yml up -d
 *   pnpm test:real-backend:l4
 *   L4_MESSAGE_COUNT=1000 pnpm test:real-backend:l4   # nightly 量级
 *
 * 环境变量：
 *   MATRIX_REAL_BACKEND_BASE_URL  覆盖则完全接管（不再套代理端口）
 *   TOXIPROXY_PROXY_PORT          代理入口端口，默认 8666
 *   L4_MESSAGE_COUNT / L4_SEND_BUDGET  透传给 spec
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const proxyPort = process.env.TOXIPROXY_PROXY_PORT ?? "8666";

const env = {
    ...process.env,
    MATRIX_REAL_BACKEND_BASE_URL: process.env.MATRIX_REAL_BACKEND_BASE_URL ?? `https://matrix.test:${proxyPort}`,
};

const result = spawnSync(
    process.execPath,
    [
        path.join(repoRoot, "scripts", "run-real-backend-with-ca.mjs"),
        "pnpm",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.real-backend.config.ts",
        "spec/integ/real-backend/weak-network/",
    ],
    { cwd: repoRoot, stdio: "inherit", env },
);

process.exit(result.status ?? 1);
