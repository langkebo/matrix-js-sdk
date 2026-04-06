import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const libRoot = path.join(projectRoot, "lib");

const knownExtensions = new Set([
    ".js",
    ".mjs",
    ".cjs",
    ".json",
    ".node",
    ".wasm",
]);

function shouldRewriteSpecifier(spec) {
    if (!(spec.startsWith("./") || spec.startsWith("../"))) return false;
    if (spec.endsWith("/")) return false;
    const ext = path.extname(spec);
    return ext.length === 0 || !knownExtensions.has(ext) ? ext.length === 0 : false;
}

function fixSpecifier(spec, fromDir) {
    if (!shouldRewriteSpecifier(spec)) return spec;

    const candidateFile = path.resolve(fromDir, spec + ".js");
    if (existsSync(candidateFile)) return spec + ".js";

    const candidateIndex = path.resolve(fromDir, spec, "index.js");
    if (existsSync(candidateIndex)) return spec + "/index.js";

    return spec + ".js";
}

function rewriteSpecifiers(content, filePath) {
    const fromDir = path.dirname(filePath);
    let next = content;
    next = next.replace(/(\bimport\s+[^;]*?\sfrom\s+)(["'])(\.\.?\/[^"']+)\2/g, (match, p1, quote, spec) => {
        const fixed = fixSpecifier(spec, fromDir);
        if (fixed === spec) return match;
        return `${p1}${quote}${fixed}${quote}`;
    });

    next = next.replace(/(\bexport\s+[^;]*?\sfrom\s+)(["'])(\.\.?\/[^"']+)\2/g, (match, p1, quote, spec) => {
        const fixed = fixSpecifier(spec, fromDir);
        if (fixed === spec) return match;
        return `${p1}${quote}${fixed}${quote}`;
    });

    next = next.replace(/(\bimport\s*\(\s*)(["'])(\.\.?\/[^"']+)\2(\s*\))/g, (match, p1, quote, spec, p4) => {
        const fixed = fixSpecifier(spec, fromDir);
        if (fixed === spec) return match;
        return `${p1}${quote}${fixed}${quote}${p4}`;
    });

    return next;
}

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const out = [];
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            out.push(...(await walk(full)));
        } else {
            out.push(full);
        }
    }
    return out;
}

async function main() {
    const st = await stat(libRoot).catch(() => null);
    if (!st?.isDirectory()) {
        process.stderr.write(`Missing lib dir: ${libRoot}\n`);
        process.exit(1);
    }

    const files = (await walk(libRoot)).filter((f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs"));

    let changed = 0;
    for (const file of files) {
        const before = await readFile(file, "utf8");
        const after = rewriteSpecifiers(before, file);
        if (after !== before) {
            await writeFile(file, after, "utf8");
            changed += 1;
        }
    }

    process.stdout.write(`Rewrote ESM specifiers in ${changed} file(s)\n`);
}

await main();
