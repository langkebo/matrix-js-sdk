const fs = require("fs");

const replacements = [
    {
        file: "src/ephemeral/index.ts",
        cacheName: "ephemeral-events",
        constructorLine: "new LRUCache<IEphemeralEventInfo[]>(100, 60 * 1000)",
        newConstructor:
            'new LRUCache<IEphemeralEventInfo[]>({ maxSize: 100, ttl: 60 * 1000, name: "ephemeral-events" })',
    },
    { file: "src/device/index.ts", cacheName: "device-list", constructorLine: null, newConstructor: null },
    { file: "src/sticky-event/index.ts", cacheName: "sticky-events", constructorLine: null, newConstructor: null },
    { file: "src/space/index.ts", cacheName: "space-list", constructorLine: null, newConstructor: null },
    { file: "src/device-trust/index.ts", cacheName: "device-trust", constructorLine: null, newConstructor: null },
    { file: "src/profile/index.ts", cacheName: "profile", constructorLine: null, newConstructor: null },
    { file: "src/secure-backup/index.ts", cacheName: "secure-backup", constructorLine: null, newConstructor: null },
    { file: "src/room-summary/index.ts", cacheName: "room-summary", constructorLine: null, newConstructor: null },
    { file: "src/room-keys/index.ts", cacheName: "room-keys", constructorLine: null, newConstructor: null },
    { file: "src/presence/index.ts", cacheName: "presence", constructorLine: null, newConstructor: null },
    { file: "src/pinned-messages/index.ts", cacheName: "pinned-messages", constructorLine: null, newConstructor: null },
    { file: "src/key-backup/index.ts", cacheName: "key-backup", constructorLine: null, newConstructor: null },
    { file: "src/crypto-keys/index.ts", cacheName: "crypto-keys", constructorLine: null, newConstructor: null },
];

for (const { file } of replacements) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    let cacheEntryStart = -1;
    let classStart = -1;
    let lruCacheEnd = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^interface CacheEntry/)) cacheEntryStart = i;
        if (lines[i].match(/^class LRUCache/)) classStart = i;
    }

    if (classStart > 0) {
        let braceCount = 0;
        let foundOpen = false;
        for (let j = classStart; j < lines.length; j++) {
            for (const ch of lines[j]) {
                if (ch === "{") {
                    braceCount++;
                    foundOpen = true;
                }
                if (ch === "}") braceCount--;
            }
            if (foundOpen && braceCount === 0) {
                lruCacheEnd = j;
                break;
            }
        }
    }

    if (cacheEntryStart < 0 || lruCacheEnd < 0) {
        console.log("SKIP " + file + ": could not find inline LRUCache");
        continue;
    }

    // Remove inline CacheEntry + LRUCache (and any blank lines before/after)
    let removeStart = cacheEntryStart;
    while (removeStart > 0 && lines[removeStart - 1].trim() === "") removeStart--;
    let removeEnd = lruCacheEnd;
    while (removeEnd < lines.length - 1 && lines[removeEnd + 1].trim() === "") removeEnd++;

    const newLines = [...lines.slice(0, removeStart), ...lines.slice(removeEnd + 1)];

    // Find last import line
    let lastImportIdx = -1;
    for (let i = 0; i < newLines.length; i++) {
        if (newLines[i].startsWith("import ")) lastImportIdx = i;
    }

    // Check if LRUCache is already imported
    const hasLruImport = newLines.some(
        (l) => l.includes('from "../utils/lru-cache') || l.includes("from '../utils/lru-cache"),
    );
    const hasCacheRegistryImport = newLines.some((l) => l.includes("CacheRegistry"));

    if (!hasLruImport) {
        // Add import after last import
        const importLine = 'import { LRUCache, CacheRegistry, type CacheStats } from "../utils/lru-cache.ts";';
        newLines.splice(lastImportIdx + 1, 0, importLine);
    } else if (!hasCacheRegistryImport) {
        // Add CacheRegistry to existing import
        for (let i = 0; i < newLines.length; i++) {
            if (newLines[i].includes('from "../utils/lru-cache') || newLines[i].includes("from '../utils/lru-cache")) {
                newLines[i] = newLines[i].replace(
                    "import { LRUCache }",
                    "import { LRUCache, CacheRegistry, type CacheStats }",
                );
                break;
            }
        }
    }

    // Replace constructor calls: new LRUCache<Type>(number, number) -> new LRUCache<Type>({ maxSize, ttl, name })
    const finalContent = newLines.join("\n");

    // Find all new LRUCache<...>(number, number) patterns
    const updated = finalContent.replace(
        /new LRUCache<([^>]+)>\((\d+),\s*(\d+\s*\*\s*\d+\s*\*\s*\d+\s*|\d+)\)/g,
        (match, type, maxSize, ttl) => {
            const ttlClean = ttl.replace(/\s/g, "");
            return `new LRUCache<${type}>({ maxSize: ${maxSize}, ttl: ${ttlClean}, name: "${file.split("/").pop().replace("/index.ts", "")}-${type.toLowerCase().replace(/[^a-z]/g, "")}" })`;
        },
    );

    fs.writeFileSync(file, updated, "utf8");
    console.log("DONE " + file);
}
