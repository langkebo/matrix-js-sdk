# MSC 编号 — 语义对照表（SDK fork 视角）

> **权威来源**：`synapse-rust/docs/synapse-rust/MSC_SEMANTICS.md`（后端侧对照表）。
> 本文件只记录 **SDK fork 受影响的面**：哪些 API 按*官方* MSC 语义实现，而本后端并不消费。
>
> 背景与依据：`synapse-rust/docs/audit/AUDIT_SUMMARY_2026-09-12.md` §3-3、
> `synapse-rust/docs/audit/sdk-encapsulation-audit.md` §8 / §11。
>
> **维护规则**：新增或变更任何 MSC 相关 API 时，必须同步更新本表与后端对照表；
> 只写编号不写语义的注释一律视为漂移。

## 1. 编号语义速查（本项目）

| MSC 编号    | 本项目实际含义                                                           | SDK 受影响面                                                                                                                             |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **MSC4155** | 后端借用该号段承载**线程订阅读接口**；官方「Invite filtering」**未实现** | `ThreadingManager.getSubscribedThreads()` 正常（走 `v1/threads/subscribed`）；`InviteBlocklistManager` 的 invite-permission 面为**草案** |
| **MSC4156** | join / knock 的 `via` 参数                                               | `RoomManager.joinRoom` / `knockRoom` 正常                                                                                                |
| **MSC4204** | 后端语义 = 改密默认吊销设备（对应官方能力实为 MSC2457）                  | `PolicyRecommendation.Takedown` 为**草案**                                                                                               |
| **MSC4267** | 原子 leave + forget（单事务）                                            | `RoomManager.leave(roomId, { forget? })` ✅ 已对齐                                                                                       |
| **MSC3967** | 后端语义 = `/sync` 增量 state token（官方为 cross-signing 免 UIA）       | 无需专属封装（正常消费 `/sync`）                                                                                                         |
| **MSC3083** | restricted rooms 的 `allow` 数组解析                                     | 后端 `room::join_rules` 单一解析器，SDK 不参与                                                                                           |

## 2. 草案 API（后端零消费，保留公开面）

这些 API **按官方 MSC 语义实现是正确的**，但本后端不提供对应能力，调用不会产生服务端效果。
保留是为了不破坏已发布的公开面，**不代表后端支持**；后续后端落地对应能力时，删除草案说明即可。

| API                                                  | 位置                                  | 实际行为                                        |
| ---------------------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| `PolicyRecommendation.Takedown`                      | `src/models/invites-ignorer-types.ts` | 类型合法；后端不消费 `m.takedown`，服务端无效果 |
| `InviteBlocklistManager.getInvitePermissionConfig()` | `src/invite-blocklist/index.ts`       | 事件未设置 → 404 → 降级为 `null`                |
| `InviteBlocklistManager.setInvitePermissionConfig()` | `src/invite-blocklist/index.ts`       | 仅写入 account data；后端不做邀请过滤           |

## 3. 已对齐项

- **MSC4267**：`RoomManager.leave(roomId, { forget?: boolean })` 已与后端单事务语义一致（后端默认 `forget:false` 保持向后兼容）。
- **MSC4155 / MSC4156 线程订阅**：`ThreadingManager.getSubscribedThreads({ limit?, from? })` 已透出后端 keyset 分页的 `next_batch` 字段。
- **MSC3083**：后端自 2026-09-13 起由 `room::join_rules` 提供单一解析器，鉴权门与 `/summary` 投影共享同一语义。

## 4. 复核命令

```bash
# 后端（在 synapse-rust 仓库执行）：草案 API 的消费方必须为 0
grep -rn "m\.takedown" --include=*.rs src synapse-services synapse-common
grep -rn "invite_permission_config" --include=*.rs .

# 本仓：草案标注必须在位
grep -rn "Draft — not implemented by synapse-rust" src
```
