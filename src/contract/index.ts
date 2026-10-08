/*
 * SDK ↔ 后端路由契约的聚合出口。
 *
 * 为什么需要这个文件
 * ------------------
 * 契约码表由 `pnpm run contract:codegen` 生成到 `src/<module>/__generated__/route-table.ts`，
 * 共 39 张表、853 条路由。此前消费者若要用这些常量，只能绕过 `package.json#exports`
 * 深度导入源文件（例如 `matrix-js-sdk/src/room/__generated__/route-table`）——
 * 那会把消费者绑死在 SDK 的**源码目录布局**上，且在同一份产物里混入另一个 SDK 检出。
 *
 * 本文件把这些表收敛为一个稳定的公开入口：
 *
 * ```ts
 * import { SDK_CONTRACT_ROUTE_TABLES, SDK_CONTRACT_ROUTES } from "matrix-js-sdk/contract";
 *
 * SDK_CONTRACT_ROUTE_TABLES.room;   // 单模块路由表（literal-typed）
 * SDK_CONTRACT_ROUTES;              // 全部 853 条，按模块拼接
 * ```
 *
 * 维护约定
 * --------
 * 本文件**不是**生成物（`__generated__/` 之外），但它的模块清单必须与磁盘上的
 * route-table 集合严格一致。`scripts/quality/check-contract-entrypoint.mjs` 会双向比对，
 * 任一侧多出或缺失模块都会让 CI 失败。
 */

import { ACCOUNT_DATA_ROUTES } from "../account-data/__generated__/route-table";
import { AUTH_ROUTES } from "../auth/__generated__/route-table";
import { BACKGROUND_UPDATE_ROUTES } from "../background-update/__generated__/route-table";
import { BURN_AFTER_READ_ROUTES } from "../burn-after-read/__generated__/route-table";
import { CAPTCHA_ROUTES } from "../captcha/__generated__/route-table";
import { CAS_ROUTES } from "../cas/__generated__/route-table";
import { DEVICE_ROUTES } from "../device/__generated__/route-table";
import { E2EE_ROUTES } from "../e2ee/__generated__/route-table";
import { EPHEMERAL_ROUTES } from "../ephemeral/__generated__/route-table";
import { EVENT_REPORT_ROUTES } from "../event-report/__generated__/route-table";
import { EXTERNAL_SERVICE_ROUTES } from "../external-service/__generated__/route-table";
import { FRIEND_ROUTES } from "../friend/__generated__/route-table";
import { GUEST_ROUTES } from "../guest/__generated__/route-table";
import { KEY_BACKUP_ROUTES } from "../key-backup/__generated__/route-table";
import { MEDIA_ROUTES } from "../media/__generated__/route-table";
import { MODERATION_ROUTES } from "../moderation/__generated__/route-table";
import { MODULE_ROUTES } from "../module/__generated__/route-table";
import { NOTIFICATIONS_ROUTES } from "../notifications/__generated__/route-table";
import { OIDC_ROUTES } from "../oidc/__generated__/route-table";
import { PRESENCE_ROUTES } from "../presence/__generated__/route-table";
import { PUSH_ROUTES } from "../push/__generated__/route-table";
import { RELATIONS_ROUTES } from "../relations/__generated__/route-table";
import { RENDEZVOUS_ROUTES } from "../rendezvous/__generated__/route-table";
import { ROOM_ROUTES } from "../room/__generated__/route-table";
import { ROOM_SUMMARY_ROUTES } from "../room-summary/__generated__/route-table";
import { SAML_ROUTES } from "../saml/__generated__/route-table";
import { SEARCH_ROUTES } from "../search/__generated__/route-table";
import { SLIDING_SYNC_ROUTES } from "../sliding-sync/__generated__/route-table";
import { SPACE_ROUTES } from "../space/__generated__/route-table";
import { SYNC_ROUTES } from "../sync/__generated__/route-table";
import { TAGS_ROUTES } from "../tags/__generated__/route-table";
import { TELEMETRY_ROUTES } from "../telemetry/__generated__/route-table";
import { THIRDPARTY_ROUTES } from "../third-party/__generated__/route-table";
import { THREAD_ROUTES } from "../thread/__generated__/route-table";
import { TYPING_ROUTES } from "../typing/__generated__/route-table";
import { VOICE_ROUTES } from "../voice/__generated__/route-table";
import { WIDGET_ROUTES } from "../widget/__generated__/route-table";
import { WORKER_ADMIN_ROUTES } from "../worker-admin/__generated__/route-table";
import { WORKER_BODY_ROUTES } from "../worker-body/__generated__/route-table";

/** 单条契约路由。`method`/`path` 在生成的表中是字面量类型，此处放宽为 string 以便聚合。 */
export interface SdkContractRoute {
    readonly method: string;
    readonly path: string;
}

/**
 * 按 SDK 模块分组的契约路由表。
 *
 * 键名与 `src/<module>/` 目录名一致；值即该模块生成的 `*_ROUTES` 常量本体
 * （保留字面量类型，可用于穷尽性校验）。
 */
export const SDK_CONTRACT_ROUTE_TABLES = {
    "account-data": ACCOUNT_DATA_ROUTES,
    auth: AUTH_ROUTES,
    "background-update": BACKGROUND_UPDATE_ROUTES,
    "burn-after-read": BURN_AFTER_READ_ROUTES,
    captcha: CAPTCHA_ROUTES,
    cas: CAS_ROUTES,
    device: DEVICE_ROUTES,
    e2ee: E2EE_ROUTES,
    ephemeral: EPHEMERAL_ROUTES,
    "event-report": EVENT_REPORT_ROUTES,
    "external-service": EXTERNAL_SERVICE_ROUTES,
    friend: FRIEND_ROUTES,
    guest: GUEST_ROUTES,
    "key-backup": KEY_BACKUP_ROUTES,
    media: MEDIA_ROUTES,
    moderation: MODERATION_ROUTES,
    module: MODULE_ROUTES,
    notifications: NOTIFICATIONS_ROUTES,
    oidc: OIDC_ROUTES,
    presence: PRESENCE_ROUTES,
    push: PUSH_ROUTES,
    relations: RELATIONS_ROUTES,
    rendezvous: RENDEZVOUS_ROUTES,
    room: ROOM_ROUTES,
    "room-summary": ROOM_SUMMARY_ROUTES,
    saml: SAML_ROUTES,
    search: SEARCH_ROUTES,
    "sliding-sync": SLIDING_SYNC_ROUTES,
    space: SPACE_ROUTES,
    sync: SYNC_ROUTES,
    tags: TAGS_ROUTES,
    telemetry: TELEMETRY_ROUTES,
    "third-party": THIRDPARTY_ROUTES,
    thread: THREAD_ROUTES,
    typing: TYPING_ROUTES,
    voice: VOICE_ROUTES,
    widget: WIDGET_ROUTES,
    "worker-admin": WORKER_ADMIN_ROUTES,
    "worker-body": WORKER_BODY_ROUTES,
} as const satisfies Record<string, readonly SdkContractRoute[]>;

/** 模块键的联合类型（如 `"room" | "friend" | ...`）。 */
export type SdkContractModule = keyof typeof SDK_CONTRACT_ROUTE_TABLES;

/** 全部契约模块的键，按字典序排列。 */
export const SDK_CONTRACT_MODULES: readonly SdkContractModule[] = Object.keys(
    SDK_CONTRACT_ROUTE_TABLES,
) as SdkContractModule[];

/**
 * 全部契约路由的扁平列表，按模块键字典序拼接。
 *
 * 各模块之间不存在重复 `(method, path)`（由 `check-contract-entrypoint.mjs` 强制），
 * 因此这里不做去重——若出现重复，门禁会失败而不是被静默吞掉。
 */
export const SDK_CONTRACT_ROUTES: readonly SdkContractRoute[] = Object.values(SDK_CONTRACT_ROUTE_TABLES).flat();

/** 单模块路由数量统计，便于诊断与断言。 */
export const SDK_CONTRACT_MODULE_SIZES: Readonly<Record<SdkContractModule, number>> = Object.fromEntries(
    SDK_CONTRACT_MODULES.map((module) => [module, SDK_CONTRACT_ROUTE_TABLES[module].length]),
) as Record<SdkContractModule, number>;

export {
    ACCOUNT_DATA_ROUTES,
    AUTH_ROUTES,
    BACKGROUND_UPDATE_ROUTES,
    BURN_AFTER_READ_ROUTES,
    CAPTCHA_ROUTES,
    CAS_ROUTES,
    DEVICE_ROUTES,
    E2EE_ROUTES,
    EPHEMERAL_ROUTES,
    EVENT_REPORT_ROUTES,
    EXTERNAL_SERVICE_ROUTES,
    FRIEND_ROUTES,
    GUEST_ROUTES,
    KEY_BACKUP_ROUTES,
    MEDIA_ROUTES,
    MODERATION_ROUTES,
    MODULE_ROUTES,
    NOTIFICATIONS_ROUTES,
    OIDC_ROUTES,
    PRESENCE_ROUTES,
    PUSH_ROUTES,
    RELATIONS_ROUTES,
    RENDEZVOUS_ROUTES,
    ROOM_ROUTES,
    ROOM_SUMMARY_ROUTES,
    SAML_ROUTES,
    SEARCH_ROUTES,
    SLIDING_SYNC_ROUTES,
    SPACE_ROUTES,
    SYNC_ROUTES,
    TAGS_ROUTES,
    TELEMETRY_ROUTES,
    THIRDPARTY_ROUTES,
    THREAD_ROUTES,
    TYPING_ROUTES,
    VOICE_ROUTES,
    WIDGET_ROUTES,
    WORKER_ADMIN_ROUTES,
    WORKER_BODY_ROUTES,
};
