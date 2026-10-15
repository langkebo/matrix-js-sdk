# SDK ↔ 后端 契约问题交接单（2026-10-15）

> **来源**：matrix-js-sdk 的 quality gate 收编——把长期挂 `WAIVED` 的模块纳入「生成的 route-table
> 必须有消费点」的管辖，并给调用点批量加**编译期路径断言**（`PathAssert`）。断言一加，`tsc` 立刻
> 报出**契约外路径**，逐条对照 `synapse-rust` 源码核实后得本单。
>
> **基线**：SDK 契约镜像 `synapse_rust_commit = 6302798c3`（后端 2026-10-15 14:57）；
> 核实后端源码时后端 HEAD = `1d728dbe0`（2026-10-15 15:54）。若两边已前进，请以最新为准复看。

---

## 一、需要后端确认的 3 个问题（按优先级）

### Q1（P1）`invite/blocklist`、`invite/allowlist` 是否需要 per-user 端点？

- **后端现状**：`synapse-web/src/routes/admin/server.rs:29-36` 只注册**无参数**形态——
  `GET|POST /_synapse/admin/v1/invite/blocklist`（`get_invite_blocklist_admin` /
  `set_global_invite_blocklist_admin`）与 allowlist 的两个对应 handler。语义是「**全局名单整体设置**」
  （集合由 body 传）。
- **SDK 现状**：`src/admin/sub-managers/admin-config-manager.ts` 有 **4 处**使用**带 userId** 的路径：
  `POST|DELETE /_synapse/admin/v1/invite/blocklist/{user_id}`、`…/invite/allowlist/{user_id}`
  ⇒ 这 4 处**恒 404**。
- **请确认**：① 是否计划提供 per-user 增删端点？② 若不提供，SDK 改为「**读—改—写**」（先 GET 全量、
  本地增删、再 POST 全量）是否符合产品预期？（SDK 内已有同款先例：`InviteBlocklistManager.addToBlocklist`）

### Q2（P2）`rooms/{room_id}/messages/{event_id}` 的 `DELETE` 是否会有？

- **后端现状**：`admin/room/mod.rs:118-121` 只有 `GET …/rooms/{room_id}/messages`。
- **SDK 现状**：原有 `admin-room-manager.deleteRoomMessage` 调
  `DELETE …/rooms/{room_id}/messages/{event_id}`（对标**上游 Synapse** 的管理端点）⇒ 恒 404。
  **SDK 侧已删除该方法**（提交 `66be34183`），并在同文件注释里指向替代方案 `cascadeRedactEvent`。
- **请确认**：本后端是否计划实现「删除房间内单条消息」？若计划实现，SDK 可恢复该方法
  （当前"删方法"是**临时**处置，不是否定该能力）。

### Q3（P3）`federation/destinations/{destination}/reset` 是否曾是别名？

- **后端现状**：只有 `…/destinations/{destination}/reset_connection`（`admin/federation.rs:25`）。
- **SDK 现状**：`resetFederationDestination` 曾实现为「先 `POST …/reset`、**仅** 404 时回退
  `…/reset_connection`」⇒ 因 `/reset` 从未注册，**每次调用都先发一个必然 404 的请求**。
  **SDK 侧已改为单请求直打 `/reset_connection`**（提交 `66be34183`）。
- **请确认**：① `/reset` 是否在某版本存在过、现已废弃？② `reset_connection` 与上游 Synapse 的
  `POST …/destinations/{server}/reset_connection` 语义是否一致（主要用于核对文档口径）。

---

## 二、不需要后端改动、但请知悉的 1 项（口径）

**服务端面模块的归类**：`quality:manager-codegen` 新增 `SERVER_ONLY_MODULES` 类别，把 `federation`
（55 条）从 `WAIVED` 移出——依据是**逐条实测**其路径前缀全为 server-to-server / key-server API：
`_matrix/federation/v1` 36 + `v2` 7 + `unstable` 1、`_synapse/federation/*` 7、`_matrix/key/v2` 4，
**无**任何 `/_matrix/client/*` 或 `/_synapse/admin/*` 混入。

若后端对「哪些路由属于客户端面」有不同划分（例如某条 federation 路由其实供客户端调用），**请告知**
——它会直接影响 SDK 的豁免口径与"未受约束路由"计数。

---

## 三、SDK 侧将做的处置（供对齐）

| 项                                 | 处置                                                                        | 状态                  |
| ---------------------------------- | --------------------------------------------------------------------------- | --------------------- |
| `deleteRoomMessage`（Q2）          | 删除方法（恒 404 的 API 不留在公开面）                                      | ✅ 已完成 `66be34183` |
| `resetFederationDestination`（Q3） | 去掉试探，单请求直打 `/reset_connection`                                    | ✅ 已完成 `66be34183` |
| invite 4 处（Q1）                  | 待答复后改为「读—改—写」，或收敛掉这组方法                                  | ⏳ 等 Q1              |
| `admin` 收编（179 条）             | 断言设计就绪（6 种前缀 + 7 张表 union；227 处调用的批量脚本已验证一次成功） | ⏳ 等 Q1              |

> 说明：`admin` 目录的 manager **跨 7 个 ledger 模块**（admin / feature_flags / module / telemetry /
> external_service / room / event_report），故其断言需 union 多张表；这是 SDK 侧的设计问题，
> **不需要后端改动**，仅在此说明为何该模块的收编进度落后于其它模块。

---

## 四、核实方式（可复现）

```bash
# 1. 后端注册形态（本单所有结论的来源）
sed -n '14,40p'   synapse-rust/synapse-web/src/routes/admin/server.rs     # invite 族：无参数全局形态
sed -n '108,125p' synapse-rust/synapse-web/src/routes/admin/room/mod.rs   # messages 只有 GET
sed -n '20,40p'   synapse-rust/synapse-web/src/routes/admin/federation.rs # 只有 /reset_connection

# 2. SDK 调用点
grep -n '/invite/bl' matrix-js-sdk/src/admin/sub-managers/admin-config-manager.ts
grep -n 'messages/'  matrix-js-sdk/src/admin/sub-managers/admin-room-manager.ts

# 3. 契约镜像里这几条是否存在（用于区分"SDK 错"与"ledger 缺"）
node -e 'const j=require("matrix-js-sdk/docs/api-contract/generated/modules/admin.json");
         console.log(j.entries.map(e=>e.path).filter(p=>/invite|messages/.test(p)))'

# 4. 收编的批量断言（可复现"断言如何炸出这些缺陷"）
#    admin 收编脚本见 matrix-js-sdk/.workbuddy/memory/2026-10-15.md
```

### 附：一条方法论提醒（本次踩到的坑）

判定「某路径是否属某模块」时，**不要只用 `endsWith` 反查**：SDK 调用点常"多一段"（如
`/invite/blocklist/{user_id}` vs 契约的 `/invite/blocklist`），后缀匹配会误报为"无模块命中"，
从而把**SDK 缺陷**错判成**ledger 缺口**。本单的 Q1 就是这么先被误判、后经复核撤回的
（见 `matrix-js-sdk/docs/api-contract/contract-artifacts.md` §六 B 的撤回说明）。
正确做法：把两侧的路径段都归一化（模板段统一成 `{}`）后**逐段比较段数**再判归属。
