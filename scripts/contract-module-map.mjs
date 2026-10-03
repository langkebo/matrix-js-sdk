/*
 * Ledger 模块 ↔ SDK 目录的映射（**唯一真相源**）。
 *
 * 为什么单独抽出来：这份映射原本只存在于 `scripts/quality/check-manager-codegen-coverage.mjs`
 * 里，SDK-1 之后 codegen 也要用它把 ledger 清单渲染成 route-table；两边各抄一份迟早
 * 会出现"门禁说 A 目录、codegen 写到 B 目录"这种更难查的漂移。
 *
 * 映射本身是**多对一**的（一个 SDK 目录可能承载多个 ledger 模块，例如 push 目录同时对应
 * ledger 的 push 与 push_notification），因此这里同时提供正向与反向查询；反向查询需要
 * ledger 模块名清单（来自 `docs/api-contract/generated/index.json`）。
 */

/** 以**SDK 目录名**为键的别名表。 */
export const LEDGER_MODULE_ALIASES = {
    "account-data": "account_data",
    admin: "admin",
    appservice: "app_service",
    "background-update": "background_update",
    "burn-after-read": "burn_after_read",
    captcha: "captcha",
    cas: "cas",
    device: "device",
    dm: "dm",
    e2ee: "e2ee_routes",
    ephemeral: "ephemeral",
    "event-report": "event_report",
    "external-service": "external_service",
    "feature-flags": "feature_flags",
    federation: "federation",
    friend: "friend_room",
    "invite-blocklist": "invite_blocklist",
    guest: "guest",
    "key-backup": "key_backup",
    "key-rotation": "key_rotation",
    media: "media",
    moderation: "moderation",
    module: "module",
    notifications: "push_notification",
    oidc: "oidc",
    presence: "presence",
    push: "push",
    reactions: "reactions",
    relations: "relations",
    rendezvous: "rendezvous",
    room: "room",
    "room-summary": "room_summary",
    saml: "saml",
    search: "search",
    "sliding-sync": "sliding_sync",
    space: "space",
    sync: "sync",
    tags: "tags",
    telemetry: "telemetry",
    thirdparty: "thirdparty",
    thread: "thread",
    typing: "typing",
    voice: "voice",
    widget: "widget",
    "worker-admin": "worker",
    "worker-body": "worker_body",
};

/**
 * Ledger 模块名 → SDK 目录覆盖。
 *
 * `LEDGER_MODULE_ALIASES` 以 SDK 目录为键，表达不了"ledger 名 ≠ 目录名"的情形：
 * `thirdparty` / `msc4108_rendezvous` / `background_update` 会解析到不存在的目录，
 * 于是明明已生成 route-table 的模块被记成 NO_CODEGEN（阶段 2 实测的 3 个假缺口）。
 */
export const LEDGER_MODULE_TO_SDK_DIR = {
    background_update: "background-update",
    msc4108_rendezvous: "rendezvous",
    thirdparty: "third-party",
};

/** Ledger 模块名 → SDK 目录。 */
export function findSdkDirForModule(moduleName) {
    if (LEDGER_MODULE_TO_SDK_DIR[moduleName]) return LEDGER_MODULE_TO_SDK_DIR[moduleName];
    for (const [sdkDir, ledgerModule] of Object.entries(LEDGER_MODULE_ALIASES)) {
        if (ledgerModule === moduleName) return sdkDir;
    }
    return moduleName;
}

/**
 * SDK 目录 → 该目录承载的 ledger 模块名（多对一，可能多于一个）。
 *
 * `moduleNames` 用 `docs/api-contract/generated/index.json` 的模块清单（必须传，
 * 否则无法知道 ledger 侧有哪些模块名）。
 */
export function findLedgerModulesForSdkDir(sdkDir, moduleNames) {
    return moduleNames.filter((moduleName) => findSdkDirForModule(moduleName) === sdkDir).sort();
}
