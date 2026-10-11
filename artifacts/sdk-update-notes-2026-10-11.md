# matrix-js-sdk 更新说明（2026-10-11）

> 版本基线：`40.2.0-langkebo.6`，基线提交 `develop @ b1e066f4f`。
> 本说明面向 SDK 使用方（下游 Tjg 前端）与维护者，汇总本轮专项优化的**对外可见变更**。
> 详细问题处置见 [sdk-issue-fix-report-2026-10-11.md](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/artifacts/sdk-issue-fix-report-2026-10-11.md)。

## 1. 变更总览

| 类别     | 变更                                                                   | 对下游可见性                     |
| -------- | ---------------------------------------------------------------------- | -------------------------------- |
| 内部命名 | `ManagerName` 3 个离群键收敛为 camelCase                               | 透明（内部注册表键，非公开 API） |
| 依赖     | `smol-toml` override 升级 `1.7.1` → `1.9.1`（消除 moderate）           | 构建期生效，运行时无感           |
| 死代码   | 删除未用导出 `StripMatrixAdminV1`；`knip` 配置补 `src/contract` 入口   | 透明                             |
| 质量门禁 | 新增巨型文件「只降不升」棘轮；`knip` 接线 `lint` 链；空 catch 基线下调 | 影响贡献者，不影响运行时         |
| 公共 API | **无新增 / 无破坏性变更**                                              | —                                |

**结论：本轮不产生运行时 API 破坏性变更。** 下游无需改动代码即可继续使用。

## 2. 内部命名一致性（I-06）

`src/client-infra/manager-registry.ts` 的 `ManagerName` 联合类型中 3 个历史离群键统一为 camelCase：

| 旧键                     | 新键              | 说明                      |
| ------------------------ | ----------------- | ------------------------- |
| `"external-service"`     | `externalService` | kebab-case → camelCase    |
| `"saml-auth"`            | `samlAuth`        | kebab-case → camelCase    |
| `"BurnAfterReadManager"` | `burnAfterRead`   | 去除误带的 `Manager` 后缀 |

**影响面**：仅内部注册表键与 `ManagerTypeMap` 键、三处 `registerManagerClass` / `getOrCreateManager` 调用点。**下游通过 `client.get<Name>Manager()` 访问管理器，不受影响。**

> 注：`src/manager-extensions/index.ts` 中的 kebab-case 键（如 `account-data`）是**扩展模块目录名**，属另一命名空间，**未改动**。

## 3. 依赖变更（I-02）

`package.json` → `pnpm.overrides`：

```json
{
    "smol-toml@<=1.8.0": "1.9.1"
}
```

- 由 `"smol-toml@<=1.7.0": "1.7.1"` 升级，消除 `pnpm audit` 中的 moderate 通告（`smol-toml` 为 `knip` 的传递依赖，仅构建期使用）。
- `pnpm-lock.yaml` 已同步。请在升级依赖后执行 `pnpm install` 拉齐 lockfile。

## 4. 质量门禁变更（面向贡献者 / 维护者）

### 4.1 巨型文件「只降不升」棘轮（I-04）

`scripts/quality/check-large-file-changes.mjs` 新增存量棘轮：

- 基线内嵌于脚本常量 `LARGE_FILE_RATCHET_BASELINE`（7 个超 1500 行文件），行数口径 `split("\n").length`。
- **基线外**新增超限文件 ⇒ 失败；基线内文件**行数增长** ⇒ 失败；降至阈值以下 ⇒ 提示（可 `--update-baseline` 收编）。
- 刷新：`node scripts/quality/check-large-file-changes.mjs --update-baseline`（新增 / 增长需额外 `--accept-new`）。

> **给维护者的提示**：拆分巨型文件时只允许「降」；如需新增基线条目（例如新引入超限文件），须显式 `--accept-new`，并说明理由。

### 4.2 `knip` 接线 `lint` 链（I-05）

- `pnpm lint` 现在在 `lint:js` 之后执行 `pnpm lint:knip`；CI `static_analysis.yml` 已有独立 job 覆盖。
- 3 项残留 finding 已清零：`src/contract/index.ts` 登记为 knip entry、删除死导出 `StripMatrixAdminV1`、移除 `husky` 误列例外。
- 贡献者新增未被引用的文件 / 导出 / 依赖将**直接导致 `pnpm lint` 变红**。

### 4.3 空 catch 基线 71 → 38（I-03）

`scripts/quality/swallow-fallback-baseline.json` 基线由 71 下调至 38（两批共清偿 33 站）。`pnpm quality:swallow-fallbacks --strict-baseline` 通过。

> **给维护者的提示**：新增静默兜底会立即超出基线（`new > 0`）导致门禁变红。若确属正当错误处理，请在 catch 处添加 `@swallow-error` 注解（含 `reason` 与 `expires`）。

## 5. 对下游（Tjg 前端）的影响与建议

1. **无需改动**：本轮无公共 API 增删改，下游可平滑升级。
2. **建议对齐**：升级后运行 `pnpm install` 以同步 `smol-toml` override 与 lockfile。
3. **待跟踪的跨仓项**（本轮未做，登记去向）：
    - release 线缺 5 大契约门禁（`verify-path-contract` / `check-wire-format` / `check-url-constructors` / `check-route-set-parity` / `check-admin-response-contract`）；
    - 前端裸调后端 API 的静态判据缺失。
      详见 [sdk-comprehensive-review-2026-10-11.md](file:///Users/ljf/Desktop/hu_ts/matrix-js-sdk/artifacts/sdk-comprehensive-review-2026-10-11.md) 的 P0-1 / P0-2。

## 6. 验证与兼容性

- 全量回归：`pnpm test` → **446 文件 / 7025 用例全通过**；`pnpm lint` → exit 0。
- 兼容性：Node.js v22+，Target ES2022，TypeScript Strict；多入口（`matrix-js-sdk` / `.../admin` / `.../crypto` 等）导出面不变。
- 加密：仍为 Rust crypto（`initRustCrypto()`），本轮无涉。
