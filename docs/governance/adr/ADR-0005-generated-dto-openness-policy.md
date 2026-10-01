# ADR-0005: Generated DTO Openness Policy（生成 DTO 的 `unknown` 策略）

- Status: Accepted
- Date: 2026-09-13
- Owner: @sdk-core
- Related Task: 阶段 2 · 2.3（DTO 严格性）/ S-DTO

## Context

契约驱动链把后端 route ledger 变成 `src/<module>/__generated__/dto.ts`，因此这些 DTO 是
**服务端说了算**的类型：SDK 不能把它们收窄到后端不保证的形状，否则一个未知算法的载荷就会
让调用方在类型层"合法"地崩溃。

`pnpm quality:generated-dto-strictness` 用 baseline 冻结生成 DTO 里的风险标记。冻结前的
实测（2026-09-13，修复字符串字面量误判之后）：

| 标记             | 条数    | 含义                                                                                  |
| ---------------- | ------- | ------------------------------------------------------------------------------------- |
| `record-unknown` | 47      | `Record<string, unknown>`                                                             |
| `bare-unknown`   | 62      | 类型位置的 `unknown` / `unknown[]` / `[key: string]: unknown`（其中 47 行与上行同行） |
| 合计             | **109** | 基线条目                                                                              |

复核报告 2.3 点名要"收窄"的 12 处，实测拆成两组：

1. **key-backup 7 处**（`dto.ts:27/33/67/87/102/106/153`）：`AuthData | Record<string, unknown>`、
   `EncryptedData | Record<string, unknown>`。`auth_data` / `session_data` 的形状由**密钥备份算法**决定
   （`m.secret_storage.v1.aes-hmac-sha2` 等），后端可以在不破坏旧客户端的前提下新增算法字段。
2. **sliding-sync 5 处**（`dto.ts:157/159/187/218/222`）：`ephemeral` / `account_data` 的 `content: unknown`、
   `SlidingSyncTimeline.events: unknown[]`、ToDevice 与 account-data 扩展的 `events`。Matrix 事件的
   `content` 按协议就是自由对象。

### 关键取证：当前写法比"任一选项"都差

用 tsc 实测 `type UnionForm = AuthData | Record<string, unknown>` 两种访问（`/tmp` 探针，`--strict`）：

| 表达式                 | 期望              | 实测                                                                    |
| ---------------------- | ----------------- | ----------------------------------------------------------------------- |
| `u.public_key`         | `string`          | **`unknown`**（TS2322：`Type 'unknown' is not assignable to type '1'`） |
| `u.anything`（未知键） | `unknown`（开放） | **TS2339**：`Property 'anything' does not exist on type 'UnionForm'`    |

即：并集写法**丢掉了具名属性的类型**（每个具名字段退化成 `unknown`），同时**并没有换来开放性**
（未声明键仍被拒）。而 SDK 自己的规范形状 `IContent` / `IUnsigned`（`src/models/event.ts:79/112`）
早就是"索引签名 + 具名可选字段"：

```ts
export interface IContent {
    [key: string]: unknown;
    msgtype?: MsgType | string;
    membership?: Membership;
    // ...
}
```

## Decision

1. **开放性本身是决定，不是缺陷**：`auth_data` / `session_data` / 事件 `content` / `unsigned` /
   `prev_content` / `creation_content` / `power_level_content_override` / 部署相关 `config` / `metadata`
   等载荷**保持开放**，不得为"把数字降下来"收窄成后端不保证的封闭结构。
2. **但表达开放性的形式统一为「索引签名接口」**，不再使用 `Named | Record<string, unknown>`，
   也不在事件内容上使用裸 `unknown`：

    ```ts
    // 反面（现状，两处都亏）：并集丢具名类型 + 仍拒绝未知键
    auth_data: AuthData | Record<string, unknown>;

    // 正面（决定采用）：具名属性保留真实类型，未知键仍可扩展
    export interface AuthData {
        public_key: string;
        signatures?: Record<string, Record<string, string>>;
        [key: string]: unknown;
    }
    auth_data: AuthData;
    ```

    轮换 / 校验 / 备份这类**具名接口**（`AuthData`、`EncryptedData`）加索引签名；
    事件内容这类**本来就没有固定形状**的字段对齐 `IContent`（具名可选键 + 索引签名）。

3. **不改判定口径**：`quality:generated-dto-strictness` 继续按 baseline 冻结，**新增标记必须红**；
   但"收窄"的验收从"条数下降"改为"形式正确"——2.3 的 12 处因此**重新定义为 12 处改形（form change），
   而不是 12 处封闭**。基线数字只在改形真正落地时随代码更新，不允许为了好看手工刷基线。
4. **顺手修掉度量本身的假阳性**：`bare-unknown` 的 `\bunknown\b` 会命中字符串字面量
   （`trust_level: "verified" | "unverified" | "unknown"`），扫描器改为先剥离字符串字面量再匹配。
   基线因此从 111 条校正为 **109 条**（2 条是度量噪声，不是债务）。
5. **命名接口优先**：只有当形状确实由算法/部署决定时，索引签名才是正确答案；能由契约文档给出具名
   字段的，一律给出具名字段（索引签名是"我们不知道、但允许"的显式声明，不是偷懒的默认值）。

## Consequences

### Positive

- 调用方拿到 `auth_data.public_key: string` 这样的真实类型，而不是 `unknown`（修复实测缺陷）。
- 未知算法/新增字段不会让 SDK 在类型层拒绝合法载荷，向后兼容由构造保证而非运气。
- 度量（109 vs 111）与实际债务一一对应；字符串字面量不再污染棘轮。
- 与 `IContent` / `IUnsigned` 的既有约定一致，减少"同一概念三种写法"的分裂
  （当前事件内容在 sliding-sync 是 `unknown`、在 ephemeral/sync/room 是 `Record<string, unknown>`）。

### Negative / Trade-offs

- 索引签名会削弱"多余属性检查"（`{[key: string]: unknown}` 让拼错的键无法被编译期发现）。
  缓解：具名字段仍然真实存在，消费端优先用具名键；需要在某模块内做严格校验时用局部窄类型收口。
- 需要改 `scripts/sdk-contract-codegen.mjs` 的模板并重新生成多个模块的 `dto.ts`，
  生成物 diff 会很大（一次性成本）。

## Compatibility Plan

- 对**调用方**：`auth_data.public_key` 由 `unknown` 变为 `string` 是**放宽**（此前要 `as` 断言才能用），
  属非破坏性；`Record<string, unknown>` 分支被吸收进具名接口，`auth_data["自定义键"]` 仍然可用。
- 对**契约链**：不改后端 ledger，不改 `docs/api-contract/generated/**` 的 manifest，只改 codegen 模板
  与生成物；`pnpm contract:codegen:check` 必须绿。
- 需要在同一 PR 内更新 `scripts/quality/generated-dto-strictness-baseline.json`（预期下降）。
- 无废弃 API、无版本移除计划。

## Validation

- 度量修复：`spec/unit/generated-dto-quality.spec.ts` 新增"字符串字面量 `"unknown"` 不计入"用例；
  基线 111 → 109（实测 `--update-baseline` 输出 109 条，`62 bare-unknown + 47 record-unknown`）。
- tsc 探针结论（并集丢类型 + 不开放）已记录在 §Context，实施改形时以此为准并补一条**类型断言级**用例
  （`auth_data.public_key` 可赋给 `string`、未知键可读写）。
- 门禁：`pnpm quality:generated-dto-strictness`、`pnpm quality:contracts`（含 `contract:codegen:check`）
  必须 exit 0；新增标记必须能让门禁变红（基线机制本身已有负向测试）。
- 性能/安全影响：无（纯类型层与生成物）。

## 后续工作（已排入阶段 3，见报告 §4 阶段 3）

| 项    | 内容                                                                                                                                                                                                                                                             | 验收                                                                                                         | 状态          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------- |
| DTO-1 | `key-backup` 的 `auth_data` / `session_data` 改形（7 处并集 + 2 个接口加索引签名）                                                                                                                                                                               | `auth_data.public_key` 为 `string`、未知键可访问、codegen check 绿                                           | ✅ 2026-09-13 |
| DTO-2 | ✅ 事件内容统一到 `IContent`：sliding-sync/ephemeral/sync/room 四个契约文档共 18 处 `content` 改 `IContent`；sliding-sync 的 timeline 改用运行时同款 `(IRoomEvent \| IStateEvent)[]`、to-device 改 `IToDeviceEvent[]`；codegen 导入表加 `IContent`/`IStateEvent` | `contract:codegen:check` 绿 + `tsc` 通过 + 基线 97 → 67 + `spec/unit/event-content-unification.spec.ts` 7 例 |
| DTO-3 | 基线随改形下降并提交（禁止手工刷）                                                                                                                                                                                                                               | 基线条数 = 实际命中条数                                                                                      | ✅ 109 → 97   |
| DTO-4 | **实施 DTO-1 时的新发现**：手写公开类型同病 —— `src/crypto-api/keybackup.ts` 的 `auth_data: ISigned & (Curve25519AuthData \| Aes256AuthData)` 同样让具名键不可直取，`rust-crypto/*` 因此遍地 `as Curve25519AuthData`。属公开 API 且影响 Tjg，需单独评估后再改    | 具名键可直接访问；`as` 断言数量下降                                                                          | ⬜            |

### DTO-2 实施记录（2026-09-13）

- 唯一写法定为 **`IContent`**（导入 `src/models/event.ts`），不再各模块自写 `unknown` /
  `Record<string, unknown>`。改动落在契约文档（DTO 来源）：`sliding-sync.md` 6 处、
  `sync.md` 6 处、`room.md` 5 处、`ephemeral.md` 1 处。
- 事件**数组**一并收敛到运行时同款 canonical 类型，避免"第四种写法"：
  `SlidingSyncTimeline.events: (IRoomEvent | IStateEvent)[]`（与 `MSC3575RoomData.timeline` 逐字一致）、
  ToDevice 扩展 `events: IToDeviceEvent[]`。codegen 的 `DTO_EXTERNAL_TYPE_IMPORTS` 相应增加
  `IContent`（models/event.ts）与 `IStateEvent`（sync-accumulator.ts），均为 `import type`，无运行时耦合。
- 有意**不改**的：`rendezvous` 的 `content`（MSC4108 会合协议的报文载荷，不是 Matrix 事件内容）、
  `relations` 里已经是具体内联形状的 `content`、以及 `capabilities` / `metadata` / `config` 这类
  非事件内容的口袋（属 §Decision 的"部署/算法可扩展"，继续用 `Record<string, unknown>`）。
- 证据：`pnpm contract:codegen:check` = 47 modules in sync；`tsc --noEmit` 通过（说明这些生成类型
  确实没有消费者，收窄无破坏面）；DTO 严格性基线 **97 → 67**（`record-unknown` 40 → 28、
  `bare-unknown` 57 → 39）；新用例 `spec/unit/event-content-unification.spec.ts` 7 例，其中一条用
  **编译期双向可赋值**断言"生成 timeline ≡ 运行时 `MSC3575RoomData.timeline`"。

### DTO-1 实施记录（2026-09-13）

- **一处自我修正**：原以为"需要改 codegen 模板支持索引签名接口"，实际不必 —— 契约文档
  （`docs/api-contract/key-backup.md`）里的 ```typescript 代码块才是 DTO 的来源，
`extractTypeScriptDeclarations()` 用 TS 编译器解析后**原样透传**接口声明，索引签名本来
  就支持。因此 DTO-1 只改了契约文档 + 重新生成。
- 改动：`EncryptedData` / `AuthData` 各加 `[key: string]: unknown`；7 处
  `AuthData | Record<string, unknown>` / `EncryptedData | Record<string, unknown>` 去掉并集。
- 证据：`pnpm contract:codegen:check` = 47 modules in sync；`tsc --noEmit` 通过；
  `quality:generated-dto-strictness` 基线 **109 → 97**（`record-unknown` 47 → 40、
  `bare-unknown` 62 → 57：去并集 −14、加索引签名 +2）；类型级用例
  `spec/unit/key-backup-dto-openness.spec.ts` 5 例（含一条 `@ts-expect-error` 反面断言：
  `Record<string, unknown>` 不能再冒充 `AuthData`）。
