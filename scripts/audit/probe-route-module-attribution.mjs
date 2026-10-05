import fs from "node:fs";
import path from "node:path";

const dir = "docs/api-contract/generated/modules";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
const probes = [
    "/rooms/{room_id}/anti_screenshot",
    "/rooms/{room_id}/sticky_events",
    "/rooms/{room_id}/notifications",
    "/rooms/{room_id}/timeline",
    "/rooms/{room_id}/metadata",
    "/rooms/{room_id}/turn_server",
    "/rooms/{room_id}/rendered/",
    "/rooms/{room_id}/fragments/{user_id}",
    "/translate",
];

const byPath = new Map();
for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const routes = [];
    JSON.stringify(j, (k, v) => {
        if (v && typeof v === "object" && typeof v.path === "string" && typeof v.method === "string") {
            routes.push(v.method + " " + v.path);
        }
        return v;
    });
    for (const r of new Set(routes)) {
        if (!byPath.has(r)) byPath.set(r, []);
        byPath.get(r).push(path.basename(f, ".json"));
    }
}

for (const p of probes) {
    const hits = [...byPath.entries()].filter(([r]) => r.includes(p));
    console.log("--- " + p);
    if (!hits.length) console.log("    (未在任何模块 manifest 中)");
    for (const [r, mods] of hits) console.log("    " + r + "  =>  " + mods.join(","));
}
