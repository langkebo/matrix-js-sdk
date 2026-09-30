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
    // Try to find mkcert root from common locations (macOS & Linux)
    const caRootPaths = [
        // macOS: mkcert's default CAROOT
        process.env.HOME ? join(process.env.HOME, "Library/Application Support/mkcert") : null,
        // Linux (mkcert >= 1.4 default)
        process.env.HOME ? join(process.env.HOME, ".local/share/mkcert") : null,
        // Older Linux location
        "/usr/local/share/ca-certificates",
    ].filter(Boolean);

    for (const path of caRootPaths) {
        const candidate = join(path, "rootCA.pem");
        if (existsSync(candidate)) {
            env.NODE_EXTRA_CA_CERTS = candidate;
            console.log(`ℹ️  Found mkcert CA at ${candidate}`);
            return true;
        }
    }

    // Fallback: try mkcert command
    const mkcertCaroot = spawnSync("mkcert", ["-CAROOT"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
    });

    if (mkcertCaroot.status === 0) {
        const rootCaPath = join(mkcertCaroot.stdout.trim(), "rootCA.pem");
        if (existsSync(rootCaPath)) {
            env.NODE_EXTRA_CA_CERTS = rootCaPath;
            console.log(`ℹ️  Loaded mkcert CA: ${rootCaPath}`);
            return true;
        }
    }
    return false;
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

// Priority order:
//  1. An explicitly provided CA (env or MATRIX_REAL_BACKEND_CA_CERT).
//  2. A known CA root on this machine (mkcert). A CA *root* validates the whole
//     chain, which is what we want — see the note on `configureRemoteCertificate`.
//  3. The leaf certificate the server presents. This is a last resort: it only
//     trusts that one certificate (so it breaks as soon as the cert is renewed or
//     the hostname/SAN changes), and it silently succeeds even when the CA is
//     misconfigured, which is how the mkcert case went unnoticed.
if (!env.NODE_EXTRA_CA_CERTS) {
    const explicitCaPath = env.MATRIX_REAL_BACKEND_CA_CERT;
    if (explicitCaPath && existsSync(explicitCaPath)) {
        env.NODE_EXTRA_CA_CERTS = explicitCaPath;
    }
}

if (!env.NODE_EXTRA_CA_CERTS) {
    configureMkcertCa();
}

if (!env.NODE_EXTRA_CA_CERTS) {
    tempCaDir = configureRemoteCertificate();
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
