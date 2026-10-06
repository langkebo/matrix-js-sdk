/*
 * PathAssert discrimination regression guard — DO NOT DELETE.
 *
 * 背景：2026-10-06 修复「契约断言因 `${string}` 可跨 `/` 而成为前缀吞噬器」缺陷时，
 * 引入 `PathAssert<Call, Routes>`（src/http-api/strip-prefix.ts）。本文件是它的
 * **永久类型级自证**：若断言层失去鉴别力（例如有人改回 `${string}` 通配、或把
 * `MatchesRoute` 的判定方向写反成 `never extends true` 恒真），这里的
 * `@ts-expect-error` 会变成「unused directive」，tsc 报 TS2578，CI 即红。
 *
 * 机制：
 *   - 正例：必须能通过类型检查（无 @ts-expect-error 标注）。
 *   - 反例：必须**必然**报错，因此用 `@ts-expect-error` 标注——断言一旦失效，
 *     该标注变成 unused，tsc 失败。
 *   - 本文件被 `pnpm lint:types`（`tsc --noEmit`）强制检查，无需接入新的门禁脚本。
 *
 * 注意：这里复刻的是各调用点的助手签名（`const P` + `PathAssert`），目的是在
 * **不依赖私有导出**的前提下，直接锁定 `PathAssert` 的鉴别力（断言层的根机制）。
 */

import type { PathAssert, StripV3 } from "../../src/http-api/strip-prefix";
import type { RoomPath } from "../../src/room/__generated__/route-table";
import type { AuthPath } from "../../src/auth/__generated__/route-table";
import type { SearchPath } from "../../src/search/__generated__/route-table";
import type { ModerationPath } from "../../src/moderation/__generated__/route-table";

const S = "x";

// 复刻各调用点的助手签名（const P + PathAssert）。
function assertRoom<const P extends string>(path: P & PathAssert<P, StripV3<RoomPath>>): P {
    return path;
}
function assertAuth<const P extends string>(path: P & PathAssert<P, StripV3<AuthPath>>): P {
    return path;
}
function assertSearch<const P extends string>(path: P & PathAssert<P, StripV3<SearchPath>>): P {
    return path;
}
function assertModeration<const P extends string>(path: P & PathAssert<P, StripV3<ModerationPath>>): P {
    return path;
}

// ===================== 正例：必须全部通过 =====================
void assertRoom(`/rooms/${S}/aliases`);
void assertRoom(`/rooms/${S}/invite`);
void assertRoom(`/rooms/${S}/joined_members`);
void assertRoom(`/rooms/${S}/keys/claim`);
void assertAuth(`/directory/room/${S}/alias`); // ← ledger 补齐（assembly→auth 映射）
void assertAuth(`/directory/room/${S}/alias/${S}`); // ← ledger 补齐
void assertAuth(`/profile/${S}/${S}`); // ← ledger 补齐
void assertSearch(`/rooms/${S}/context/${S}`); // ← 跨模块归属到 search
void assertModeration(`/rooms/${S}/report`); // ← 本轮新生成 moderation 表

// ===================== 反例：必须全部报错（@ts-expect-error 必生效） =====================
// 1) 前缀吞噬回归守卫：`/rooms/**` 子树里凭空多一段（旧实现下被 `/rooms/${string}` 静默放行）。
// @ts-expect-error — invite_blocklist 属 vendor 前缀，不在 room 契约里
void assertRoom(`/rooms/${S}/invite_blocklist`);
// @ts-expect-error — 多加一段
void assertRoom(`/rooms/${S}/aliases/extra`);
// 2) 静态段拼错。
// @ts-expect-error — aliasez ≠ aliases
void assertRoom(`/rooms/${S}/aliasez`);
// @ts-expect-error — 段数不足
void assertRoom(`/rooms`);
// 3) 同样的吞噬守卫生效于 auth 表（旧实现下 `/directory/room/${string}` 会吞掉后续段）。
// @ts-expect-error — aliasez ≠ alias
void assertAuth(`/directory/room/${S}/aliasez`);
// @ts-expect-error — profile 只有两段占位或 displayname/avatar_url
void assertAuth(`/profile/${S}/displayname/x`);
// 4) 跨模块不能互相冒充：room 表不得接受 search/moderation 的路由。
// @ts-expect-error — context 属 search 表
void assertRoom(`/rooms/${S}/context/${S}`);
// @ts-expect-error — report 属 moderation 表
void assertRoom(`/rooms/${S}/report`);
