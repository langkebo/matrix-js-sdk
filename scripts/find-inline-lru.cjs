const fs = require("fs");

const files = [
    "src/ephemeral/index.ts",
    "src/device/index.ts",
    "src/sticky-event/index.ts",
    "src/space/index.ts",
    "src/device-trust/index.ts",
    "src/profile/index.ts",
    "src/secure-backup/index.ts",
    "src/room-summary/index.ts",
    "src/room-keys/index.ts",
    "src/presence/index.ts",
    "src/pinned-messages/index.ts",
    "src/key-backup/index.ts",
    "src/crypto-keys/index.ts",
];

for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    let cacheEntryStart = -1;
    let lruCacheEnd = -1;
    let classStart = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^interface CacheEntry/)) {
            cacheEntryStart = i;
        }
        if (lines[i].match(/^class LRUCache/)) {
            classStart = i;
        }
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

    if (cacheEntryStart >= 0 && lruCacheEnd >= 0) {
        console.log(
            file +
                ": CacheEntry@" +
                (cacheEntryStart + 1) +
                " ClassStart@" +
                (classStart + 1) +
                " LRUCacheEnd@" +
                (lruCacheEnd + 1),
        );
    } else {
        console.log(file + ": NOT FOUND (CE=" + cacheEntryStart + " CS=" + classStart + " End=" + lruCacheEnd + ")");
    }
}
