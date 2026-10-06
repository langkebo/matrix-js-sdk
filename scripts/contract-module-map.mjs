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
    // 后端 `assembly` 是**核心 router 桶**（`assembly::create_router` / `*_compat`，
    // 104 条：login/logout/register/versions/capabilities/account/password/profile/
    // directory/well-known/…），不是 compat 重复集（与其它模块 manifest 差集为 104/104）。
    // 该文档在 `ROUTE_CONTRACT.md` 里按源文件分组，`装配` 无独立章节 ⇒ 走不了 doc 通道；
    // 但 ledger 是权威路由源，`loadLedgerEntriesForSdkDir` 会按本映射取到它。
    //
    // 为什么落到 `auth`：SDK 侧 `src/auth/__generated__/route-table.ts` 现有 96 条中
    // **90 条本身就是 assembly 路由**（历史冻结条目），即「SDK auth 表 = 后端 assembly 桶」
    // 这一事实早已存在，只是没写进映射。显式化后：
    //   - 缺失的 14 条（含 discovery 需要的 `/directory/room/{room_id}/alias[/{room_alias}]`
    //     与 profile 需要的 `/profile/{user_id}/{key_name}`）自动由 ledger 补齐；
    //   - 覆盖门禁把 `assembly` 计入 `auth` 目录，不再需要为它单独开 waiver。
    // 代价（已知、可接受）：auth 的断言面会多接受约 9 条核心路由（voip/_health/upload 等，
    // 均为后端真实路由，只是不属 auth 业务域）。若日后要收紧归属，应改为生成独立的
    // `src/assembly/__generated__/` 契约表并按需 union。
    assembly: "auth",
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
