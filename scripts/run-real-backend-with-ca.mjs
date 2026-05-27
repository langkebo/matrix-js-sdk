import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const commandArgsInput = args[0] === "--" ? args.slice(1) : args;

if (commandArgsInput.length === 0) {
    console.error("Usage: node scripts/run-real-backend-with-ca.mjs <command> [args...]");
    process.exit(1);
}

const env = { ...process.env };
const realBackendBaseUrl = env.MATRIX_REAL_BACKEND_BASE_URL ?? "https://matrix.test";

function configureMkcertCa() {
    const mkcertCaroot = spawnSync("mkcert", ["-CAROOT"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
    });

    if (mkcertCaroot.status === 0) {
        const rootCaPath = join(mkcertCaroot.stdout.trim(), "rootCA.pem");
        if (existsSync(rootCaPath)) {
            env.NODE_EXTRA_CA_CERTS = rootCaPath;
        }
    }
}

function extractFirstCertificate(pemChain) {
    const match = pemChain.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    return match?.[0];
}

function configureRemoteCertificate() {
    try {
        const url = new URL(realBackendBaseUrl);
        if (url.protocol !== "https:") return undefined;

        const opensslResult = spawnSync(
            "openssl",
            ["s_client", "-showcerts", "-connect", `${url.hostname}:${url.port || "443"}`, "-servername", url.hostname],
            {
                encoding: "utf8",
                input: "",
                stdio: ["pipe", "pipe", "ignore"],
            },
        );

        if (opensslResult.status !== 0 || !opensslResult.stdout) return undefined;

        const certificate = extractFirstCertificate(opensslResult.stdout);
        if (!certificate) return undefined;

        const tempDir = mkdtempSync(join(tmpdir(), "matrix-real-backend-ca-"));
        const certPath = join(tempDir, `${url.hostname}.pem`);
        writeFileSync(certPath, `${certificate}\n`, "utf8");
        env.NODE_EXTRA_CA_CERTS = certPath;
        return tempDir;
    } catch {
        return undefined;
    }
}

let tempCaDir;

if (!env.NODE_EXTRA_CA_CERTS) {
    const explicitCaPath = env.MATRIX_REAL_BACKEND_CA_CERT;
    if (explicitCaPath && existsSync(explicitCaPath)) {
        env.NODE_EXTRA_CA_CERTS = explicitCaPath;
    }
}

if (!env.NODE_EXTRA_CA_CERTS) {
    tempCaDir = configureRemoteCertificate();
}

if (!env.NODE_EXTRA_CA_CERTS) {
    configureMkcertCa();
}

const [command, ...commandArgs] = commandArgsInput;
const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env,
    shell: false,
});

if (tempCaDir) {
    rmSync(tempCaDir, { recursive: true, force: true });
}

if (result.error) {
    console.error(result.error);
    process.exit(1);
}

process.exit(result.status ?? 1);
