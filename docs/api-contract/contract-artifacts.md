# 契约产物口径说明

本文件回答一个反复被问到的问题：**「SDK 到底覆盖了多少后端路由？」**

答案不是一个数字，而是四个 —— 它们统计的是**四件不同的事**，此前没有任何地方解释过差异，
于是四个数字被混用、互相「打脸」。本文件把口径固定下来，并由
`quality:docs-counts` 从代码/生成物实时计算、与本文比对，任一不一致即 CI 失败。

---

## 一、四个数字

| #   | 产物                                                                   | 口径（统计的是什么）                                                                                      | 数量 |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---: |
| 1   | `docs/api-contract/generated/route-manifest.all.json` 的 `entry_count` | **后端 ledger 声明的全部路由**。`state_profile=all`，即 oidc / worker / saml 三个特性开关全开时的最大集合 | 1034 |
| 2   | `docs/api-contract/generated/modules/*.json` 文件数                    | 后端按 `registered_by` 拆出的**逐模块镜像**。文件名沿用后端模块名（snake_case）                           |   49 |
| 3   | `src/*/__generated__/` 目录数                                          | 有 SDK 侧生成产物的模块。目录名是 **SDK 目录名**（kebab-case），经 `CONTRACT_MODULE_MAP` 折叠/改名而来    |   46 |
| 4   | `src/*/__generated__/route-table.ts` 文件数                            | 其中**真正生成了路由表**的模块；其余只生成 `dto.ts`                                                       |   39 |
| 4b  | 上述 39 张表的条目总数                                                 | SDK 侧可被 `import` 的字面量路由条目                                                                      |  940 |

> 记忆锚点：**1034 是后端的，940 是前端的**；49 是后端模块视角，46/39 是 SDK 目录视角。

---

## 二、差异是怎么产生的

### 1034 → 49：后端 ledger 按 `registered_by` 分桶

`route-manifest.all.json` 的每条 entry 形如
`{ method, path, registered_by, path_params, query_params }`，
`entry_count` 就是 entry 数组长度。`modules/` 下的 49 个文件是同一批 entry 按 `registered_by` 分桶的结果，
因此 **49 个文件合计的 entry 数 = 1034**（同一批数据，两种视图）。

### 49 → 46：后端模块名与 SDK 目录名不是同名可比

这是最容易误判的一层。两侧命名规约不同，且**多个后端模块会折叠到同一个 SDK 模块**：

| 后端模块（snake_case）                                                         | SDK 目录（kebab-case）              |
| ------------------------------------------------------------------------------ | ----------------------------------- |
| `account_data`                                                                 | `account-data`                      |
| `friend_room`                                                                  | `friend`                            |
| `worker`                                                                       | `worker-admin`                      |
| `worker_body`                                                                  | `worker-body`                       |
| `thirdparty`                                                                   | `third-party`                       |
| `assembly`                                                                     | （映射到多个 SDK 模块，本身无目录） |
| `msc4108_rendezvous` / `delayed_events` / `3PID` / `AI 连接` / `其他` / `装配` | **无 SDK 对应**（映射为 `null`）    |

映射表是代码里的 `CONTRACT_MODULE_MAP`（`scripts/sdk-contract-codegen.mjs`），
以**后端文档 heading 的中文名**为键（如 `账户 → auth`、`Worker → worker-admin`）。

因此**不要**用文件名做集合差：`set(modules/*.json) - set(src/*/__generated__)` 会因为命名规约不同
而报出一大堆假差异（实测两侧各有约 17-20 个「对不上」的名字，绝大多数是同一模块的两种写法）。

### 46 → 39：7 个模块被显式豁免，只生成 DTO

`SKIP_ROUTE_TABLE_MODULES`（`scripts/sdk-contract-codegen.mjs`）列出 7 个**不生成 route-table** 的模块：

```
admin · app-service · dm · feature-flags · federation · key-rotation · reactions
```

豁免不是「免检」：coverage 门禁要求每个条目各有一条 waiver（带 reason + 过期时间），
且**未列入白名单的模块缺表会直接失败**。这 7 个模块的 `dto.ts` 仍然生成，
所以 `__generated__` 目录数是 46 而不是 39。

### 940 vs 1034：两张表的构造规则不同

- `route-manifest.all.json` = **纯后端 ledger**。
- `route-table.ts` = **既有条目 ∪ ledger 清单 ∪ `ROUTE_CONTRACT.md`** 三者按 `(method, path)` 去重。

也就是说 route-table 是「SDK 曾经手写过的路径」与「后端声明的路径」的并集，
因此它的条目**不一定**是 manifest 的子集。跨模块重复由
`quality:contract-entrypoint` 强制为零（实测当前 39 张表之间 0 重复）。

---

## 三、该用哪个数字

| 想问的问题                       | 用哪个                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| 后端一共暴露了多少 API？         | **1034**（`route-manifest.all.json`）                                   |
| SDK 能给出多少条字面量路由常量？ | **940**（39 张 route-table），入口见 `matrix-js-sdk/contract`           |
| 有多少模块有 SDK 侧生成物？      | **46**                                                                  |
| 后端按模块拆成了多少份？         | **49**                                                                  |
| 某条具体路径 SDK 有没有覆盖？    | 查 `src/contract/index.ts` 的 `SDK_CONTRACT_ROUTES`，不要看上面任何计数 |

---

## 四、口径本身的守卫

- `quality:contract-entrypoint` —— 保证 `src/contract/index.ts` 的模块清单
  与磁盘上的 route-table 集合**双向严格一致**，且跨模块无重复路由。
- `quality:docs-counts` —— 从生成物实时计算上表的数字，与**本文档**及
  `CLAUDE.md` / `AGENTS.md` 中声明的数字比对，不一致即失败。
- `contract:codegen:check` —— 保证 `__generated__` 与 manifest 同步。

因此：**改动 codegen、增删模块、或调整豁免名单后，本文档的数字会被 CI 要求同步更新** ——
这正是它不会再腐烂的原因。
