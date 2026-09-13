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

| 项    | 内容                                                                                                              | 验收                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| DTO-1 | codegen 模板支持索引签名接口，先改 `key-backup`（7 处）                                                           | `auth_data.public_key` 类型为 `string`；未知键可访问 |
| DTO-2 | 事件内容统一到 `IContent` 风格（sliding-sync 5 处 + `ephemeral`/`sync`/`room` 的 `Record<string, unknown>` 收敛） | 同一概念不再出现三种写法                             |
| DTO-3 | 基线随改形下降并提交（禁止手工刷）                                                                                | 基线条数 = 实际命中条数                              |
