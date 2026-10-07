# 门禁指纹稳定性审计：`quality:swallow-fallbacks` 行号漂移根因与治理

> 触发点：本轮 §13.15.8 收尾时发现 `quality:swallow-fallbacks` **在改动前就是红的**（`src/discovery/index.ts`
> baseline 记 250 行、实际 232 行，而该文件本轮未改）。顺着这个现象往下挖，发现这**不是行号记错**，
> 而是门禁设计里两个互相独立的缺陷叠加。本文记录根因、证据、解决方案，以及由此暴露的项目级问题清单。

---

## 0. 结论速览

| 编号  | 缺陷                                                                                         | 性质                                                       | 量化                                             |
| ----- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| **α** | 指纹 `id = file:line:sha1(file\|line\|snippet)` 把**行号**编进身份                           | 假阳性——上方插一行即红灯                                   | baseline 历史 **5+ 次「N 增 N 删」纯漂移**       |
| **β** | 检测正则 `catch(){[\s\S]{0,240}?return(null\|\[\]\|false\|{})}` 用**字符窗口**而非语法块边界 | **假阳性 + 定位错误**——`throw e` 的正当 catch 被登记为吞错 | **6/64 跨块错配（已逐条核验）**                  |
| **γ** | 只认 `return null/[]/false/{}`，不认 `return undefined/''/0/;`                               | 假阴性                                                     | 约 **35 处**量级                                 |
| **δ** | `{0,240}` 字符上限                                                                           | 假阴性                                                     | **14 处**「块首到 return >240 字符」的真吞错被漏 |

**α 与 β 叠加会互相放大**：β 让 snippet 跨越语法边界，于是**边界外**的代码一旦变化，snippet 也随之变化
→ 指纹漂移面被 β 扩大。所以「行号漂移」只是表象，β 才是让这个门禁**不可信**的那一半。

**核心建议**：指纹去行号（对齐本仓已有的两个正解实现）+ 检测器改配平扫描 + `--update-baseline` 加审查门 +
给门禁补 spec。**不建议**只做「重跑 `--update-baseline`」——那只是把噪音重新记一遍，两个缺陷都还在。

> **整改状态（2026-10-06 执行完毕）**：α / β / γ / δ 四个缺陷 + 收尾中又发现的第 5 个（注解泄漏进指纹，§7.9）
> 均已修复并附变异自证；P1 / P2 / P3 / P4 / P5 / P7 已修复；P6 长尾 / P9 明确未做
> （**P8 已于 2026-10-07 补做，见 §7.12**）。
> **执行中有 3 处按实测证据修正了本文原方案**（§4.2 的 rethrow 判定、
> §4.4 的裸 `return;`、§4.1 的 id 形态），详见 **§7**。§5 的问题清单状态见 **§7.1**。
>
> **续修（2026-10-07）**：又清掉三处 ——
> ① `quality:manager-codegen` 的 **O(模块 × 文件)** 性能缺陷（**29 分 37 秒 → 18 秒**，输出与修复前逐字节一致）；
> ② `probe-contract-drift.mjs` 的**「抓源码常量」死脚本**（抓不到 `LEDGER_MODULE_*` 后崩在启动阶段，而它不在 lint 里，坏了没人发现）；
> ③ `codegen-coverage-gate.spec.ts` 的**长期红灯**（`push_notification` 的 waiver 被移除后断言没跟着改，红了好几天）。
> 详见 **§7.11**。
>
> **再做一件（2026-10-07）**：**P8 落地** —— 把「存金标准 → 改 → 对拍」与「这条红灯是本轮改红的、还是本来就红」
> 产品化成 `scripts/audit/gate-golden.mjs`（`pnpm quality:golden`，三个子命令 `capture` / `verify` / `attrib`），
> 并对真实门禁做了变异自证（CLEAN → 注入缺陷 → INTRODUCED → 还原 → CLEAN；天然红灯门禁判 PRE_EXISTING）。
> 它**第一次运行就查出一条既有 CI 红灯**（`quality:contracts` 的首项 `quality:exports` 自 `f728df035` 起就红，
> 而该链不在 `lint` 里）——该问题**不在 P8 范围，本轮未改**，见 §7.12-7。
> 详见 **§7.12**。**P6 长尾 / P9 仍未做**。
>
> **再做两件（2026-10-07）**：
> ① **孤岛脚本盘点** —— `scripts/` 下 76 个脚本，**7 个零引用孤岛**；顺手补上可达性门禁的
> **三条"假绿"通道**（枚举只认 exit-1 ⇒ 无 exit-1 的诊断脚本完全隐形、注释里的路径被当成调用、
> 相对引用按仓库根解析），并新增**孤岛台账**把"全仓有多少脚本没人跑"钉成只能变小的数字；
> ② **P6 长尾一轮** —— 口径重测为 **52 个 quality 脚本中 37 个无 spec**（旧口径 27/18），
> 本轮新守住 4 个（`gate-reachability` / `no-default-key` / `log-sensitive` / `waiver-expiry`），
> 并查明剩余部分的高杠杆解法（18 个 granular 门禁是同一模板的 18 份副本）。
> 详见 **§7.13**。**P9 仍未做**。
>
> **处置一轮（2026-10-07）**：
> ① 清掉 **2 条既有 CI 红灯** —— `quality:exports`（文档没跟上 `f728df035` 的重命名）、
> `quality:public-api-docs`（棘轮 R2 补 11 处 JSDoc + R3 下调台账）；
> ② 修掉可达性门禁的**第 4 条假绿通道** —— 受管辖判据从「正文自称 exit-1」改为**按路径**，
> 否则把门禁逻辑抽到共享库会让受管辖数 **44 → 26**（抽库反而让门禁变松）；
> ③ 判据一改立刻显形 **5 个死门禁**：1 个是漏接（`quality:coverage:weak-modules`，兄弟 `weak-files` 早就在 CI）已接线，
> 4 个登记豁免；
> ④ **granular 抽库** —— 18 份副本 → 1 个共享引擎 + 18 份数据，金标准对拍 **18/18 逐字节一致**，
> P6 未覆盖数 **37 → 18**；
> ⑤ **孤岛 7 → 2**（删除 3 个已确认无引用的脚本）；⑥ 修 `check-waiver-expiry` 报告头的 UTC 打印（diff 恰好 1 行）。
> 详见 **§7.14**。**P9 仍未做（环境限制）；`quality:report` 240s 超时已定位并修完，见 §7.15-9**。

---

## 1. 现象与直觉解释

```
$ node scripts/quality/check-swallow-fallbacks.mjs
- [STALE] src/discovery/index.ts:250: baseline entry no longer matches any finding.
  Retire it with `node scripts/quality/check-swallow-fallbacks.mjs --update-baseline` after confirming the swallow site is really gone.
```

直觉解释是「行号记错了」，于是重跑 `--update-baseline`。但这个解释**只对了一半**，而且掩盖了真正的风险。

---

## 2. 根因

### 2.1 缺陷 α：身份里含行号

`scripts/quality/check-swallow-fallbacks.mjs:37-40`

```js
function buildId(relPath, line, normalizedSnippet) {
    const digest = crypto.createHash("sha1").update(`${relPath}|${line}|${normalizedSnippet}`).digest("hex");
    return `${relPath}:${line}:${digest}`;
}
```

行号是**不稳定维度**。一旦编进身份：

- 上方插入/删除**任意一行**（哪怕只是 prettier 重排）→ 该站点 id 变化
- 于是它同时触发两条错误：旧 id 判 `[STALE]`（`:138`），新 id 判 `[NEW]`（`:139`）
- `:143-149` 的提示语把它描述成「baseline entry no longer matches any finding … after confirming
  the swallow site is really gone」——**但站点根本没消失，只是挪了几行**

**关键**：脚本**无法区分**「站点真的消失」与「只是行号漂移」，因为两者在 `baselineIds - currentIds`
这个集合差里长得一模一样。`staleBaselineIds` 的语义是**浑浊**的。

### 2.2 缺陷 β：检测器跨块匹配（更严重，且被长期忽视）

`scripts/quality/check-swallow-fallbacks.mjs:46`

```js
const pattern = /catch\s*\([^)]*\)\s*\{[\s\S]{0,240}?return\s*(null|\[\]|false|\{\})\s*;/g;
```

`[\s\S]{0,240}?` 是**纯字符窗口**，它**不禁止跨越 `}`**。于是一个 catch 可以匹配到它**之外**（甚至
**另一个方法内部**）的 `return null;`。

这不是理论风险——**64 个匹配里有 6 个是跨块匹配，已逐条打开源码核验**：

| catch 位置                                               | 这个 catch 实际做什么                           | 门禁跨块匹配到的 `return`                               | 真吞错？              |
| -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------- | --------------------- |
| `src/rust-crypto/backup.ts:256`                          | `if (throwOnError) throw e;` 否则 `logger.warn` | `:263 return false;`（catch **外**）                    | ❌                    |
| `src/guest/index.ts:306`                                 | `emit(...); throw error;`                       | `:314 return null;`（**下一个方法** `getGuestInfo` 内） | ❌                    |
| `src/guest/index.ts:350`                                 | `emit(...); throw error;`                       | 下一方法 `canJoinRoom` 内                               | ❌                    |
| `src/store/memory.ts:331`                                | `logger.warn(...)`（**确实吞错**）              | `:334 return null;`（catch 外）                         | ✅（但 snippet 越界） |
| `src/crypto/store/indexeddb-crypto-store-backend.ts:262` | `abortWithException(txn, e)`                    | `:270 return null;`（跨过 `};` `});`）                  | ❌                    |
| `src/crypto/store/indexeddb-crypto-store-backend.ts:410` | `abortWithException(txn, e)`                    | `:419 return null;`（同上）                             | ❌                    |

**这些错配已经写进 baseline 了**，看 snippet 就知道匹配错了——它把 catch 之外的代码吞了进来：

```
backup.ts:256   catch (e) { if (throwOnError) { throw e; } this.logger.warn(…, e); } return false;
guest/index.ts:306  catch (error) { …throw error; } } getGuestInfo(): IGuestInfo | null { if (!this.guestInfo) { return n
indexeddb-…:262  catch (e) { abortWithException(txn, <Error>e); } }; }); if (result.length === 0) { return null;
```

**后果是三重的**：

1. **假阳性入库**：5 条 `throw e` 的正当 catch 被登记为"吞错债务"。baseline 的 64 条里**混着非 swallow**。
2. **注释污染**：这 6 处 catch 前**都有** `// @swallow-error { owner: …, expires: "2026-12-31" }`——
   是为了消掉这条误报而加的。**注释在语义上是错的**（这个 catch 本不该被豁免），且会误导后来的人
   "这里真的在吞错"。（baseline 64/64 全部带 whitelist，其中 owner 为 `refactor-bot` 的有 **8 条**。）
3. **放大 α**：snippet 跨越语法边界 → **边界外**那几行一旦变化（改个日志文案、调整下一个方法），
   snippet 就变 → id 就变。**β 让 α 的漂移面显著变大**，两者是乘法关系。

### 2.3 缺陷 γ / δ：漏检面

- **γ（语法族盲区）**：`return undefined / '' / 0 / ;`（以及 catch 内空 return）完全不被识别。
  实测仅以 `return;` 吞错的 catch 约 **35 处**。（`return;` 在 catch 内 = 忽略错误继续执行，是典型吞错。）
- **δ（240 字符上限）**：块首到 `return` 距离 >240 字符的真吞错被漏。实测 **14 处**，gap 从 259 到 565：
  `web-rtc/groupCall.ts`(565)、`rust-crypto/DehydratedDeviceManager.ts`(518)、`guest/index.ts`(373) …

即：**这个门禁的检测面同时存在假阳性（β，6 条）与假阴性（γ+δ，49 处量级）**。

---

## 3. 证据

### 3.1 baseline 历史：漂移是常态，且与语义无关

```
$ git log --format="%h %s" --numstat -- scripts/quality/swallow-fallback-baseline.json
d77d65096  path-contract 门禁补抽取盲区 … + swallow 基线重记      13  13   ← 纯漂移（本轮）
116631352  路径断言改为段级精确匹配                              3   3   ← 纯漂移
e8c4f03cc  收敛 66 份重复 StripXxx 条件类型                       41  41   ← 纯漂移（大重构）
e66597066  新增门禁体系与契约工具链收敛                            3   3   ← 纯漂移
d93b356d7  封装 MSC3720/MSC4140                                 5   5   ← 纯漂移
b6343b146  style: prettier 修复 + swallow baseline 退役 6 条 stale  13  13   ← 纯格式提交
5423dfa54  fix(baseline): remove 2 stale swallow-fallbacks entries  1  21
```

**「增删行数相等」出现 6 次**——这就是纯行号重记的指纹。更刺眼的是 `b6343b146`：
**一次纯格式修复（prettier）被迫绑定一次基线退役**。prettier 不改变任何语义，但会改变行号，
而这个门禁把行号当作身份。**代价直接落在开发流程上。**

### 3.2 本仓已有两个明文正解——问题不在"没想到"，而在"没统一"

| 脚本                                    | 指纹                                          | 注释                                                                     |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `check-real-backend-types.mjs:74`       | `filePath:code:sha1(filePath\|code\|message)` | `:12` "Fingerprint = file + TS code + message (**NOT the line number**)" |
| `check-timer-pairing.mjs:145`           | `file#kind#handle#ordinal`                    | `:147` "**序号而不是行号：在上方插代码不会失效。**"                      |
| `check-swallow-fallbacks.mjs:37`        | `file:line:sha1(\|line\|)`                    | — ❌                                                                     |
| `check-generated-dto-strictness.mjs:69` | `file:line:code:sha1(\|line\|)`               | — ❌                                                                     |

而且 `check-real-backend-types.mjs` 还配了守卫：`spec/unit/real-backend-types-gate.spec.ts:62-73`

```ts
describe("real-backend types gate: fingerprint stability", () => {
    it("keeps the same id when only the line moves (inserting a line is not a new error)", () => {
        expect(diagnosticId({ ...base, line: 900, column: 1 })).toBe(diagnosticId(base));
    });
```

**这条断言就是本次要补的东西**，本仓已有可复制的模板。

### 3.3 对照：有 spec 的门禁恰好都做对了指纹

| 门禁                                 | 有 spec 守卫？                    | 指纹含行号？  |
| ------------------------------------ | --------------------------------- | ------------- |
| `check-real-backend-types.mjs`       | ✅                                | ❌ 无（正解） |
| `check-timer-pairing.mjs`            | ✅（2 个 spec）                   | ❌ 无（正解） |
| `check-generated-dto-strictness.mjs` | ⚠️ 有 spec 但**不覆盖 id 稳定性** | ✅ **含**     |
| `check-swallow-fallbacks.mjs`        | ❌ **零测试**                     | ✅ **含**     |

**相关性极强**：为门禁写测试的人顺手做对了指纹；没写测试的门禁踩了坑。

---

## 4. 解决方案

### 4.1 针对 α（指纹）—— 去行号 + 序数

```js
// 对齐 check-real-backend-types.mjs:74 与 check-timer-pairing.mjs:145 的既有正解
function buildId(relPath, normalizedSnippet, ordinal) {
    const digest = crypto
        .createHash("sha1")
        .update(`${relPath}|${normalizedSnippet}`) // 用完整片段，不 slice(0,240)
        .digest("hex")
        .slice(0, 16);
    return `${relPath}#${digest}#${ordinal ?? 1}`; // line 降级为展示字段
}
```

- **`ordinal`**（该片段在文件内的第几处）处理"同文件内完全相同的片段"，避免简单折叠导致漏判
  （timer-pairing 就是这么做的）。**不用折叠**：折叠会让"复制粘贴一份新吞错"逃过门禁。
- **收益**：`staleBaselineIds` 从此**恰好等于**「站点真的消失/被重命名」——语义变纯，提示语才名副其实。
- **迁移**：一次性全量重算 id。必须**校验旧 id 集合 → 新 id 集合是单射**（新旧条数相等），
  否则就是悄悄吞掉了重复站点。

### 4.2 针对 β（跨块）—— 换配平扫描

```js
// 先定位 catch 的 {...} 配平范围，只在块内找 return；240 字符窗口改为"块内"
function catchBlocks(source) {
    /* 配平扫描，返回每个 catch body 的 [start,end] */
}
function isSwallowing(body) {
    if (/\bthrow\b/.test(body)) return false; // ★ 有 rethrow 就不是吞错
    return /return\s*(null|\[\]|false|\{\}|undefined|""|''|0)?\s*;/.test(body);
}
```

- **关键在于补上「catch 内有 `throw` → 不是吞错」这一条**。现门禁只看"有没有 return null"，
  **完全不看有没有 rethrow**——这正是 5 条假阳性的直接成因。
- 配平扫描手法与 `verify-path-contract.mjs` 本轮的改造同源（`findTopLevel` / `splitTopLevelArgs`），
  可实现复用。

### 4.3 重新评估 baseline（必须做）

- 64 条须逐条复核。**已确认 6 条为跨块错配**其中 5 条不是吞错。
- 退役这些条目，并**删除源码里为消警而加的 `@swallow-error` 注释**（backup.ts:255、guest/index.ts:305/349、
  memory.ts:330、indexeddb:261/409）。留着注释等于把误报固化。
- 复核 γ/δ 漏检面是否要一并纳入（会让"债务清单"变大，需要一次性决策）。

### 4.4 针对 γ/δ（漏检）—— 扩展后一次性 re-baseline

扩语法族会**新增大量条目**（35+14 量级）。建议**单独一个提交**，并在文档里说明"这不是回归，是检测面扩大"。

### 4.5 流程层（无论上面怎么改都该做）

- **`--update-baseline` 加审查门**：输出 `drift / removed / added` 三分类；`added` **默认拒绝写入**，
  须显式 `--accept-new` 并逐条打印 snippet。让"重记行号"与"赦免新缺陷"**在机制上不可混淆**。
  （本轮只能靠人工 `git diff` 确认"13 增 13 删、snippet/whitelist 一字未动"——那应该由脚本保证。）
- **提取共享工具** `scripts/quality/lib/stable-id.mjs`（该目录已存在），4 个门禁共用一份实现，
  杜绝再有人写出 `file:line` 指纹。
- **补 spec**：`swallow` / `generated-dto` 各补一条"行号漂移保持同 id"断言（复制 3.2 的模板）。
- **`--strict-baseline` 常态化**：现在 baseline 项过期只 `console.warn` 不阻断，等于债务可永久不还。

### 4.6 变异自证（如何证明修好了）

沿用本轮 §13.15.8 的手法：

1. **α 自证**：在 baseline 某条目上方插入一行注释 → 修复后门禁应**仍绿**；修复前应红。
2. **β 自证**：构造 `catch (e) { throw e; }` 后紧跟 `return null;` → 修复后应**不报**；修复前应报。
3. **γ 自证**：构造 `catch { return; }` → 修复后应**报**；修复前不报。

---

## 5. 项目存在的问题清单

> 以下是顺着这个问题挖出来的、**跨门禁系统性问题**，不是单点 bug。

| 编号    | 问题                                      | 现状                                                                                                             | 影响                                                                              |
| ------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **P1**  | **baseline 指纹策略无统一规范**           | 4 个 baseline 型门禁里 **2 个对、2 个错**，无共享 lib、无文字规范                                                | 后来者反复踩坑；本仓已有两个正解却未被复用                                        |
| **P2**  | **`--update-baseline` 无条件全量重写**    | swallow / generated-dto / technical-debt / real-backend-types 皆有，均无 diff 分类、无 `--accept-new`、无 reason | 「重记行号」与「静默放行新缺陷」共用一个动作，只能靠人工 `git diff` 兜底          |
| **P3**  | **baseline 赦免缺到期强制（口径不一致）** | `path-contract-waivers` 有 `expires` + `quality:waiver-expiry` 硬阻断；swallow 的 baseline 过期**只 warn**       | 同一仓库两种豁免纪律，可永久不还的债务存在                                        |
| **P4**  | **门禁检测器用字符窗口而非语法边界**      | swallow 的 `catch(){[\s\S]{0,240}?return…}` 已确认 6/64 错配                                                     | 假阳性 + **定位错误**（报表指向错误的 catch）+ snippet 跨边界加剧指纹漂移         |
| **P5**  | **假阳性被"加注释消警"掩盖**              | 6 处错配 catch 前都有 `@swallow-error` 注释（`refactor-bot` 名下 8 条）                                          | 误报被固化成"已豁免债务"，无人再质疑；注释与代码语义相反                          |
| **P6**  | **门禁自身缺测试**                        | 27 个 quality 脚本中 **18 个无任何 spec 引用**，含出事的 swallow                                                 | 门禁是"守门人的守门人"，却没被守；对照 P1 相关性极强                              |
| **P7**  | **门禁脚本不在 lint 作用域**              | `lint:js = eslint src spec perf`，不含 `scripts/`                                                                | `scripts/quality/*.mjs` 的代码质量问题永远不被发现                                |
| **P8**  | **红灯归因不可自证**                      | 判断"是本轮改红还是本来就红"需人工 `git worktree add HEAD --detach` 复现                                         | 每轮都要重建环境；无 `lastGreenCommit` / 无 pass 快照                             |
| **P9**  | **依赖环境特性的质量门不可重复执行**      | `npx eslint <多文件>` 在沙箱内**第二次调用即挂**（file-broker IPC 超时，EXIT=2）                                 | 门禁结论依赖执行方式；须非沙箱才能取确定结果                                      |
| **P10** | **孤岛脚本：写完再没人跑过**              | `scripts/` 下 76 个脚本里 **7 个零引用**；且可达性门禁只枚举 exit-1 脚本 ⇒ 无 exit-1 的诊断脚本对它**完全隐形**  | 零引用脚本坏了没人知道（§7.11-2 的 probe 坏了半年）；"看起来有人在看这件事"是假象 |

---

## 6. 建议执行顺序

1. **先修 β（检测器）**——它决定"哪些是问题"，若不先修，重记 baseline 等于把误报固化。
2. **复核并退役 6 条错配 + 删除对应 `@swallow-error` 注释**（§4.3）。
3. **修 α（指纹去行号 + 序数）**，做单射校验（§4.1）。
4. **`--update-baseline` 加审查门 + 提取 `lib/stable-id.mjs`**（§4.5）。
5. **补 spec**（α/β/γ 各一条）+ 变异自证（§4.6）。
6. **再决定 γ/δ 扩面**（单独提交，会让债务清单变大）。
7. **横向整改**：`check-generated-dto-strictness.mjs` 同样含行号（P1）；`lint:js` 加 `scripts`（P7）。

> 顺序理由：**β 影响"问题集合的定义"，α 影响"问题集合的比对"**。先定集合，再定比对，否则 3、4 步会把
> 错误集合固化成 baseline。

---

## 7. 整改落地记录（2026-10-06 执行）

### 7.1 状态总表

| 编号    | 审计结论                                   | 落地结果                                                                                                                                                             |
| ------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **α**   | 指纹含行号                                 | ✅ 已修：`stableId(file, [snippet, ordinal])`，行号降为展示字段                                                                                                      |
| **β**   | 字符窗口跨块                               | ✅ 已修：配平扫描，只在 catch 语法块内判定                                                                                                                           |
| **γ**   | 语法族偏窄                                 | ✅ 已修，**但边界与本文 §4.4 不同**（见 7.4-2）                                                                                                                      |
| **δ**   | 240 字符上限                               | ✅ 已修：块内判定天然无长度上限                                                                                                                                      |
| **加**  | 白名单注解泄漏进指纹（收尾复核发现，§7.9） | ✅ 已修：指纹输入剔除注解                                                                                                                                            |
| **P1**  | 指纹策略无规范                             | ✅ 共享 lib + generated-dto 横向整改 + 补 id 稳定性 spec                                                                                                             |
| **P2**  | `--update-baseline` 无审查                 | ✅ 两个门禁均加四分类摘要 + `--accept-new`                                                                                                                           |
| **P4**  | 字符窗口                                   | ✅ 同 β                                                                                                                                                              |
| **P5**  | 加注释消警                                 | ✅ 删 8 处误加注释、补 5 处真实缺失                                                                                                                                  |
| **P6**  | 门禁缺测试                                 | ◐ `codegen-coverage-gate.spec.ts` 长期红灯已修；**口径重测 52 个 quality 脚本中 37 个无 spec**（旧口径 27/18），本轮新守 4 个（§7.13-5）；剩余长尾的高杠杆解法已查明 |
| **P7**  | scripts 不在 lint 作用域                   | ✅ 已纳入，**代价与本文明示不同**（见 7.7）                                                                                                                          |
| **P3**  | 豁免无到期强制                             | ✅ 已开 `--strict-baseline`（原先预估的"会转红"未出现，见 7.6）                                                                                                      |
| **P8**  | 红灯归因不可自证                           | ✅ 已做：`scripts/audit/gate-golden.mjs`（`pnpm quality:golden`），见 §7.12                                                                                          |
| **P9**  | 沙箱内 eslint 不可重复执行                 | ❌ 未做（环境问题）                                                                                                                                                  |
| **P10** | **孤岛脚本"写完再没人跑"**                 | ✅ 已做：可达性门禁补三条"假绿"通道 + 孤岛台账（7 个已登记，只能变小），见 §7.13                                                                                     |

### 7.2 量化验证：修复前后与本文 §2 的独立统计逐项吻合

迁移期用两版实现对照。**差异条数与 §2.2 / §2.3 人工核验的数字完全对上**：

| 版本 | 改动                        | 命中总数          | 消失  | 新增   |
| ---- | --------------------------- | ----------------- | ----- | ------ |
| 原版 | —                           | 64（baseline 64） | —     | —      |
| C    | 只修 β/δ（块内 + 原语法族） | **72**            | **6** | **14** |
| D    | C + 修 γ（扩展语法族）      | 106               | 6     | 48     |

- **「消失 6」精确等于 §2.2 表格里逐条核验的 6 处跨块错配**（`indexeddb:262,410`、`guest:306,350`、
  `backup:256`、`memory:331`），一条不多、一条不少。
- **「新增 14」精确等于 §2.3 的 δ 统计（14 处「块首到 return >240 字符」漏检）**。
- 故 `64 − 6 + 14 = 72`，与版本 C 的总数自洽；版本 D 的 48 = 14 (δ) + 34 (γ)。
- 版本 D 的 106 里含裸 `return;`；按 7.4-2 排除后为 73，再修嵌套 catch 重复计数后落到最终的 **72**。

> 这条对照的意义：**修 β 之后「消失集合」必须与人工核验的错配清单完全相等**。若不等，说明配平扫描
> 自身有偏差。实测相等 ⇒ 两套**相互独立**的方法（人工开源码核验 vs 配平解析）互证。

### 7.3 变异自证（§4.6 要求的证明）

**缺陷级对照**（同一段构造源码同时喂旧实现与新实现，旧实现逐字取自 `git show HEAD`）：

| 探针                                                    | 旧实现                          | 新实现             | 期望                     |
| ------------------------------------------------------- | ------------------------------- | ------------------ | ------------------------ |
| β：`catch (e) { throw e; }` 后紧跟块外的 `return null;` | 命中 1                          | 命中 0             | ✅                       |
| γ：`catch (e) { return undefined; }`                    | 命中 0                          | 命中 1             | ✅                       |
| δ：块首→`return null` 距离 **858** 字符                 | 命中 0                          | 命中 1             | ✅                       |
| γ 反向：裸 `return;`                                    | 命中 0                          | 命中 0             | ✅（刻意不报，见 7.4-2） |
| α：真实文件 `src/guest/index.ts` 顶部插 1 行            | 旧 id **0/5 存活**（100% 漂移） | 新 id **4/4 存活** | ✅                       |

**端到端**（跑真门禁 `node scripts/quality/check-swallow-fallbacks.mjs`，非只跑纯函数）：

| 步骤 | 操作                                                         | 结果                                                |
| ---- | ------------------------------------------------------------ | --------------------------------------------------- |
| E1   | 在 `src/` 放一个未声明的 `catch { return undefined; }`       | ❌ RED，`EXIT=1`，定位 `src/__swallow_probe__.ts:4` |
| E2   | 给同一站点补合法 `@swallow-error`                            | ✅ 绿（`new: 1` 但已被豁免）                        |
| E3   | 删掉探针文件                                                 | ✅ 回到 `current: 72 / stale: 0 / new: 0`           |
| E4   | 放一个块首→`return null` 距离 858 字符的 catch（δ）          | ❌ RED，`EXIT=1`，定位同一站点                      |
| E5   | 在 `src/guest/index.ts` **顶部插 1 行**（该文件行号整体 +1） | ✅ **仍全绿**（`matched: 72 / stale: 0 / new: 0`）  |
| E6   | 实时工作区残留检查                                           | ✅ 探针文件已删，`git status` 无残留                |

> **E5 是 α 的端到端证明**：修复前行号漂移会让该文件 5 条同时报 `[STALE]`（旧 id 0/5 存活），修复后
> 一条都不报。E1/E4 同时证明门禁**不是纸面门禁**——注入真实缺陷时它会红，且精确报出位置。

### 7.4 与本文原方案的 3 处偏差（均有实测依据）

本文 §4.1 / §4.2 / §4.4 的部分具体建议经实测**影响面过大**，已按证据调整。**以下是本文的自我修正**：

1. **不采用 §4.2 的「catch 内有 `throw` → 不是吞错」判定**（原文
   `if (/\bthrow\b/.test(body)) return false;`）。
    - 实测加上它会出现 `消失 29 / 新增 1`：它把大量**条件降级**写法误杀。典型反例
      `src/account-data/index.ts:188` → `if (isAccountDataNotFoundError(e)) return null; throw e;`
      （not-found 时降级为 `null`、其余照抛）——这是**正确**写法，却会被这条判定放过检测面。
    - **β 的修复本来就不需要它**：配平扫描已经把「块外的 `return`」排除干净，5 条假阳性自然消失。
      该判定属于"顺手多加的过滤"，只会引入新的假阴性。**结论：β 只需修边界，不要加 rethrow 过滤。**

2. **裸 `return;` 刻意不计入兜底值**（与本文 §2.3「γ 含 `return;`，约 35 处」及 §4.4 不同）。
    - `return;` 只出现在 void 函数里表示正常提前结束，此时错误往往**已经传播出去**：
      `catch (e) { this.onUserMediaFailed(e); return; }`、
      `catch (err) { deferred.reject(err); return; }`。
    - 实测纳入后命中 106、其中 44 条缺注释，而这 44 条里 30+ 条是上述正常写法。排除后 106 → 73。
    - ⇒ **§4.6 的「γ 自证：构造 `catch { return; }` 应**报**」这条期望本身是错的**；正确期望是"不报"。
      本文 7.3 的「γ 反向」行按后者执行，`check-swallow-fallbacks.mjs` 文件头也写明了这个取舍。
    - γ 的真实收益以 `return undefined / "" / 0` 为主。

3. **id 形态对齐既有正解，而非新造第三种**：§4.1 建议 `${relPath}#${digest}#${ordinal}`；实现改为把
   ordinal **并入 digest 输入**，对外仍是 `${filePath}#<16 hex>` 两段式，与
   `check-real-backend-types.mjs:74` 的既有形态一致（行为等价，但不引入新格式）。

### 7.5 baseline 迁移与单射校验（§4.1 要求）

- swallow：64 → **72** 条；generated-dto：67 → **67** 条（纯格式迁移，无增减）。
- 新条目形态：id 为 `src/.../x.ts#<16 hex>`（**无行号**）；`line` 保留、并新增 `ordinal` 作为展示字段；
  `snippet` 改为**块内**片段（不再跨越 `}`）。
- **单射校验**：新旧条数各自守恒，且 64→72 的 8 条增量可逐项归因（退役 6 + 新增 14），
  无站点被 ordinal 静默折叠。
- 备份：`/tmp/swallow-baseline.old.json`（迁移前快照）。

### 7.6 审查门（P2 / §4.5 的机制化）

`--update-baseline` 在两个门禁里统一输出四分类，且 `added` 非空时**默认拒绝写入**（`EXIT=1`）：

```
[swallow-fallback] baseline 变更摘要
  指纹保持   : 72
  行号重记   : N     ← 指纹未变、只有行号变（安全重记，§4.5 说的「只能靠人工 git diff」现由脚本保证）
  退役(stale): N     ← baseline 有、当前扫不到（站点真没了）
  新增(added): N     ← **必须人看过**，否则拒绝写入
```

- **两次实战验证有效**：① 迁移期 `added=73` 时被拒绝写入（baseline 未被改动）；② 嵌套 catch 修复后
  `added=0` 时正常放行，并顺带退役 1 条。
- 提取 `scripts/quality/lib/stable-id.mjs`，导出 `stableId` / `nextOrdinal` / `normalizeSnippet`；
  文件头写明"写新门禁时请遵守"的三条约定（稳定维度、行号只作展示、序数不折叠）。

**P3：`--strict-baseline` 已常态化（§4.5 说"无论上面怎么改都该做"）。**
`quality:swallow-fallbacks` 现在带上 `--strict-baseline`：baseline 存量项若**缺注解或已过期**即阻断，
不再只 `console.warn`。这与 `path-contract-waivers` + `quality:waiver-expiry` 的纪律终于一致——
同一仓库不该有两种豁免口径。

**启用前先实测**，因为本文原先判断"一打开现有存量条目会直接转红"：

```
$ BASELINE_STRICT=true node scripts/quality/check-swallow-fallbacks.mjs
[swallow-fallback] quality gate passed (current: 72, baseline: 72 [matched: 72, stale: 0], new: 0)
STRICT_EXIT=0
```

**实测通过**——原因很直接：§7.5 的重新迁移已经保证 72 条**全部**带合法且未过期的 whitelist
（`expires` 分布：`2026-12-31`），所以此刻开启是空的。原先那句"会直接转红"是**没跑就下的结论**。

### 7.7 横向整改（P1/P7）——含一处与现实不符的预估

**P1（generated-dto 去行号）**：改用共享 lib + ordinal，baseline 67 → 67 条；并补上本文 §3.3 指出的
缺口——它原先"有 spec 但不覆盖 id 稳定性"。新增两条断言（`spec/unit/generated-dto-quality.spec.ts`）：
「上方插行不改 id」与「同文件相同文本用 ordinal 区分」。

**P7（`lint:js` 加 `scripts`）**：已完成。但本文把这件事的代价估小了——直接 `eslint scripts` 会报
**2358 条 / 78 个文件**，且几乎全是**与本轮无关的存量风格问题**：

| 规则                 | 条数 | 处理                                                                           |
| -------------------- | ---- | ------------------------------------------------------------------------------ |
| `one-var`            | 1665 | `scripts/**` 覆盖块关闭（`src/**` 早已关掉同一条）                             |
| `no-console`         | 598  | 关闭——这些脚本的产物就是打给 stdout 的报告                                     |
| `camelcase`          | 59   | 关闭——契约/审计 JSON 的字段名是 snake_case                                     |
| `no-unused-vars`     | 23   | 降为 `warn`（与 `src/**` 口径一致）                                            |
| `no-require-imports` | 5    | 关闭（`.cjs` 用 `require()` 是本分）                                           |
| `no-explicit-any`    | 2    | 关闭（`.d.mts` 声明文件）                                                      |
| `prefer-const`       | 5    | **修掉**（真实问题：3 个文件、5 处 `let`→`const`）                             |
| 解析错误             | 1    | `scripts/**/*.d.ts` 不在 `tsconfig.eslint.json` 的 project 内 → 已加入 include |

做法：新增 `scripts/**` 覆盖块 + 修 5 处 `let`→`const` + `tsconfig.eslint.json` 加一行 include。
结果 `eslint scripts` = **0 errors / 27 warnings / EXIT=0**。
**没有**靠"把 2358 条静默关掉"了事——被关闭的只有 6 条**与 CLI 体裁无关**的规则，其余保持开启，
真实问题（`prefer-const`、`no-unused-vars`）仍会报出来。

### 7.8 明确未做（不计入"已解决"）

- ~~**P3**~~：已在本轮开启，见 7.6。（原判断"一打开存量条目会直接转红"**未成立**——因为 §7.5 的重新迁移
  已保证 72 条全部带合法且未过期的 whitelist。教训：这类"以为会红"的判断应当先跑一次再下结论。）
- ~~**P8**：`lastGreenCommit` / pass 快照未做（本轮仍是人工 `git worktree add HEAD --detach` 复现归因）。~~
  **2026-10-07 已做（§7.12）**：改为产品化的 `attrib`（现场造 base 世界 + 失败集差分），并**有意不做**快照，理由见 §7.12-7。
- **P9**：沙箱内 `npx eslint <多文件>` 第二次调用即挂——环境问题，未做。
- **P6 长尾**：27 个 quality 脚本里仍有 18 个无 spec；本轮只补了出事的两个。
- **新发现（不在 §5 清单内）：`quality:manager-codegen` 单项门禁要跑 ≈28 分钟（结论 EXIT=0）。**
  `findStrongConsumers()` 对**每一个模块**都重新遍历并读取 `src/` 下全部 **625 个 `.ts` 文件**，
  实测 **≈28 s / 模块**；ledger 有几十个模块 ⇒ 单项门禁约需 **≈28 分钟**。
  本轮**最终跑完了**：`DONE manager-codegen EXIT=0`，耗时约 27 分钟（23:43:57 → 00:11:04）。
  但前台直跑会被 SIGKILL / exit 137，后台挂到 15 分钟时看起来"没进展"——**很容易被误判成 hang 或回归**，
  故在此记明：**它能通过，只是慢**。
  这是**预先存在**的性能缺陷——该脚本本轮**未改动**，且与本次改动无关：本轮的 `src/` 改动全是注释，
  既不影响 `findStrongConsumers`（它找的是 `__generated__/route-table` 的 **import 说明符**），
  也不影响 `fileMakesHttpCalls`（正则匹配运行时调用）。
  修法是把 O(模块 × 文件) 降到 O(模块 + 文件)（全量扫描一次、按模块归并）。
  → **已于 2026-10-07 修复**：改按 `srcRoot` 建「文件 → route-table 落点」导入索引，
  **29 分 37 秒 → 18 秒**，输出与修复前**逐字节一致**（见 §7.11-1）。

**已知检测边界**（已写入 `check-swallow-fallbacks.mjs` 文件头，避免后人误以为"门禁全绿 = 全仓无吞错"）：

1. `catch { logger.warn(e); } return null;`（错误吞在块外、`return null` 在块**之后**）不在检测面内。
2. 正则字面量里的 `{}`（如 `/\{/`）不参与配平，可能影响同一 catch 内的边界判定。

### 7.9 收尾复核中新发现并修掉的第 5 个缺陷：白名单注解泄漏进指纹

**发现方式**：不是靠读代码，而是把 α 的判据（"无关改动不得改变身份"）反过来问一句——
「**续期**算不算无关改动？」实测：

| 站点                             | 指纹                               |
| -------------------------------- | ---------------------------------- |
| 块内注解 `expires: "2026-12-31"` | `f.ts#cef989998efa034b`            |
| 只把续期改成 `2027-06-30`        | `f.ts#8a27af3158ad7ffe` ← **变了** |

**性质**：与 α 同一类病。注解是「关于这条命中的**元数据**」，不是它的身份。它一旦进了指纹：

1. 只改 `expires` 续期 → 旧条目判 STALE、新条目判 NEW ⇒ **门禁在纯元数据变更上变红**；
2. 把注解从 catch 前挪进块内（或反之）→ 同样变红；
3. 去掉注解 → 该站点同时报 STALE 与 NEW，而正确语义只有一条「NEW + 缺注解」。

**修法**：指纹输入改为把块内源码**剔除注解**后再规范化
（`replace(/\/\/\s*@swallow-error\s*\{[^}]*\}/g, "")`）。`whitelist` 仍单独解析并保留在条目里——
剔除的是「注解参与身份」，不是「不认注解」。

**迁移与单射校验**：影响 **10 条**（注解写在 catch 块内的那些）。
`--update-baseline` 摘要为 `指纹保持 62 / 退役 10 / 新增 10`，且**逐条核对：10 条的 `(file, line)`
位置一一对应，把旧 snippet 里的注解剔除后与新 snippet 完全一致——无一条是内容变更**。总数 72 → 72。

**新增守卫**（`spec/unit/swallow-fallbacks-gate.spec.ts`）：

- 「只改 `expires` 续期，指纹保持不变」；
- 「同一站点：带注解 / 不带注解 / 注解在 catch 前或块内，指纹都相同」（同时断言 `whitelist` 仍被解析）。

> 值得记一句：这个缺陷是**用 α 的判据反问出来的**——把「行号」推广成「任何非语义的元数据」。
> 修 α 时只想到行号，是漏了这一半。**审计的收益往往在"把已发现的判据推广一层"**，而不是再找新缺陷。

### 7.10 复跑结论

```
[swallow-fallback] quality gate passed (current: 72, baseline: 72 [matched: 72, stale: 0], new: 0)
[swallow-fallback] quality gate passed (…同上，BASELINE_STRICT=true，EXIT=0)
[generated-dto-strictness] quality gate passed (current: 67, new: 0)
spec/unit/swallow-fallbacks-gate.spec.ts      32 passed
spec/unit/generated-dto-quality.spec.ts        5 passed
tsc --noEmit                                   EXIT=0（无输出）
prettier --check .                             All matched files use Prettier code style!
eslint src spec perf scripts                   0 errors / 66 warnings
eslint scripts                                 0 errors / 27 warnings
```

**续修（2026-10-07）复跑**：`quality:manager-codegen` EXIT=0（**29 分 37 秒 → 18 秒**，stdout 与修复前逐字节一致）；
`spec/unit/codegen-coverage-gate.spec.ts` **18 passed**（原 17 例，其中 1 例是长期红灯）；
门禁相关 spec 共 **13 个文件 / 136 passed**（必须**串行**跑：并发跑会因 `spec/setupTests.ts` 的全局
`beforeAll` 超时造成 9 个套件假红，见 §7.11-5）。

其余门禁复跑（提交后）全部 EXIT=0：
`debt-markers` / `no-default-key` / `real-backend-types` / `timer-pairing` / `gate-reachability` /
`path-contract` / `waiver-expiry` / `contract-freshness` / `contract-drift` / `manager-extensions` /
`manager-codegen`（≈27 分钟，见 7.8）。`git status` 洁净。

---

## 7.11 续修（2026-10-07）：门禁自身的三个坑

出发点：§7.8 把 `manager-codegen` 记为"未做"，但**一个单项要跑 29 分钟的门禁等于不存在**——
它已进了 `quality:contracts` 聚合，实际没人会等它出结果。本轮清掉三处。

### 7.11-1 `manager-codegen`：O(模块 × 文件) → O(文件)

- **根因**：`main()` 对**每个** ledger 模块调用一次 `findStrongConsumers()`，而它每次都
  `listAllSources(src)` + 逐文件 `readFileSync` ⇒ **49 个模块 × 625 个文件 ≈ 3 万次读取**。
  沙箱里每次读都走 file-broker IPC（实测 ≈75 ms）⇒ **≈28 s / 模块**。
- **修法**：按 `srcRoot` 建一次「文件 → 解析后的 route-table 落点」索引，模块查询退化为查表。
  **判定口径一字未改**（跨模块消费、own-`__generated__/` 排除、命中顺序全部保持）。
- **证据（金标准对拍）**：先跑**未改动**的实现把 stdout 存成金标准，再改，再比对。

|            | 旧实现                             | 新实现                                      |
| ---------- | ---------------------------------- | ------------------------------------------- |
| 耗时       | **29 分 37 秒**                    | **18 秒**（空闲态；带并发干扰时实测 64 秒） |
| 退出码     | 0                                  | 0                                           |
| stdout     | 18 行 / 2519 字节                  | 18 行 / 2519 字节                           |
| stdout MD5 | `2d2f9fc6e7fa918a403f7dc246d9d236` | **同一个**                                  |

`diff -q` 无差异 ⇒ **只改成本、不改判定**。这比"改完看着结果差不多"强得多：判定类重构
应当用**逐字节对拍**证明，而不是肉眼扫一遍结论行。

- **顺带实测**：`src/` 下 `__generated__` 的 **163 个** `.ts` **没有一个**导入 route-table（对判定零贡献）。
  但**故意不做**"跳过全部生成文件"这一步优化——原实现的排除只针对**被查模块自己**的
  `__generated__/`，一刀切就是**顺手改了判定口径**。3 万 → 625 已把主要成本消掉，
  不值得为 20% 的边际收益动语义。

### 7.11-2 `probe-contract-drift.mjs`：抓源码常量的死脚本

- **症状**：`node scripts/quality/probe-contract-drift.mjs` → `TypeError: Cannot read properties of null (reading '0')`。
  它用正则从 `check-manager-codegen-coverage.mjs` 的**源码**里抓 `LEDGER_MODULE_ALIASES` /
  `LEDGER_MODULE_TO_SDK_DIR` 再 `new Function` 求值；两个常量后来搬进 `contract-module-map.mjs`，
  正则**再也匹配不上**，`grab()` 对 null 取 `[0]`。
- **为什么没人发现**：它自称"不是门禁，未接入 pnpm lint"，且**全仓零引用**（孤岛脚本）——
  没有任何东西会执行它，所以坏了就一直坏着。
- **修法**：改为 `import { findSdkDirForModule } from "../contract-module-map.mjs"`
  （同一套映射的**唯一真相源**，从机制上不可能再漂移），并把 cwd 相对路径改为**脚本相对**
  （原实现只在仓库根目录下才跑得起来）。
  另修一处输出缺陷：无生成表的模块 `ledgerOnlySample` 是 `undefined`，打印成**空白行**，
  会把 184 条差集读成"没有差异"。
- **同一个病**：用正则/字符串去"咬"另一个文件的源码，与 §2.2 的 β（字符窗口跨块）同源——
  **把"文本相邻"当成"语义关联"**。本仓的 β 是纵向（跨 `}`），这里是横向（跨文件）。
- **修好 ≠ 不再腐朽**：它**仍未接入任何自动化**（自称"不是门禁"）。一个零引用脚本坏了半年也没人知道——
  而**留着一个没人跑的脚本比没有更糟**，因为它会让人以为"有人在看这件事"。处置要么纳入可达性检查，
  要么删掉；本轮只做了"让它能跑"，归属问题列入 §7.11-5。

### 7.11-3 `codegen-coverage-gate.spec.ts`：门禁的 spec 自己红了

- **事实**：`c1e304dc4`（2026-10-06，"移除纸面 waiver"）把 `push_notification` 移出 `WAIVED_MODULES`，
  但 spec 里 `expect(classifyModuleCoverage("push_notification", …).status).toBe("waived")` **没跟着改**
  ⇒ 该 spec 从那以后**一直失败**（本轮实测 17 例中 1 例红）。这与 §3.3 的观察互为印证：
  **"有 spec"不等于"有人守"**。
- **修法不是把断言改绿，而是抽掉断言里的业务硬编码**：
    - 样本模块名**从真实 `WAIVED_MODULES` 里取**（为此把该表导出给 spec 用）——表变了断言自动跟着走；
    - 到期日**不再写死** `"2026-12-31"` / `"2027-01-01"`，改为"晚于 today" / "由条目自身推导"。
      写死的话每次续期都会假红，而**续期是例行操作**（§7.9 刚专门处理过它的指纹问题）；
    - 新增一条只依赖表本身的不变量断言：每条 waiver 都必须带 `reason` 与**可解析**的 `expires`。
- **结果**：**18 passed**（原 17 例，其中 1 例修复；+ 2 条索引守卫 + 1 条表完整性守卫）。

### 7.11-4 本轮新增的守卫

| 守卫                                    | 防什么                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `同一进程内不同 srcRoot 的索引互不串味` | 索引若按模块名而非 `srcRoot` 分键，"没接线的模块"会被误判成 covered —— 正是本门禁历史上栽过的那类坑        |
| `同一 srcRoot 重复查询不再读盘`         | **删掉源文件后结果不变**即证明走了索引；这是 O(模块 × 文件) → O(文件) 的行为化断言，不用计时（避免 flaky） |

### 7.11-5 仍未做（不计入"已解决"）

- **P6 长尾**：仍有 18 个 quality 脚本无 spec；本轮只多守住了 `codegen-coverage-gate`。
- **孤岛脚本**：`probe-contract-drift.mjs` 已修好，但它仍然**零引用**。全仓 27+ 个 quality /
  诊断脚本里有多少是"写完之后再没人跑过"的？这需要一轮"脚本可达性"盘点——**本轮只修了碰到的这一个**。
- **P8**：~~`lastGreenCommit` / pass 快照仍未做。~~ 但本轮**手工跑了一遍它的替代动作**
  （存旧实现金标准 → 改 → 对拍），恰好说明这个动作值得产品化。→ **2026-10-07 已产品化，见 §7.12**。
- **P9**：并发跑 13 个门禁 spec 时，**9 个套件**栽在 `spec/setupTests.ts:31` 的全局 `beforeAll` 超时
  （`Hook timed out in 120000ms`），而**同一个 spec 单独跑是 18 passed**。
  即"红灯归因不可自证"（P8）与"结论依赖执行方式"（P9）是同一个病的两面：
  **一次红灯的归因成本高于修它本身，人就会开始忽略红灯。**

---

## 7.12 P8 落地（2026-10-07）：把「存金标准 → 改 → 对拍」与红灯归因产品化

出发点：§7.11-5 记「P8：`lastGreenCommit` / pass 快照仍未做」，但本轮做 §7.11-1 的性能重构时**又手工跑了一遍它的替代动作**：

```bash
node scripts/quality/check-manager-codegen-coverage.mjs > /tmp/old.out
# …改脚本…
node scripts/quality/check-manager-codegen-coverage.mjs > /tmp/new.out
diff -q /tmp/old.out /tmp/new.out      # 无差异 = 只改成本、不改判定
```

这恰好说明两件事：**这个动作值得产品化**，而「每次都要人肉记步骤、人肉比对、人肉清理」正是它此前没被写下来的原因。

### 7.12-1 交付物：一条命令、三个子命令

`scripts/audit/gate-golden.mjs`（`pnpm quality:golden`）：

| 子命令         | 回答什么                                 | 机制                                                                                                  |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `capture <id>` | 存金标准                                 | 跑一次，把 stdout / stderr / 退出码 + git 上下文整份存进 `.quality-goldens/<id>.{json,stdout,stderr}` |
| `verify <id>`  | 这次重构只改成本吗？                     | 再跑一次，与存盘**逐字节**比对；命令没给就从存盘回读，改完直接 `verify` 不必重打命令                  |
| `attrib`       | **这条红灯是本轮改红的，还是本来就红？** | 同一条命令在「工作区」与「base 参考点」各跑一次，做**失败集差分**                                     |

`capture/verify` 是**跨时间**的对拍（改之前存、改之后比）；`attrib` 是**跨世界**的对拍（base 提交 vs 当前工作区）。
后者不需要任何预先存盘——它现场把 base 世界造出来，所以归因结论永远是**实测**，而不是靠一份可能过期的快照推断。

命令来源三选一：`--script <pnpm 脚本名>` / `--node <文件>` / `--cmd "<shell 命令>"`；`attrib` 还支持位置参数简写（`attrib quality:cross-repo-pin`）。

### 7.12-2 为什么不是「只看退出码」

退出码只能回答红/绿。真正要回答的是**失败集变没变**：一条门禁两侧同红，但本轮又新增 3 条失败，和「两侧失败集一模一样」是两回事——处置方式完全不同（前者要先还旧债，后者才谈得上 revert）。所以 `attrib` 做**行级多重集差分**（保重数、不折叠重复行；折叠会让「又多出 3 条同样的失败」隐身）：

| base | 本轮 | 失败集 | 结论                       | 算「本轮引入」 |
| ---- | ---- | ------ | -------------------------- | -------------- |
| 绿   | 绿   | —      | `CLEAN`                    | 否             |
| 绿   | 红   | —      | `INTRODUCED` ⚠️            | **是**         |
| 红   | 绿   | —      | `FIXED`                    | 否             |
| 红   | 红   | 无新增 | `PRE_EXISTING`（本来就红） | 否             |
| 红   | 红   | 有新增 | `PRE_EXISTING_PLUS_NEW` ⚠️ | **是**         |

`attrib` 退出码：`INTRODUCED` / `PRE_EXISTING_PLUS_NEW` → 1；其余 → 0（`--no-fail` 可强制 0）。`--json` 出机器可读结论。

### 7.12-3 base 世界怎么造：五个不踩对就出「假归因」的点

**假归因比不归因更坏**——它会让人放心地放过一条真回归。所以逐条记明：

| #   | 点                                      | 不做的后果                                                                                                                                                                                                                                |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **用 `git worktree`，不用 `git stash`** | stash 会动用户工作区、失败时可能丢改动；worktree 对工作区只读                                                                                                                                                                             |
| 2   | **必须镜像兄弟仓库**                    | 本仓 3 条门禁按 `../synapse-rust` / `../Tjg` 找邻居（`check-cross-repo-pin` / `check-sdk-contract-alignment` / `verify-path-contract`）。base 世界放进 `/tmp` 后 `../synapse-rust` 解析不到 ⇒ base 侧**因环境缺失而红**，被误读成本轮改红 |
| 3   | **必须软链 `node_modules`**             | 3 条门禁 `import ts from "typescript"`，另有多条 spawn `eslint` / `tsc` / `type-coverage`                                                                                                                                                 |
| 4   | **必须建在可删目录**                    | 本机沙箱会拦工作区外目录的删除：`git worktree add ../x` 能建、`git worktree remove` 却报 `Operation not permitted`（已实测），留下垃圾                                                                                                    |
| 5   | **比较前必须归一化路径**                | 两个世界 cwd 不同，输出里的绝对路径必然不同；不归一化则「每条含路径的行都是差异」，差分全废                                                                                                                                               |

第 2 点的做法：在 base 世界的**同级**逐条软链出真实仓库父目录里的所有条目（实测 55 条，含 `synapse-rust`），于是 `<base>/../synapse-rust` 与真实世界解析到同一个仓。

归一化口径（默认开，可关）：两个仓库根 → `<ROOT>`；抹掉 ANSI 颜色；CRLF → LF；ISO 时间戳 → `<TS>`；
以及**行号 → `<L>`**——在文件上方插一行注释会让所有 `file.ts:12:` 变成 `:13:`，那是**行号平移**不是新失败，
正是审计 α 项在指纹里去掉行号的同一个道理。要逐字节严格比对用 `--exact-lines`（或 `--raw` 全关）。

### 7.12-4 变异自证（对真实门禁，实测）

| 场景                                                                   | 命令                                                                                                 | 结果                                                                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 干净树归因                                                             | `attrib --script quality:no-default-key`                                                             | base 0 / 本轮 0 → **CLEAN**，exit 0                                                                                       |
| **注入真缺陷**（新建 `src/__golden_probe__.ts` 含 `?? "DEFAULT_KEY"`） | 同上                                                                                                 | base 0 / 本轮 1 → **INTRODUCED**，exit **1**；新增 2 行点名 `src/__golden_probe__.ts:<L>`，并显示 base 独有的 `OK` 行消失 |
| **还原**（删掉探针文件）                                               | 同上                                                                                                 | → **CLEAN**，exit 0                                                                                                       |
| **天然红灯**（HEAD 上 `quality:cross-repo-pin` 本就 red）              | `attrib --script quality:cross-repo-pin`                                                             | base 1 / 本轮 1，失败集**共同 15 行** → **PRE_EXISTING**，exit 0，并打印「这条红灯与本轮改动无关」                        |
| 对拍**检出**差异                                                       | `capture probe-diff --cmd "printf 'line-a\nline-b\n'"` 后 `verify --cmd "printf 'line-a\nline-c\n'"` | stdout 哈希不同 → **exit 1**，逐行指出 `line-b` 消失 / `line-c` 新增                                                      |
| 清理可靠性                                                             | 连跑 5 次 `attrib`                                                                                   | 5/5 临时世界与 worktree 注册**零残留**（`git worktree list` 只剩主工作树）                                                |

其中 `quality:cross-repo-pin` 一例**同时验证了第 2 点**：它需要 `../synapse-rust` 与 `../Tjg`，两侧都找到了同一份，
才会得出「失败集完全一致」；镜像失效时两侧会因邻居缺失各自报 `unknown`，差分立刻炸开。

### 7.12-5 它为什么不算门禁（可达性分类，未动 waiver 台账）

`check-gate-reachability.mjs` 的判据是「正文里出现 `process.exitCode = 1` / `process.exit(1)` 即自称门禁」。
本脚本**故意**在顶层 catch 里保留 `process.exitCode = 1`（意外崩溃恒为 1），从而**主动进入**该门禁的记账：

```
scripts/ 下 exit-1 脚本 56 个 → 受管辖门禁 44 个 / 工具类 12 个
INFO: 8 个 exit-1 工具类脚本不在 lint/CI 链路内 … · scripts/audit/gate-golden.mjs
✅ 无死门禁（可达 44 个 / 豁免 0 个）
```

- 它不在 `scripts/quality/`（该目录按约定只放门禁），文件名也不以 `check-` 开头 ⇒ 归为**工具类**；
- 它**不进 lint/CI** 是**设计如此**：`attrib` 要造 worktree 与基准提交，在 CI 里没有意义；
- 因此它出现在 INFO 列表里**保持可见**，而 **waiver 台账仍是空的**（44 个受管辖门禁全部可达，这个不变量没被破坏）。

> 换个说法：§7.11-2 给出的处置口径是「要么可达、要么删掉」，而这里的答案是**「它是工具不是门禁，所以既不该接 CI、也不该占 waiver」——但它必须被看得见**，所以刻意保留了那条 exit-1 路径。

### 7.12-6 单测与边界

`spec/unit/gate-golden.spec.ts`（+ `scripts/audit/gate-golden.d.mts`）——**35 passed**，只测纯函数：

- `classifyAttribution` 5 个分支逐条钉死，含两条反直觉用例：
    - **只有 base 侧的差异不影响「本来就红」**（本轮修好一条旧失败、仍留一条旧失败 ≠ 新回归）；
    - **base 绿 + 本轮红即使打印不出差异也要判 `INTRODUCED`**（有些门禁失败时只改退出码不打字，此时 `onlyInWork` 为空，绝不能退化成 `CLEAN`）；
    - 另加一条不变量：用例覆盖了 `ATTRIBUTION` 的**每一个**结论（不允许存在不可达的结论）。
- `normalizeForDiff`：根路径统一 / ANSI / 时间戳 / 行号折叠（含「关掉时保留原样」的对照）。
- `multisetDiff`：保重数（`[d]` vs `[d,d,d]` → 新增 2 条）。
- `sanitizeGoldenId`：`../../etc/passwd` 不得带出路径分隔符或 `..`。
- `parseArgs`：位置参数简写、与 `--script` 互斥、`capture` 缺 `<id>`、未知选项、缺值、`--timeout 0`、多余位置参数、`-h`。

**已知边界（有意不覆盖）**：

- 归因只比**可打印输出 + 退出码**。若门禁的判定依赖非确定性（时间、随机、网络），`attrib` 会把这种噪声报成差异——那属于门禁本身不确定，不是本工具的缺陷；`--raw` / `--exact-lines` 只能调口径，不能消除。
- `--base` 非 `HEAD` 时（判定「是**这个提交**改红的吗」），两侧 commit hash 不同；若门禁把 hash 打进输出，会被算成差异。用 `--base HEAD~1` 前先看一眼输出里有没有 hash。
- 沙箱下 `fs` 走代理 IPC 时，临时世界的删除**可能**失败——工具会**大声报告**并给出可直接粘贴的 `rm -rf <路径>`，不静默留垃圾。

### 7.12-7 本工具的第一批实测产出：**顺带查出一条既有 CI 红灯**（不在 P8 范围，未改）

工具做完后拿它扫了一遍 `quality:contracts` 链，抓到一条**本来就红**：

```
$ node scripts/audit/gate-golden.mjs attrib quality:exports
🟡 结论: PRE_EXISTING —— 本来就红（失败集与 base 完全一致）
   两侧失败集完全一致（共同 10 行）⇒ 这条红灯与本轮改动无关。
```

实际失败内容是 `docs/api-contract/exports.md` 与 `package.json#exports` 不同步：

```
[exports-docs] missing in docs:  - ./notifications
[exports-docs] extra in docs:    - ./notification
```

即 **`f728df035`（2026-10-06，`refactor(sdk)!`，commit message 明写
`BREAKING CHANGE: package.json exports 入口 ./notification 重命名为 ./notifications`）**
把 `package.json` 改了，**但 `docs/api-contract/exports.md` 没跟着改**
（该提交的 `--stat` 里根本没有这个文件）。source 目录与产物目录都叫 `notifications`，
`./notification` 根本无法解析。修法是文档那一行改成 `./notifications`（1 行）。

**为什么值得单独说**：`quality:contracts` **在 CI 里第一步就被它拦下** ——
`.github/workflows/systemic_refactor_quality_gate.yml:40` 跑 `pnpm quality:contracts`，
而该链（`package.json#scripts.quality:contracts`）的**首项正是 `quality:exports`**。
也就是说 develop 上这条 CI 自 `f728df035`（2026-10-06）起就是红的，而它不在 `lint` 链里，所以本地一直没人碰到。

**本轮不改它**：不在 P8 范围内，且要先确认没有下游引用（另开一张票）。
这条也顺带说明了本工具的价值 —— **P8 的验收不是「工具能跑」，而是「它第一次运行就回答了一个人答不上来的问题」。**

### 7.12-8 仍未做

- **P6 长尾**：~~仍有 18 个 quality 脚本无 spec（本轮未动）。~~ → **2026-10-07 起口径重测为 52 中 37 无；本轮新守 4 个，见 §7.13-5**。
- **P9**：沙箱内 `npx eslint <多文件>` 第二次调用挂——环境问题，未动。
- **`lastGreenCommit` / pass 快照**：本轮**有意不做**。`attrib` 现场造 base 世界并按**实测**判定，比「读一份可能过期的快照」更可信；快照唯一能补的是「省掉两次运行」，而实测这两条门禁各只需百毫秒级（72–215ms）。若将来出现**base 环境造不出来**的门禁（例如必须活后端），再补快照不迟。

---

## 7.13 孤岛脚本盘点 + P6 长尾一轮（2026-10-07）

两项都来自 §7.11-5 的"仍未做"：**① 全仓到底有多少脚本"写完再没人跑过"？② 门禁自身缺 spec 的长尾。**

### 7.13-1 被测事实：`scripts/` 下 76 个脚本的三层分类

| 层                      | 数量 | 说明                                                                                                 |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| 自称门禁（含 exit-1）   | 56   | 其中**受管辖 44**（`scripts/quality/` 或 check-/verify-/validate-/assert-/enforce- 命名）/ 工具类 12 |
| 其余脚本                | 32   | 诊断、报告器、共享库、构建助手                                                                       |
| **未接入 lint/CI 链路** | 21   | 有接线的人工工具 14 ＋ **零引用孤岛 7**                                                              |

**7 个孤岛（零引用 = 没有 npm script、没有别的脚本调用、没有 spec 引用）**：

| 脚本                                               | 判据    | 处置                                                                              |
| -------------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `scripts/audit/compare-routes.mjs`                 | 1384 行 | 保留（人工审计工具，依赖 codegen 产物）                                           |
| `scripts/audit/probe-route-module-attribution.mjs` | 39 行   | **建议删除**（一次性探针，结论已入文档）                                          |
| `scripts/generate-api-coverage-report.mjs`         | 162 行  | **建议删除**（与 `quality:coverage` / `quality:coverage-report` 职能重叠）        |
| `scripts/quality/debt-weekly-report.mjs`           | 174 行  | 保留（按周人工/定时运行）                                                         |
| `scripts/quality/probe-contract-drift.mjs`         | 78 行   | 保留（§7.11-2 已修好，仍是人工取证工具）                                          |
| `scripts/release/merge-release-notes.cjs`          | 5761 B  | **建议删除**（上游脚本副本；本仓 CI 从 `.action-repo/` 加载，本仓这份从未被调用） |
| `scripts/update-doc-hashes.mjs`                    | 117 行  | 保留（自述 one-shot helper）                                                      |

### 7.13-2 根因：可达性门禁有三条"假绿"通道（一条已存在，两条潜在）

`check-gate-reachability.mjs` 回答"这个脚本会不会被执行"。它自己会**把"没人跑"判成"有人跑"** —— 这类错比漏报危险，因为它让人放心。

| #   | 通道                                                                              | 后果                                                                                                                                                              | 修法                                                                                          |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | **枚举盲区**：`collectExitOneScripts()` 只收正文含 `process.exitCode = 1` 的脚本  | `scripts/quality/` 下**不含 exit-1** 的诊断脚本对门禁**完全隐形** —— `probe-contract-drift.mjs` 坏了半年没人知道（§7.11-2 的根因）                                | 枚举改由**目录**决定（`collectScripts()` 收 `scripts/` 下全部脚本）；"自称门禁"只用来**分类** |
| 2   | **注释自指假绿**：可达性 = "谁**调用**了它"，但旧实现扫的是**原始文本**（含注释） | 在任一**可达**脚本的注释里写一句 `scripts/quality/xxx.mjs`，xxx 立即变成"可达"。**本门禁自己的文档注释里就写着 `probe-contract-drift.mjs`——实测把它从孤岛"救活"** | 先 `stripComments()` 再抽引用（`@discovers-gates` 标记按约定写在注释里，故标记仍从原文取）    |
| 3   | **相对引用解析错**：`import "./lib/stable-id.mjs"` 被当成**仓库根相对**           | 共享库（`lib/stable-id.mjs`、`contract-module-map.mjs`）解析不到 ⇒ import 图断开，库会被误判成孤岛                                                                | `extractReferences(text, baseDir)` 按**引用者目录**解析 `./` `/../`                           |

还有第 4 条是**我修完前三条后新撞出来的**：

| #   | 通道                                                          | 后果                                                                                                                                                                 | 修法                                                                                                                  |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 4   | **反例夹具假接线**：把"spec 文本里出现过脚本名"当成"有人跑它" | spec 里 `expect(GATE_LIKE.test("scripts/audit/compare-routes.mjs")).toBe(false)` 这种**反例夹具**会把真孤岛从台账抹掉；实测它让 2 个孤岛"消失"，反过来把台账判成腐烂 | spec 只认**解析得到的路径引用**（`new URL("../../scripts/x.cjs", import.meta.url)` / `import`），不认文本里出现的名字 |

> 这四条是同一个病的四个切面：**把"文本里出现过"当成"真的执行了"**。与 §7.11-2 的 `probe-contract-drift` 用正则去咬另一个文件的源码、与 §2.2 的 β（字符窗口跨块）同源 —— 都是**把"相邻"当成"相关"**。

### 7.13-3 变异自证（新增的三种失败模式真的会失败）

| 变异                                                      | 期望             | 实测                                                                        |
| --------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| 新造一个零引用脚本 `scripts/quality/orphan-probe-tmp.mjs` | 报"未登记的孤岛" | ✗ 未登记的孤岛脚本：`scripts/quality/orphan-probe-tmp.mjs`，exit 1          |
| 台账里登记一个**不存在**的文件                            | 报"孤岛台账腐烂" | ✗ `does-not-exist.mjs —— 文件已不存在`，exit 1                              |
| 关闭 `stripComments` 里的**正则识别**（spec 变异）        | 恰好 1 条用例红  | `17 tests \| 1 failed`，红的正是"正则字面量里的引号/反引号不能让词法器错位" |

> 第三条尤其值得记：`stripComments` 是**朴素词法器**，遇到正则字面量里的 `` ` ``、`"`、`'` 会进入"字符串态"再不出来，于是**其后整篇注释都剥不掉** —— 而 `extractReferences` 自己那个正则的字符类里恰好同时含这三个字符。这不是 hypothetical：第一版就踩了，表现是"孤岛从 7 个变 5 个"。

### 7.13-4 孤岛台账（ratchet：只能变小的数字）

新增 `scripts/quality/orphan-scripts-baseline.json`，与 `gate-reachability-waivers.json` 同一套纪律：

- 出现**未登记**的孤岛 ⇒ 门禁失败（强制"接线 or 删除 or 写明 reason"三选一）；
- 台账**腐烂**（条目已接线 / 文件已删 / 缺 reason）⇒ 门禁失败；
- **登记 ≠ 修好**：登记只是把"全仓有多少脚本没人跑"钉成一个只能变小的数字，真修法仍是接线或删除。

门禁现状输出：

```
[gate-reachability] scripts/ 下脚本 76 个：自称门禁 56 个（受管辖 44 / 工具类 12），其余脚本 32 个
[gate-reachability] 未接入 lint/CI 链路: 21 个（有接线的人工工具 14 / 零引用孤岛 7）
[gate-reachability] ✅ 无死门禁（可达 44 个 / 豁免 0 个）；孤岛脚本 7 个（均已登记）。
```

### 7.13-5 P6 长尾：口径重测（**27/18 → 52/37**）与本轮成果

| 口径                        | 数值        |
| --------------------------- | ----------- |
| `scripts/quality/*.mjs`     | **52**      |
| 有 spec 引用（本轮前 → 后） | 11 → **15** |
| 无 spec 引用（本轮前 → 后） | 41 → **37** |

> **口径说明**：审计原表写"27 个 quality 脚本中 18 个无 spec"，而现状是 52 个脚本。原口径是**当时的脚本数 + `grep -rl <stem> spec/`**；脚本数后来长到 52（含 18 个 granular），且附录 A 那条 grep 在本轮 spec 变多后不再等价。故 §5/§7.1 的"18"应读作**旧口径**，本文以 52/37 为准。

**本轮新守住 4 个门禁**（均先导出纯函数 + 双模式入口，再补 spec + `.d.mts`）：

| 门禁                      | 为什么它值得先守                                                                 | spec 用例数 |
| ------------------------- | -------------------------------------------------------------------------------- | ----------- |
| `check-gate-reachability` | 它自己就是"守门人的守门人"，且本轮刚被大改（§7.13-2 三条通道）                   | 17          |
| `check-no-default-key`    | 防的是**公开常量密钥回归**（`legacyPickleKey ?? "DEFAULT_KEY"`，端侧 E2EE 归零） | 7           |
| `check-log-sensitive`     | 警告型门禁最大的失效方式是**噪音**（一吵人就整体忽略），两侧判据都要钉死         | 8           |
| `check-waiver-expiry`     | P3 的到期强制；**边界错一天**就变成"每逢到期日假红"或"债务永不归还"              | 8           |

**结构性发现（剩余 37 个的高杠杆解法）**：剩下的无 spec 里，**18 个 `check-*-granular-coverage.mjs` 全在其中**。它们不是 18 份逻辑，而是**同一模板的 18 份副本**——`readRelative` / `escapeRegex` / `hasMethod` / `collectMissing` 四个 helper 逐字重复，各文件只有 `CHECKS` 数据不同。
因此正确解法不是补 18 个 spec，而是**抽 `scripts/quality/lib/granular-coverage.mjs` + 一份 spec**，18 个门禁只留数据。这一步可把"无 spec"从 37 一次性压到 ~19，且顺带消掉 18 份重复代码。**本轮未做**（涉及 18 个文件，需单独一轮 + 对拍自证）。

### 7.13-6 顺带实测到的小缺陷（**未修，只记录**）

- `check-waiver-expiry.mjs` 的报告头用的是 `today.toISOString().slice(0,10)`——**UTC 日期**。本地 2026-10-07 早上跑，它打印的是 `2026-10-06`。分类逻辑本身是对的（用的是本地零点 `today`），只有**打印**早一天。修它会改变门禁 stdout（判定类重构须先存金标准），故本轮不动。

### 7.13-7 仍未做（见 §7.14 的进展）

- **P6 剩余 37 个门禁无 spec**（含 18 个 granular）；高杠杆解法见 §7.13-5 → **§7.14-6 已做**。
- **3 个孤岛建议删除**（§7.13-1 标粗的三条）→ **§7.14-5 已删**。
- **P9**：`npx eslint <多文件>` 在本机沙箱仍会 SIGTERM（本轮实测 exit 137），只能后台跑；属环境问题。

---

## 7.14 处置一轮（2026-10-07）：红灯清零 + 抽库 + 孤岛收缩

§7.13 结束时遗留 4 类问题。本轮逐条处置，并把过程中**新暴露**的问题一并解决。

### 7.14-1 `quality:exports` 红灯：文档没跟上 `f728df035` 的重命名

| 项       | 事实                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 现象     | `quality:contracts` 的第一步即挂 ⇒ CI 全链红                                                                                                                                                                             |
| 根因     | `docs/api-contract/exports.md` 里仍写 `./notification`；`package.json` 早在 **`f728df035`**（`refactor(sdk)!`，BREAKING CHANGE 明写"`./notification` 重命名为 `./notifications`"）就已改名，该提交的 `--stat` 从不碰文档 |
| 修法     | 改文档那一行（`./notification` → `./notifications`）                                                                                                                                                                     |
| 下游核查 | 全仓搜 `'./notification'` 裸引用（含 ts/mjs/cjs/json/md）→ 除本文档外无残留                                                                                                                                              |
| 结果     | ✅ 50 exports / 50 documented rows，`EXIT=0`                                                                                                                                                                             |

### 7.14-2 `quality:public-api-docs` 红灯：棘轮 R2 补文档 + R3 下调台账

| 类型                           | 内容                                                                                                                                                                         | 处置                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **R2**（缺口上升，必须补文档） | 台账快照 2026-10-05 之后新增的 11 个方法缺 `@example` / `@throws`：NotificationsManager 4、RoomManager 3、RoomSummaryManager 1、RoomSummaryKeyManager 1、TurnServerManager 2 | 逐个补 JSDoc（对齐本仓 `@example` 文风），缺口 763→752、220→215，正好 −11/−5 |
| **R3**（缺口收窄，需下调台账） | AdminFederation / AdminServer / AdminUser 三个 manager 的缺口变小                                                                                                            | `--write-ledger` 下调，台账 `capturedAt` 随之更新                            |

**方法学**：不用"缺口对不上就补"的蛮力，而是 `git log --since=2026-10-05` 定位台账快照之后**真新增**的方法——实测两者 **1:1 对上**，说明棘轮没有误报。补完 `tsc`/`swallow-fallbacks`/`manager-codegen`/`docs-examples` 全部复跑无副作用。

### 7.14-3 可达性门禁的**第 4 条假绿通道**：抽库会让 18 个门禁集体掉出管辖

这是本轮**最重要**的一条，且是本轮工作自己撞出来的：

> 受管辖判据原来是「正文含 `process.exitCode = 1`」。把 18 个 granular 门禁的判定逻辑抽到
> `scripts/quality/lib/granular-coverage.mjs` 之后，这 18 个文件的正文**不再有 exit-1**，
> 于是它们从"受管辖门禁"降级为"其余脚本"——**受管辖数 44 → 26，门禁覆盖率凭空缩水 40%**。
> 抽库是好事，门禁却变松了。

与 §7.13-2 的三条是同一类缺陷（**判据依赖实现细节，而不是契约**）。修法：

- 受管辖 = **路径形状**（`scripts/quality/` 下，或 `check-/verify-/validate-/assert-/enforce-` 开头），**不看**正文有没有 exit-1；
- `lib/` 下的共享库显式排除（它们是被 import 的实现，不是门禁）；
- 「自称 exit-1」降级为 **INFO 标签**；
- 判据抽成纯函数 `isGoverned(rel)` 并导出，由 spec 直接钉死（含"lib 不受管辖"与"只吃路径一个参数"两条）。

改完：受管辖 **53** 个（44 自称 + 9 靠路径认定）。

### 7.14-4 新暴露 5 个死门禁：**1 个是漏接，4 个是登记**

判据一改，立刻显形 5 个"在 `scripts/quality/` 下或叫 check-\*，但没有任何入口会跑"的脚本：

| 脚本                                               | npm 入口                        | 判定                                                                               | 处置                                                 |
| -------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `scripts/quality/find-lowest-coverage-modules.mjs` | `quality:coverage:weak-modules` | **漏接**：兄弟 `weak-files` 早在 `systemic_refactor_quality_gate.yml:94`，它却没有 | ✅ **接线**（加 workflow 步骤，advisory 不阻断）     |
| `scripts/check-bundle-size.mjs`                    | `quality:bundle-size`           | 只被 `prepublishOnly` 引用；本门禁的可达根是 lint + workflow，发布钩不在图内       | 登记豁免（pnpm publish 必过此步，非无人跑）          |
| `scripts/quality/generate-coverage-report.mjs`     | `quality:coverage-report`       | 产出 markdown 的**生成器**（写文件），不是判定门禁                                 | 登记豁免                                             |
| `scripts/quality/debt-weekly-report.mjs`           | 无                              | 周报生成器，人工/定时运行                                                          | 由孤岛台账**迁到**豁免台账（升格为门禁后走门禁纪律） |
| `scripts/quality/probe-contract-drift.mjs`         | 无                              | 诊断脚本，自述"不是门禁"                                                           | 同上                                                 |

waiver 台账此前为空（"45 个门禁全部可达"），本轮首批登记 4 条，每条带 reason；孤岛台账相应删除 2 条（升格）。

### 7.14-5 granular 抽库：18 份副本 → 1 个共享引擎 + 18 份数据

| 步骤     | 实测                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 预实验   | `room-space-search` 用的是宽松 `includes` 判据，其余 17 份是带词边界的正则。先在副本上换成严格判据 → **stdout 逐字节一致** ⇒ 可安全统一（否则得保留双判据）                                                   |
| 存金标准 | 对 18 个门禁各 `capture` 一份 stdout（P8 工具）                                                                                                                                                               |
| 抽库     | 建 `scripts/quality/lib/granular-coverage.mjs`；18 个文件重写为「`CHECKS` 数据（含注释逐字保留）+ 一行 `runGranularCoverage({title, checks})`」                                                               |
| 对拍     | `verify` × 18 → **18/18 逐字节一致**，零行为变化                                                                                                                                                              |
| 补 spec  | `spec/unit/granular-coverage-gate.spec.ts`（14 例），重点钉死**两侧判据严宽不对称**：`hasMethod`（owner 侧）带词边界、`hasTestHit`（测试侧）是字面 `method(` 子串。"统一"成同一套会让 18 个门禁集体假红或假绿 |
| 变异自证 | 去掉 `hasMethod` 的 `\b` → **恰好 1 条** spec 红；还原后复跑绿                                                                                                                                                |

**收益**：18 份重复 helper（~4 个 × 18）收敛为 1 处；P6 覆盖从 15 直接到 33（见 §7.14-6）；聚合运行器 `run-granular-coverage-gates.mjs` 复跑 18/18 通过。

### 7.14-6 P6 长尾：口径更新 **52 中已覆盖 34 / 未覆盖 18**

| 口径                             | §7.13-5 结束时 | 本轮结束 |
| -------------------------------- | -------------- | -------- |
| `scripts/quality/*.mjs` 总数     | 52             | 52       |
| 直接有 spec                      | 15             | 16       |
| 经共享引擎覆盖（18 个 granular） | 0              | 18       |
| **合计已覆盖**                   | 15             | **34**   |
| **仍无 spec**                    | 37             | **18**   |

计数按**真实引用**（spec 里解析得到的路径），不按"文本里出现过名字"——后者会把 spec 里的反例夹具当接线（§7.13-2 第 4 条）。

### 7.14-7 孤岛脚本删除 3 个：**7 → 2**

删除前确认：三个文件均**已被 git 跟踪**（可回溯），且全仓除历史审计文档与台账自身外**无任何代码引用**。

| 删除的文件                                                  | 理由                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `scripts/audit/probe-route-module-attribution.mjs`（39 行） | 一次性探针：硬编码 9 条 route 探测归属，结论已入审计文档                                                             |
| `scripts/generate-api-coverage-report.mjs`（162 行）        | 职能与 `quality:coverage`（repo/critical）及 `quality:coverage-report` 重叠                                          |
| `scripts/release/merge-release-notes.cjs`                   | 上游 `matrix-org/matrix-js-sdk` 的 release 脚本副本；本仓 CI 从 `.action-repo/` sparse-checkout 加载，这份从未被调用 |

剩余的 2 个孤岛（`audit/compare-routes.mjs` 1384 行审计工具、`update-doc-hashes.mjs` 自述 one-shot）保留并已在台账登记。

### 7.14-8 §7.13-6 的小缺陷已修：`check-waiver-expiry` 报告头 UTC

`today.toISOString().slice(0,10)` 是 **UTC**，而 `today` 是**本地**零点 —— 东八区 `2026-10-07 00:00` 在 UTC 是 `2026-10-06T16:00Z`，报告头打印成前一天。

按判定类重构纪律：先存修改前 stdout → 新增 `formatLocalDate()`（按本地日历分量格式化）→ 对拍。**diff 恰好只有 1 行**（`2026-10-06` → `2026-10-07`），分类逻辑完全没动。补 2 条 spec（含"与 toISOString 在跨日时必须不同"）。

> 踩到一个坑：`getTimezoneOffset()` 返回的是 **UTC − local**，东八区是 **−480** 而不是 +480。
> 第一版 spec 的符号写反，用例在本机直接红。已在 spec 注释里写明。

### 7.14-9 仍未做

- **P6 剩余 18 个无 spec**（`check-public-api-docs` / `check-repo-coverage` / `check-exports-docs` / `check-docs-examples` / `check-type-coverage` / `check-entrypoint-layering` / `check-msc-changes` / `check-sdk-contract-alignment` / `check-coverage-critical-files` / `check-contract-provenance` / `check-large-file-changes` / `check-vendor-prefix-migration` / `find-lowest-coverage-*` ×2 / `generate-coverage-report` / `run-granular-coverage-gates` / `scan-technical-debt`）。已无"18 份副本"这种高杠杆项，剩下的是逐条补。
- **P9**：`npx eslint <多文件>` 在本机沙箱仍会 SIGTERM（exit 137），只能后台跑；属环境问题。
- **`quality:report` 超时**：全量扫描里 `quality:report` 240s 超时（需活后端/全量测试），未定位。

### 7.15 全仓复检一轮（2026-10-07 第二轮）

§7.14 收尾时"44 绿 / 2 红"是从门禁自述状态推的。本轮改为**逐条实跑**：把
`scripts/quality/*.mjs` 与 `scripts/` 下所有 `check-|verify-|validate-|assert-|enforce-*`
共 60 余个脚本挨个执行（单个 300s 超时），再整条跑 `pnpm lint`。结论与自述口径有出入。

#### 7.15-1 全量实跑：3 红 1 慢，其中 2 红是"缺 lcov"而非缺陷

| 脚本                      | 现象                                          | 判定                                                                                            |
| ------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `check-critical-coverage` | `coverage file not found: coverage/lcov.info` | 非缺陷：CI 里它排在 `pnpm test --coverage` **之后**（workflow step 78），本地没跑过测试才有这条 |
| `check-repo-coverage`     | 同上（exit 2）                                | 同上（step 86），且注释已写明 lcov 由上面的 `pnpm test --coverage` 产出                         |
| `check-cross-repo-pin`    | pin 与兄弟仓不一致                            | **按设计红**：develop 上 pin 故意滞后，仅 `release/**` 触发                                     |
| `check-type-coverage`     | 耗时 252s                                     | 真问题，见 7.15-4                                                                               |

顺带澄清一个"看起来该红却没红"的点：`quality:coverage:critical-files` 也在 `pnpm lint` 里、
且 lint 排在 `pnpm test --coverage` **之前**（step 37 vs 72），本以为它会因缺 lcov 常红。
实测它绿 —— 它走的是**静态**判据（HTTP 调用 + spec import 图），根本不读 lcov。两条轨各管一半。

#### 7.15-2 `pnpm lint` 真红：prettier 3 个 md（含本轮刚提交的审计文档）

`pnpm lint` exit 1。eslint 部分 0 errors / 62 warnings（不阻断），失败点是
`prettier --check .` 报 3 个 md：审计文档（§7.13/§7.14 手工编辑未过 prettier）、
`debt-weekly-report-2026-W41.md`、`SDK_COVERAGE_REPORT.md`。已 `--write` 修复，
全仓 `prettier --check .` 复检 EXIT=0。

#### 7.15-3 门禁扫描本身有副作用：跑一遍就污染工作区

实跑全部脚本后，工作区冒出 2 个未跟踪文件：

- `docs/SDK_COVERAGE_REPORT.md`（`generate-coverage-report.mjs` 生成）—— 该文件早在
  38cb40301「SDK Phase D — redundancy cleanup」就被**有意删过**，生成器仍会把它写回来；
- `docs/governance/debt-weekly-report-2026-W41.md`（`debt-weekly-report.mjs` 生成）。

于是"我只是跑了一下门禁"就变成脏工作区，进而污染 `git status`、prettier 检查与提交。
已按既有 `/.docs-examples/` 的先例加入 `.gitignore`，并删除本次生成的两个文件。

#### 7.15-4 `check-type-coverage`：9 次串行调用 → 并发（85.8s → ~40s）

全 lint 链最慢的一环。根因：它对 `src` 整体 + 8 个模块目录**各跑一次**
`pnpm exec type-coverage`，每次都是一次完整 TS 类型检查，串行累加。

改为固定并发度（默认 3，可用 `TYPE_COVERAGE_CONCURRENCY` 覆盖）的任务池，
**判定逻辑一字未动**（同样 9 次调用 / 参数 / 阈值 / 输出顺序）。
等价性用 gate-golden 证明：capture（改前 85.81s）→ 改造 → verify，
退出码一致、**stdout 逐字节一致**（`be2c7cee8438`）、stderr 一致。

并发度不定更高的原因：每个 tsc 进程约 1GB，9 路并发在内存受限的 CI runner 上有 OOM 风险。

#### 7.15-5 `.lintstagedrc` 未覆盖 `.mjs`：管代码的门禁脚本自己不受管

pre-commit 只处理 `ts/tsx/py/md/yaml`，于是 `scripts/quality/**` 的门禁脚本提交时
既不过 eslint 也不过 prettier，只能靠不在 pre-commit 里的 `lint:js` 兜底。
已补 `*.(mjs|cjs|js)`，但**只加 prettier、不加 eslint**：eslint 对多个 `.mjs` 会跑到分钟级，
在部分环境（含本机沙箱）会直接 SIGTERM(137) 打断提交；而规则问题已由 CI 的 `lint:js`
一次跑完整个 `scripts/` 覆盖，代价只付一次。

#### 7.15-6 P6 口径精算：52 个脚本中 17 个非 granular 无 spec

上轮"37 → 18"是粗口径。精算（去 `check-`/`find-` 前缀配对 spec 文件名）：

- 18 个 granular 由 `granular-coverage-gate.spec.ts` 统一覆盖；
- 其余 34 个里 17 个有 spec、**17 个无 spec**，其中 **13 个是判定类门禁**
  （`check-sdk-contract-alignment` 1749 行 / `check-public-api-docs` 666 行 /
  `check-exports-docs` 374 / `scan-technical-debt` 261 / `check-docs-examples` 250 /
  `check-entrypoint-layering` 230 / `check-coverage-critical-files` 206 /
  `check-msc-changes` 203 / `check-repo-coverage` 119 / `check-contract-provenance` 103 /
  `check-type-coverage` 102 / `check-vendor-prefix-migration` 89 / `check-large-file-changes` 59），
  另 4 个是 advisory 报告器 / 生成器 / runner（`find-lowest-coverage-*` ×2、
  `generate-coverage-report`、`run-granular-coverage-gates`）。

本轮新守 `check-public-api-docs`（16 例）：它已有双模式入口与部分导出，故只补 spec 不动主流程。
钉的是三条**口径**——R0 导出面不许撒谎（broken 必为空，即 `./notification` 事故的回归守卫）、
可达闭包的传递性与收敛性、`.js`→`.ts` 与目录→`index.ts` 的解析。
变异自证：① `isTrackedClassName` 去掉 `$` 锚定 → 转红；② `resolveSpecifier` 去掉 `.js` 映射 → 转红。

#### 7.15-7 P6 后续批次：13 个判定类门禁全部守住

按"改造风险"而非纯规模排序推进，每个都走「capture → 抽纯函数 → verify 对拍 → spec → 变异自证」。

| 门禁                            | 行数 | 例数 | 钉住的关键口径                                                                   |
| ------------------------------- | ---- | ---- | -------------------------------------------------------------------------------- |
| `check-public-api-docs`         | 666  | 16   | R0 导入面不许撒谎、可达闭包传递性、`.js`→`.ts` 解析                              |
| `check-repo-coverage`           | 119  | 8    | LF/LH **加权**聚合（不是各文件比率的平均，后者被小文件稀释）；LF=0 记 100 而非 0 |
| `check-msc-changes`             | 203  | 8    | `moved` 是**集合**比较（换文件算迁移，仅重排不算）；两侧编号按字符串对齐         |
| `check-coverage-critical-files` | 206  | 13   | R3「到期当天」（daysLeft===0）不算过期；R2 缺字段后 continue 不叠加              |
| `check-vendor-prefix-migration` | 89   | 8    | 豁免窗口 ±4 行（太小误判标准 API，太大豁免掉私有端点）                           |
| `check-contract-provenance`     | 103  | 8    | 五条正则**整行锚定**（改子串匹配后散文也能过，门禁形同虚设）                     |
| `check-large-file-changes`      | 59   | 9    | 阈值是 `>` 非 `>=`；已删除文件必须跳过                                           |
| `scan-technical-debt`           | 261  | 20   | 指纹含片段（改措辞即新债）+ 路径归一；CSV 逗号转义；FIXME 必须 P0                |
| `check-type-coverage`           | 139  | 6    | `recursive=false` 只收一层（模块档关掉会虚高到 100%）；排除 `.test-d.ts`         |
| `check-exports-docs`            | 374  | 25   | 六类问题互不遮蔽；核心入口必填 Key Exports；`export *` 不传 `default`            |
| `check-sdk-contract-alignment`  | 1755 | 46   | 版本段归一；`VendorPrefix` 必须解析；不等长对齐**尾缀**；`{}` 不算通配段         |
| `check-docs-examples`           | 250  | 18   | 只有带 title 的围栏参与编译；title 取 basename；下限必须**等于**实际抽取数       |
| `check-entrypoint-layering`     | 230  | 21   | `export *` 不传 `default`；`as` 取别名；只认再导出来源；真实 `core.ts` 不泄漏    |

**顺带修掉 10 处"无条件 `main()` / 顶层裸跑"**：`check-coverage-critical-files`、
`check-msc-changes`、`check-vendor-prefix-migration`、`check-contract-provenance`、
`scan-technical-debt`、`check-type-coverage`、`check-exports-docs`、`check-sdk-contract-alignment`、
`check-docs-examples`、`check-entrypoint-layering` —— 它们 import 时会跑全仓扫描、抽示例跑 tsc
或读 `git diff`，且有违规时 `process.exit(1)` 会让 spec 以"莫名其妙的红"失败。
CLI 行为均经 gate-golden 对拍**逐字节一致**。

⚠️ 侦察入口形态时**不能** grep `import.meta.url`（`fileURLToPath(import.meta.url)`
会误命中），只能看文件末尾是不是 `main();` 裸调用。

**最后 4 个**本轮全部啃完，难度各异：

- `check-sdk-contract-alignment`（1755，全仓最大）：顶层 ~280 行裸跑逻辑，用 Python 脚本
  机械包进 `main()` 再对拍，避免手抄出错；导出判定链上 20 个纯函数。
- `check-exports-docs`（374）：顶层 `readFileSync` + `process.exit(1)`。
- `check-docs-examples`（250）：判定埋在读文件/写文件副作用里，拆出 `parseBlocks` /
  `planGenerated` / `buildTsconfig` 三个纯函数才测得动。
- `check-entrypoint-layering`（230）：整个判定是一段顶层 `try` 块，且四处都是
  「遍历到第一个就 `throw`」—— 改成「先算出全部违规、再 `throw`」后违规集合才可测。

⚠️ **变异自证本身也会"纸面通过"**：给 `entrypoint-layering` 的第一版变异是把
`\{[^}]*\}\s+from` 放宽成 `\{[^}]*\}\s*(?:from)?`，跑出来**一条用例都没红**——
因为正则后半段仍要求双引号，`export { a, b };` 照样不匹配。换成正真能触发的
变异（放宽到 `export const a = 1;` 也匹配）才拿到 2 条红。
**教训：变异后必须确认 spec 转红；没转红先怀疑变异无效，而不是假设断言有效。**

**剩余口径（按「spec 是否真 import / 真跑这个脚本」重算，见 §7.15-10）**：
**判定类门禁 0 个未覆盖**；剩下 6 个全是报告生成器 / 查询器 / runner / 诊断工具
（`generate-coverage-report`、`debt-weekly-report`、`find-lowest-coverage-files`、
`find-lowest-coverage-modules`、`run-granular-coverage-gates`、`probe-contract-drift`），
它们没有"红/绿"判定，价值在产物而非断言。

⚠️ 上一版这里写"判定类仅剩 3 个"是**配对口径的误判**：按 spec 文件名配对会把
`codegen-coverage-gate.spec.ts`（其实测的就是 `check-manager-codegen-coverage`）、
`generated-dto-quality.spec.ts`（动态 `import()` 真模块）、
`contract-freshness.spec.ts`（`execFileSync` 端到端跑真脚本）都算成"没覆盖"。
**判"有没有覆盖"要看 spec 真不真跑这个脚本，不是看文件名像不像。** 见 §7.15-10。

#### 7.15-8 `quality:report` 240s 超时：根因是「静默重跑两遍全量 vitest」

§7.14/§7.15 一直记为"未定位"。根因与后端无关（`https://matrix.test/health` 返回 200 也照旧）：

1. `coverage/lcov.info` 不存在时，`collectCoverageMetrics()` 会**静默**跑一次
   `npx vitest run --coverage`（`silent=true`，输出全吞）；
2. `collectTestStats()` 紧接着**又跑一遍**全量 vitest（`--reporter=json`）——
   同一批测试跑两次，实测合计 **11 分 14 秒**。输出被吞掉后，从外面看就是
   "脚本卡住不动"，直到 CI/沙箱的 240s 上限把它杀掉；
3. 更糟的是跑完**也未必产出 lcov**：沙箱里 `V8CoverageProvider.clean` 要删 775 个
   coverage 文件，撞上每回合删除上限，vitest 启动即崩 —— 于是下一轮照旧白跑；
4. 附带隐患：`collectTestStats` 那轨的 stdout 达 **21.7MB**，逼近 `execSync` 默认
   20MB `maxBuffer`（今天是没超，加一个 reporter 就会 ENOBUFS）。

**修法**：默认只读产物 —— 缺 lcov 就把"该跑的那条命令"直接打印出来并跳过该轨，
把决定权交回调用方；确实要自跑用 `--run-tests`（且不再 silent）。
修后同场景 **16.5s**（lcov 存在）/ 秒级（缺失）。

这个坑的形态值得记：**"慢"和"卡住"在门禁里长得一模一样**，而根因常常是
"某条静默路径在替调用方做一件很贵的事"。判据：凡 `runCommand(..., silent=true)`
且命令里带 `vitest`/`tsc`，都要问一句"它凭什么替我决定要跑这个"。

#### 7.15-9 纸面 spec：`verify-path-contract` 抄了一份常量副本自己测自己

重算"哪些脚本真被 spec 覆盖"时才发现：**有 spec 不等于有覆盖**。
`spec/unit/scripts/quality/verify-path-contract.spec.ts`（210 行）文件头就写着
「独立实现，避免 import ESM 脚本导致加载慢」——它**连门禁都没 import**，
把一个常量表抄进 spec 再测那个副本。副本一路漂移：

| 项                  | spec 副本                              | 门禁真值               |
| ------------------- | -------------------------------------- | ---------------------- |
| `AdminPrefix.V1`    | `/_matrix/admin/v1`                    | `/_synapse/admin/v1`   |
| `VendorPrefix`      | `/_matrix/vendor`                      | `/_matrix/vendor/v1`   |
| `ClientPrefix` 成员 | 多出 `Media`/`MediaV3`/`MediaUnstable` | 无这三项               |
| `PushRulePrefix`    | 有                                     | 门禁表里根本没有这个组 |

于是它**绿着，但门禁改了它不红、抄错了它也不红**。更讽刺的是门禁文件头写着
「改动 `prefix.ts` 时必须同步改这里 —— **单元测试会校验两者一致**」，
而这份 spec 恰恰兑现不了这个承诺（它校验的是自己抄的那份）。

**根因**：门禁顶层就去读兄弟仓 ledger（`../synapse-rust/...`），读不到直接
`process.exit(2)` —— import 即退出，spec 除了抄副本别无他法。
所以这不只是"写 spec 的人偷懒"，而是**门禁形态逼出来的**：
凡是顶层有 `process.exit` 的门禁，都天然排斥被测试，只能养出副本 spec。

**处置**：`ledger` 加载抽成 `loadBackendRoutes()`，顶层 ~390 行执行逻辑用脚本
机械包进 `main()` + 双模式入口，导出 12 个纯函数；新 spec（28 例）改为 import 真模块，
并把那条空头承诺兑现——**解析 `src/http-api/prefix.ts` 与门禁常量表双向比对**。
变异自证 4 处全部转红（`AdminPrefix` 改成副本错值 / `wildcard` 放宽掉 `includes(".")` /
三元只取一条腿 / 模板字面量要求反引号）。

**判据（可复用的侦察法）**：查"这个脚本有没有被覆盖"要看 spec **真不真跑它**
（`import "...x.mjs"`、`import()` 或 `execFileSync` 跑脚本），不是看文件名像不像。
按文件名配对会把 `codegen-coverage-gate.spec.ts`（真测 `check-manager-codegen-coverage`）、
`generated-dto-quality.spec.ts`（动态 `import()`）、`contract-freshness.spec.ts`
（`execFileSync` 端到端跑真脚本）全部误判成"没覆盖"。

#### 7.15-10 仍未做（其它）

- **P9**：`npx eslint <多文件>` 在本机沙箱 SIGTERM(137)，只能后台跑；属环境问题。
- **`check-cross-repo-pin`**、4 条豁免、2 条 keep-manual 孤岛：**按设计如此**，记录不修。
- 两处已知小缺陷**故意未修**（已在对应 spec 里钉住现状，改它们属判定类改动）：
  `summarizeLcov` 末尾段缺 `end_of_record` 时 `fileCount` 漏计 1（只影响日志）；
  `collectTypeScriptFiles` 传入不存在目录抛 ENOENT（调用方已先 filter）。
- **`quality:coverage:critical` 三模块不达标**：`admin` 69.00 < 70、`push` 77.14 < 89、
  `space` 75.71 < 77。**已于 2026-10-07 闭环**（删重复别名方法 + 补测，三模块均达 100%），
  见 §7.15-12。

#### 7.15-11 全仓复检三轮：共享库层的两个零 spec（2026-10-07）

判定类门禁已 0 个未覆盖之后，把判据下沉一层看 **共享库**：`scripts/quality/lib/` 下
3 个模块里 **2 个零 spec**，而它们的注释恰恰记着本仓踩过的坑。

| 库                      | 行数 | 被谁依赖                                       | 补的例数 |
| ----------------------- | ---- | ---------------------------------------------- | -------- |
| `stable-id.mjs`         | 75   | 所有 baseline 机制（α 缺陷的正解实现）         | 18       |
| `spec-import-graph.mjs` | 151  | `find-lowest-coverage-{files,modules}`         | 28       |
| `granular-coverage.mjs` | 187  | 18 个 `check-*-granular-coverage`（已有 spec） | —        |

**`stable-id.mjs` 钉住的四件事**（每条都做了变异自证）：

- 维度连接符必须是 NUL。若用 `|`，`["b|c"]` 与 `["b","c"]` 拼成同一个串 ⇒ **维度边界丢失**，
  两条不同条目撞成一个 id：修掉一条，另一条被当成"已修复"。这是选 NUL 的唯一理由。
- `digest` 定长 16：baseline 是可读文本，长度变了等于全量重写。
- `nextOrdinal` 不折叠：复制粘贴的第二份缺陷要有自己的序数，否则删第一份时它会被当已修复。
- `normalizeSnippet` 折叠空白：prettier 重排不该让指纹漂移 —— 这是 α 不复发的前提。

**`spec-import-graph.mjs`**：头部注释记的四个历史坑全部转成断言 ——
`walk` 用 `endsWith` 而非 `path.extname`（后者让 `[".spec.ts"]` 恒为空，即
「471 源文件 / 0 测试文件」的根因）；`collectSourceFiles` 必须排除 src 下的 spec
（含 `__generated__` 生成的）；`collectAllSpecFiles` 必须带上 in-src spec；
模块名与 spec 名不同（`three-pids` ← `threepids`）只能靠 import 图认出。

##### ⚠️ 变异自证的新坑：同一处代码不要同时施加两个变异

10 处变异里有 2 处第一次没抓到，都**不是断言无效，而是变异本身的问题**：

- **M10 被 M9 遮蔽**。两者改在 `buildSpecImportSet` 同一段：M9 删掉了 variants 的第三个
  元素（`.js` → `.ts` 映射），于是 M10 想让"仓外目标入库"的那个目标**根本解析不出来**，
  断言无从失败。日志里只打印了 2 个 variant 而不是 3 个才看出来。分开跑立刻拿到红。
- **M1 构造错了**：最初拿 `filePath` 不同的两组比，而 id 本身是 `filePath#digest`，
  恒不等。真正的撞车是维度边界丢失 —— 得让 `filePath` 相同、只变维度切分。

**判据**：变异后必须确认 spec 转红；没转红先怀疑变异（无效 / 被遮蔽 / 构造错），
而不是假设断言有效。这是继上一轮「变异本身纸面通过」之后的第二类。

##### ⚠️ 不要在门禁扫描运行时施加变异

本轮全量扫描在后台跑的同时施加了 `stable-id` 的 4 处变异，结果
`quality:contracts` 报红 67 条。还原后重跑是 **exit 0，`generated-dto-strictness`
`current: 67, new: 0`** —— 那 67 条全是变异造出来的假红：改掉 SEPARATOR / digest 长度 /
ordinal 后，**全仓 baseline 指纹集体失效**，任何 baseline 类门禁都会整批假红。

**判据**：`lib/` 是共享层，动它等于同时动所有依赖方。变异自证期间不要相信任何并发中的
全量扫描结果；扫完再改、或改完再扫。

##### `quality:coverage:critical` 的红：口径假说被证伪，floor 本身偏高

`critical-modules.json` 的 note 说 floor 来自「各模块自身 spec 的**定向**覆盖率」，
并注明"可能低于全仓覆盖率"，而门禁读的是**全仓 lcov**。怀疑是口径不一致造成系统性假红，
于是按 note 描述的方式定向重测（产物写 `/tmp`，不污染工作区）：

| 模块        | floor | 定向实测  | 全仓 lcov | 与 floor 差 |
| ----------- | ----- | --------- | --------- | ----------- |
| `src/admin` | 70    | 69.00     | 69.00     | −1.00       |
| `src/push`  | 89    | **74.28** | 77.14     | **−11.86**  |
| `src/space` | 77    | 75.71     | 75.71     | −1.29       |

**假说被证伪**：两个口径对这三个模块几乎一致（push 的全仓值反而更高，正合 note 所说
"跨模块 import 会顺带覆盖"）。所以红的原因是 **floor 本身高于任何口径下的实测**，
其中 `push` 的 floor 89 自 2026-09-13 设定后从未调整，与实测差 12–15 个百分点。

三个走向均需人决策，**未擅自改动**：① 补测试把 push 提到 89（工程量最大）；
② 按实测下调 floor（违反棘轮纪律，需提交信息说明理由）；③ 维持红灯并登记为已知债。
另注：CI 里 `quality:coverage:critical` 读的是同 job 内 `pnpm test --coverage` 的 lcov，
与本地缓存 lcov 未必同值，**本地红不等于 CI 红**，判断前需取 CI 实测值。

#### 7.15-12 覆盖率三模块红的闭环：删掉「为凑审计报告而生的代码」+ 补真实缺测（2026-10-07）

##### 根因不是口径差，是**为新代码写了 89.01 → 74.28 的真实回归**

先按 §7.15-11 的线索往下挖 `push`：它在 2026-09-13 被实测为 **89.01%**（那次提交信息
里有记录），floor 89 就是照它设的。此后 `src/push/index.ts` 净增 74 行，而 **push 的
spec 一行没动** —— 典型的新代码没配测试。

那 74 行是什么？`getPushersWithTrailingSlash` 与 `createPusher`，JSDoc 自述：

```
Note: 此方法与 getPushers() 功能相同，仅为了完整覆盖后端路由
```

**零调用方**（src/ 与 spec/ 全无引用），与 `getPushers` / `setPusher` 逐字节等价。
来源是 2026-09-29 的提交：`scripts/audit/compare-routes.mjs` 生成的「SDK 契约缺口报告」
显示后端路由 1147 → 1166，于是往 SDK 里塞别名方法让报告变绿。

**但 `/pushers` 与 `/pushers/`（尾斜杠）、`/pushers` 与 `/pushers/set`（新旧规范路径）
在 Matrix 规范里是同一端点** —— SDK 封装面本来就该按**业务能力**对齐，而不是按路由
字面量一一对应。加方法的收益是零：删掉后重跑缺口报告，实现面覆盖**反而上升**
（678/758 = 89.4% → **689/758 = 90.9%**，缺口 70 → 68）。

⇒ **「审计工具要求什么，就往产品代码里加什么」是比覆盖率更值得警惕的病**：
它同时劣化三个指标 —— 维护面、覆盖率分母、以及审计本身的信号（报告变绿并不代表
能力变全）。判据：**新加的方法若拿不出调用方，先问它服务的是产品还是工具。**

##### 处理

| 动作                                            | 结果                                                         |
| ----------------------------------------------- | ------------------------------------------------------------ |
| 删 `getPushersWithTrailingSlash`/`createPusher` | push/index.ts 749 → 678 行；覆盖率 74.28% → 85.71%           |
| 补 `push-coverage-gaps.spec.ts`（21 例）        | 覆盖 8 处 catch 分支、缓存命中、房间规则读写、start() 并发   |
| 补 `admin-space-lifecycle.spec.ts`（9 例）      | 两个 `stop()`、`getMetrics/clearCache/start`、20+ 便捷访问器 |

定向覆盖率（与全仓同样的 LF）：**push 74.28 → 100%、admin 69.00 → 100%、space 75.71 → 100%**。

顺带发现两处「有 spec 但等于没测」：

- `admin.spec.ts` 里那个 `describe("extendMatrixClient")` **从未真正调用**
  `extendMatrixClient()`，只断言了「类能导出」—— 挂原型那 30 条语句一条都没执行过。
- push 的 8 处 `catch`（emit `PushError` + 规范化重抛）**一条都没测**。

##### 端到端验证（以及验证方法本身踩的坑）

`check-critical-coverage.mjs` 接受 lcov 路径参数，于是可以离线验证而不必重跑 77 分钟的全仓。
**第一次尝试就制造了假红**：拿「定向 lcov」（只跑各模块自己的 spec）冒充全仓 lcov，
结果 auth 78.23 < 87、event 89.57 < 99、room 82.45 < 92 三个模块被判失败 ——
它们的代码与测试本轮**一行未动**，全仓口径下是达标的（87.90 / 99.13 / 92.82）。

⇒ **定向跑只给下界**（缺跨模块 import 的顺带覆盖）。用它当全仓数据，会把
「定向缺失」误报成「覆盖率不足」。**判据**：比对前先确认两边的 **LF（可执行行数）
一致** —— 一致才说明统计的是同一组行，差异只在 LH。

改用「3 个模块取新测数据 + 其余 5 个取原全仓数据」的混合 lcov（`LH = LF` 的 100%
是无歧义的），门禁给出：

```
[critical-coverage] 8 critical module(s) meet their ratchet floor (target=90%)   exit 0
```

##### 附带订正：`critical-modules.json` 的 `measuredBy` 与事实不符

该字段自称 floor 是「各模块自身 spec 的定向覆盖率」，并附注「可能低于全仓覆盖率」。
实测证伪：auth 定向 78.23 而 floor 87、event 定向 89.57 而 floor 99，而 floor 与
**全仓 lcov 逐位吻合**（87.90 / 99.13）；2026-09-13 设定 floor 那次提交信息里记的
实测值也是全仓口径。

**这条错误描述正是 §7.15-11「口径差」假说的由来** —— 它把「定向低于全仓」说成常态，
于是真实的回归（push 89.01 → 74.28）被解释成口径差异而放过。已订正注释，
**floorPercent 一条未动**。

#### 7.15-13 事后审查：新写的 spec 也必须变异自证（2026-10-07）

以代码审查视角回头复核 §7.15-12 那 30 例，第一个发现是**我自己跳过了自己反复强调的
变异自证** —— 门禁 spec 每个都做，轮到"补覆盖率"的 spec 就省了。补做 9 个变异
（A1/S1/S2/S3/P1..P6）：

```
8 个转红，1 个没抓到：P5「removeKeywordHighlight 丢掉参数校验」→ 断言仍绿。
```

##### 这是**第四类**失效：不是变异的问题，是**断言强度不足**

前几轮记过三类（变异无效 / 变异被遮蔽 / 变异构造错），都出在变异侧。这一条出在断言侧：

```ts
await expect(pushManager.removeKeywordHighlight("")).rejects.toThrow(InvalidParamError);
```

四个快捷方法（`addKeywordHighlight` / `removeKeywordHighlight` / `ignoreSender` /
`unignoreSender`）内部转发给 `createPushRule` / `deletePushRule`，而**后者自己也校验**
`!scope || !kind || !ruleId`。于是删掉本层校验后，下游照旧抛 `InvalidParamError` ——
断言无法区分「本层拦下」与「被下游兜住」。**等价于没测**。

**判据**：`rejects.toThrow(Type)` 在同一个异常类型能从**多个层次**产生时就失效，
必须断言**具体错误消息**：

```ts
await expect(pushManager.removeKeywordHighlight("")).rejects.toThrow("keyword is required");
```

改完这 9 个变异**全部转红**（9 failed / 21 passed），还原后 30 passed。

**推广**：凡断言"应该抛某个异常"，先问一句 **「如果把这一层的检查删掉，还有谁能抛出
同一种异常？」** 有别人能兜住，就必须断言消息或断言副作用（如"没有发出请求"），
否则这条断言测的是下游而不是它自称测的那一层。

##### 顺带：命名要经得起误读

`push-coverage-gaps.spec.ts` 这个文件名诞生于覆盖率治理，但里面每一条都是**行为断言**。
已在文件头写明"覆盖率只是副产品，一条测试该不该留看的是把实现改坏它会不会红" ——
免得后人把它当"为凑数而写"的文件整包删掉。

#### 7.15-14 全仓排查第五轮：**静态存在 ≠ 运行时可执行**（2026-10-07）

前几轮的判据都在"源码里有没有这段东西"这一层。这轮往下走一步：**那段东西有没有被执行到**。

##### 排查路径

1. **全量实跑 quality:\***（第 4 轮）：只剩 2 个已知红（`coverage` 本地 lcov 旧、
   `cross-repo-pin` 按设计）。`quality:report` 已从 240s → **10s**。
2. **静态排查**：`.only/.skip` 仅 1 处（集成测试合法用法）、TODO/FIXME 仅 1 处（URL 占位符）、
   `__generated__` 之外只有 2 处真 `any`，且 `@ts-ignore` 已全部升级为**带说明的
   `@ts-expect-error`** —— 类型纪律是好的。
3. **发现 knip 红**：CI 的 `static_analysis.yml` → `analyse_dead_code` job 只做
   `pnpm install` + `pnpm lint:knip`，**是阻断性**的；而它当时 exit 1。修掉两处后转绿。

##### 核心判据：类型表声明 vs 运行时挂载

`matrix-client-extensions.ts` 的 `interface MatrixClientExtensionMethods` 会把方法**合并**进
`MatrixClient` 接口 ⇒ 类型检查永远通过。但方法真正可用，取决于对应模块的
`extendMatrixClient()` 有没有被 `manager-extensions/index.ts` **动态 import 执行到**。

这两个集合不同步，就是本仓反复踩过的坑 —— `knip.ts` 里 worker / room-alias 条目下的原话：

> 此前 client.getWorkerManager() / getRoomAliasManager() 在运行时是 undefined，调用即 TypeError

**静态扫描查不出**：源码里 `MatrixClient.prototype.getXxxManager = ...` 那行**确实存在**，
只是那份代码从没被执行到。所以写了个运行时探针：真实执行
`extendMatrixClientWithManagers({ includeAll: true })`，再逐个 `typeof proto[name] === "function"`。

实测（修复前）：

| 组                                | 数量 | 含义                                                         |
| --------------------------------- | ---- | ------------------------------------------------------------ |
| `get*Manager` 声明                | 113  | 类型表承诺的 manager 访问器                                  |
| └ 运行时缺失                      | 1    | `getAdminExternalServiceManager`（admin 忘了挂）             |
| └ 未接线（`includeAll` 也不加载） | 25   | MODULE_DEFS 未登记的模块（knip.ts 注释为 pending migration） |
| 非 manager 的历史残留声明         | 21   | 上游 API，实现已移到各 Manager ⇒ 全部运行时不存在            |

**46 个方法：类型检查通过、调用即 TypeError。**

##### 处理

| 项                                                    | 动作                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `getAdminExternalServiceManager`（单独的遗漏）        | **已修**（补挂载）→ 113/113 对齐                                       |
| `StripAdminPath` 死导出 / `@octokit/rest` 过时 ignore | **已修** → `knip` exit 0（CI 那个 job 恢复绿）                         |
| 25 + 21 处                                            | 登记台账 `manager-accessor-wiring-baseline.json` + **运行时守卫 spec** |

守卫 `spec/unit/manager-accessor-wiring.spec.ts`（5 例，1.6s）：把两组缺失集合与台账做
**集合相等**断言（多一个少一个都红），并单独守住「已知 4 处内部调用点」。
变异自证 3/3 转红：删挂载（抓忘记接线）、台账塞假条目（抓注水）、改调用点（守删声明的前置条件）。

##### 教训：与 §7.15-9「有 spec ≠ 有覆盖」同构

| 轮次     | 形似                                  | 神不至                                    |
| -------- | ------------------------------------- | ----------------------------------------- |
| §7.15-9  | spec 文件存在                         | 它没 import 被测对象，抄了份副本自测      |
| §7.15-14 | `MatrixClient.prototype.X = ...` 存在 | 那行代码从没被执行到 ⇒ 运行时仍 undefined |

**判据**：凡"声明/登记/接线"这类**两处必须同步**的结构，都要问一句
**「第二处是在运行时真的生效，还是只是写在源码里？」** 静态存在性检查对后者完全失明。

##### 顺带记两条治理问题（未擅自改）

- **`knip.ts` 的 entry 列表有 ~160 条**，其中大量条目注释着 "older modules pending migration"、
  "knip can't trace external usage"。把文件标成 entry 就等于豁免它的全部导出 ——
  **这是拿配置去迎合工具**，代价是这批模块的真实问题再也报不出来（本次 46 处正是藏在这里）。
  与 §7.15-12 那个「为凑审计报告而生」的别名方法同源：**别让工具的需求反过来塑造产品代码**。
- **`lint:knip` 不在本地 `pnpm lint` 的 14 步链里**，只挂在 CI 的独立 job。
  于是这两条红在本地开发时不可见 —— 建议要么并入 `lint`，要么在贡献文档里显式标注。

#### 7.15-15 测幂等函数前，先确认它真的执行了（2026-10-07）

§7.15-14 的守卫 spec 第一版直接调 `extendMatrixClientWithManagers({ includeAll: true })`，
据此报告「25 个模块未接线」。**这个结论是错的 —— 测量方法本身失效。**

**机理**：`spec/setupTests.ts` 的全局 `beforeAll` 已经用 `{ includeDm: false }` 初始化过一次，
而该函数是**幂等**的：

```ts
if (isInitialized) return; // ← 后续任何 options 都被静默忽略
```

于是在 spec 里再调 `{ includeAll: true }` **等于什么都没做** —— 测到的只是 setup 那次加载的
默认集合，"不在默认集合里"被误读成"模块没接线"。

**怎么发现的**：探针里 `onManagerExtensionsLifecycle` 注册的监听器**一个事件都没收到**。
初始化根本没跑。这个静默忽略**没有任何报错**，只靠"我注册的回调为什么没被调用"
这个异常信号才抓到。

**判据**：调用带幂等短路的函数前，先确认**没被短路** —— 打印状态
（`isManagerExtensionsInitialized()`）、注册可观测的副作用（lifecycle 回调）、
或在需要时显式 `reset`。**「我调用了」≠「它执行了」。**

**修正后**：

- `getDirectMessageManager` 其实是接线的（台账误登记）⇒ 移除。
- **`getSamlAuthManager` 是真 bug**：`MODULE_DEFS` 里 saml 标着 `standalone: false`，
  生成器因而不产出它的 import 块，而它也不在任何 `adminExtras` 里 ⇒ **saml 模块从不被加载**，
  `client.getSamlAuthManager()` 永远 undefined（类型表却声明了它）。改回默认后已生成
  `import("../saml/index.js")`。

**三连同构 —— 都是「形似而神不至」**：

| 轮次         | 形似                                  | 神不至                           |
| ------------ | ------------------------------------- | -------------------------------- |
| §7.15-9      | spec 文件存在                         | 它没 import 被测对象，抄副本自测 |
| §7.15-14     | `MatrixClient.prototype.X = ...` 存在 | 那行代码从没被执行到             |
| **§7.15-15** | **调用语句存在**                      | **被幂等短路，静默不执行**       |

**推广**：凡是"看起来做了"的检查动作，都要问一句 **「有可观测的证据证明它真的做了吗？」**
—— 而不是"我写了这行代码，所以它做了"。

#### 7.15-16 判据漏了一半，以及「接线治不了空壳」（2026-10-07）

##### 漏掉的那一半：`MatrixClientInternalMethods`

§7.15-14 只查了 `interface MatrixClientExtensionMethods`（21 个运行时不存在）。这轮把
**`MatrixClientInternalMethods` 也纳入** —— 它注释自称"MatrixClient 类中已实现但未在主接口中
声明的属性和方法"，实际**另有 74 个并没有实现**。合计 **95 个方法「类型检查通过、运行时 TypeError」**。

拿这 95 个去扫调用点，得到 **43 处 `this.client.X(...)` 转发，集中在 10 个模块**。

##### 新一类：空壳模块（`emptyShellModules`）

这 10 个模块自己的方法只是 `return this.client.<不存在的方法>(...)`：

```ts
public async abortAllUploads(): void {
    return this.client.abortAllUploads();   // ← MatrixClient 上根本没有这个方法
}
```

⇒ `client.getUploadsManager().abortAllUploads()` **一调用就 TypeError**。

**关键：接线治不了它。** 接线只让 prototype 上多一个函数，函数体第一行转发就炸。
这与 `notOnMatrixClient` 是**两个层次**的问题：

| 组                  | 问的是                 | 数量 |
| ------------------- | ---------------------- | ---- |
| `pendingWiring`     | 模块能不能被**加载**   | 2    |
| `notOnMatrixClient` | 类型表**声明**得多不多 | 21   |
| `emptyShellModules` | 加载后方法能不能**用** | 10   |

##### 对自己上一轮动作的修正

§7.15-15 接线的 21 个模块里，**13 个干净、8 个其实是空壳**（invites / lifecycle /
push-notifications / room-creation / room-events / sessions / sync-accumulator / uploads）。

**决定保留接线**：加载本身是对的、类型表也确实声明了这些访问器；空壳是**独立的一层病**，
应该单独登记治理 —— 而不是靠回退接线把它重新藏回"undefined"里（那只是让症状更早出现，
并没有让问题更少）。

##### 守卫扩展

- 台账新增 `groups.emptyShellModules`（10 个模块，**只能减少**）。
- spec 5 → 7 例：新增「空壳集合 == 台账」，外加一条**判据自检**
  （若 `collectMissingClientMethods()` 因正则/边界失效返回空数组，那条断言会在空集上空转、
  永远通过 —— 自检专门拦它）。
- 变异自证 2/2 分开跑均转红：往干净模块插一行 bad call ⇒ 10 vs 9；台账塞假模块 ⇒ 红。

##### 四连同构

| 轮次         | 形似                     | 神不至                         |
| ------------ | ------------------------ | ------------------------------ |
| §7.15-9      | spec 文件存在            | 没 import 被测对象             |
| §7.15-14     | `prototype.X = ...` 存在 | 那行代码从没被执行             |
| §7.15-15     | 调用语句存在             | 被幂等短路，静默不执行         |
| **§7.15-16** | **模块存在、也能被加载** | **内部转发到一个不存在的东西** |

**共同点**：**每一层都"看起来完整"，断链都在下一层。** 所以判据要一层层往下验证到
**可观测的行为**为止，而不是停在"我看到了这段代码/这个文件/这次调用"。

#### 7.15-17 空壳收口（第一批）：31 处转发改走真实能力 + 20 处假声明删除（2026-10-07）

§7.15-16 把问题分成三层（模块能否加载 / 类型声明多不多 / 加载后能否用）。本节收口**第三层**。

**已收口 7 个模块**

| 模块               | 改  | 去处                                                                                                        |
| ------------------ | --- | ----------------------------------------------------------------------------------------------------------- |
| push-rules         | 5   | 全部委托 `PushManager`（推送规则的唯一实现）；统一双份 `IPushRule` DTO                                      |
| room-events        | 6   | 5 处走 `Room`（`getLiveTimeline()` / `findEventById()` / `currentState.events`），1 处走 `EphemeralManager` |
| invites            | 5+1 | `invite` / `joinRoom` / `leaveRoomChain` / `getRooms` + 成员态；**另修一处活 bug**                          |
| push-notifications | 4   | 3 处委托 `PushManager`；`getPusherData` **删除**（规范里无此能力）                                          |
| room-creation      | 4   | `createRoom` + `invite`/`is_direct`；选项模板改**模块内自持**                                               |
| uploads            | 3   | `uploadContent` / `getCurrentUploads`+`cancelUpload`；`getUploadProgress` **删除**（无 uploadId 概念）      |
| lifecycle          | 4   | **全部删除**（协议没有"退出/终止/重置客户端"）                                                              |

**三个值得单独记的洞**

1. **`invites.inviteByThreePid` 是活 bug**：实现用 `as unknown as { inviteByThreePid:
(medium, address, roomId) => … }` 按 `(medium, address, roomId)` 传参，真实签名是
   `(roomId, medium, address)`（`src/client.ts:2908`）⇒ **运行时 medium 被当成 roomId 发出去**。
   而类型表注释（`matrix-client-extensions.ts:704-707`）**早就承认**了这处不一致，
   旧 spec 还把错误顺序断言成期望值 —— 三重掩盖：双重断言 + 注释承认而不修 + 断言固化错误。
2. **旧 spec 的"假绿"机制**：这些模块的 spec 全部把"运行时不存在的方法"`vi.fn()` 到
   mockClient 上，于是"转发到不存在的东西"永远测不出来。新 spec 的 mockClient
   **故意不提供**那些方法 —— 实现若回退，立刻 TypeError 而非"通过"。
3. **测试构造也会失效**：`mockClient.getAccountData = () => …` 直接赋普通函数会**换掉 spy**，
   后续 `toHaveBeenCalledWith` 以 "[Function] is not a spy" 失败。要用 `mockReturnValue`。

**结构性收获：删声明让"转发到不存在"变成编译错误**

`matrix-client-extensions.ts` 里有一批 MatrixClient **从未实现**的方法声明（上游 API 的表面，
能力已移进各 Manager）。本节删了 20 条（push 7 + pusher 4 + invite 5 + lifecycle 4）。
效果是**根治**：任何"转发到不存在方法"的写法从此**直接编译失败**，不必等运行时撞到。

**"改名实验"：用编译器拿完备清单（本节最有价值的一步）**

把剩余假声明**临时改名**（`getRoomName` → `__DEAD__getRoomName`）后跑 `tsc`，
报错 **25 条，全部落在已知位置**：

```
src/device-keys(3)  src/lifecycle(4)  src/room-creation(4)  src/sessions(6)
src/sync-accumulator(3)  spec/test-utils/client.ts(2)
```

⇒ ① 没有任何**模块外**的生产代码依赖这些假声明；② 手工 grep 会漏，用编译器扫才完备。
（实验后已从副本恢复，工作区零残留。）

**实验同时暴露了我自己判据的一个缺陷**：改名正则写成 `(name)(\s*[(:<])`，而 `x?: T`
这种**可选属性**里 `?` 在 `:` 之前 ⇒ 不匹配 ⇒ 漏计（"79"偏低，实际 84 处被改名）。
**登记规则：查声明时 `x?: T` 与 `x: T` 必须一并纳入。**

**剩余 3 个模块 / 12 处（待决策，本轮未动）**

| 模块             | 处  | 判定                                                                                                                                                                                  |
| ---------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| device-keys      | 3   | `getDeviceKeys` 与既有 `getUserDevices` **重复**（删）；`uploadDeviceKeys` → `client.uploadKeysRequest`（可映射）；`hasDevice` → `deviceManager.getCachedDevice() !== null`（可映射） |
| sessions         | 6   | Matrix 规范**没有 session 概念**（只有 device）⇒ 要么映射到 `DeviceManager`（语义混用风险），要么整模块删除                                                                           |
| sync-accumulator | 5   | `client.syncAccumulator` **不存在** ⇒ `get/setSyncAccumulator` 也是坏的（永远返回 null）。要么改为模块内自持 `SyncAccumulator` 实例，要么删                                           |

**为什么停在这里**：这三处属"语义映射 vs 删除模块"的架构选择 —— 前者可能造出像
`inviteByThreePid` 那样的**语义错位**，后者动公开模块。留给下一次决策。

**台账同步（守卫 spec 由红转绿）**：`notOnMatrixClient` 21 → 16、`emptyShellModules` 10 → **3**、
`pendingWiring` 2 → 2。守卫 spec 的 3 条台账断言本轮**转红**，这正是它该做的事：模块修好了，
账必须改。反向断言那一条还额外暴露了一个坑 —— `push-rules` 的**说明注释**里引用了原写法，
被 needle 命中 ⇒ **先剥注释再断言**（与「注释里写路径即算可达」是同一坑的镜像）。

#### 7.15-18 空壳收口第二批：**空壳模块归零**（2026-10-07）

§7.15-17 列的剩余 12 处，本轮 8 修 + 4 删 + 6 删（整模块）：

| 模块             | 处  | 处置                                                                                                                                        |
| ---------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| device-keys      | 3   | `getDeviceKeys` 与既有 `getUserDevices` **重复** ⇒ 删；`uploadDeviceKeys` → `uploadKeysRequest`；`hasDevice` → `getCachedDevice() !== null` |
| sync-accumulator | 5   | `client.syncAccumulator` **属性不存在**（get 恒 null / set 静默丢弃）⇒ 改为**模块内自持** `SyncAccumulator` 实例                            |
| sessions         | 6   | **整个模块删除**（理由见下）                                                                                                                |

**结果：`emptyShellModules` 10 → 0** —— §7.15-16 提出的那一类**清完**。

**为什么 sessions 是删而不是修**

- `ISessionInfo.accessToken` / `refreshToken` 是**客户端凭据**，本 fork 无从从"会话列表"提供；
- `refreshSession()` 的**无参**版本在 Matrix 里不可实现（`POST /refresh` 必须带 refresh_token）；
- `revokeSession(deviceId)` 虽有对应，但那是 **device** 不是 session；
- `get/setLastActiveSession` 无规范依据。

**Matrix 规范里没有 session 概念，只有 device。** 硬映射会造出 `inviteByThreePid` 那类
语义错位；而 `DeviceManager` 已完整覆盖（`getDevices` / `getCurrentDevice` / `deleteDevice`）。
零消费者、不在 `package.json` exports ⇒ 删除是净改善。

**两个新发现**

1. **同名 spec ≠ 覆盖**（又一次，与 §7.15-9「纸面 spec」同源）：
   `spec/unit/sync-accumulator.spec.ts` 测的是上游 `SyncAccumulator` **类**，
   而 `SyncAccumulatorManager` 的 5 个方法**零覆盖**。已新写
   `spec/unit/sync-accumulator-manager.spec.ts`（5 例，mockClient 是**空对象**）。
2. **弱断言的新形态：只断言返回值、不断言入参形状**。`uploadDeviceKeys` 的变异
   （少包一层 `device_keys`）**第一次没红** —— mock 无论收到什么入参都返回同一个对象。
   补 `toHaveBeenCalledWith({ device_keys: keys })` 后转红。
   **凡"转发型"方法，必须同时断言「落到哪个方法」与「入参形状」。**

**改名实验（第二轮）与它的副产品**

把剩余假声明重新改名后跑 tsc：**报错 2 条，全在 `spec/test-utils/client.ts`**
⇒ **生产代码已零依赖**。那 2 处已修，且查实 `mockClientMethodsUser` /
`mockClientMethodsServer` 在 `spec/` 下**零消费者** —— 它们 mock 的 `mxcUrlToHttp` /
`getIdentityServerUrl` 在本 fork 也不存在。**"有 mock"也是一种"看起来做了"。**

**⚠️ 删 69 条声明的批量脚本本轮失败（未提交）**

第一次尝试只删掉 **8 条**（预期 69 个名字）并吃掉一个 `}`，`tsc` 报 `'}' expected`。
已立即还原、**未提交**。教训：
① 批量删除要用 **「预期条数 == 实际条数」做断言** —— 69 个名字只删到 8 条本身就很可疑，
说明匹配判据错了；② 删完必须跑 `tsc` 复核结构完整性。下轮改用更稳的解析方式。

**本节验证**：`tsc` 0 错；device-keys / sync-accumulator / 守卫 spec 全绿；
`emptyShellModules` 归零；`public-api-docs` 的 R3（收窄）/ R4（台账里的类已不存在）均已按棘轮规则处理。

---

## 附录 A：核验命令（可复现）

```bash
# α：指纹含行号
sed -n '37,40p' scripts/quality/check-swallow-fallbacks.mjs
# 正解对照
sed -n '12,13p;74,84p' scripts/quality/check-real-backend-types.mjs
sed -n '145,149p' scripts/quality/check-timer-pairing.mjs
# 漂移即纯行号重记（增删相等出现 6 次）
git log --format="%h %s" --numstat -- scripts/quality/swallow-fallback-baseline.json
# β：6 处跨块错配（门禁匹配 64 = baseline 64，其中 6 条的 return 落在 catch 块外）
#    逐条打开：src/rust-crypto/backup.ts:256 / src/guest/index.ts:306,350 /
#    src/store/memory.ts:331 / src/crypto/store/indexeddb-crypto-store-backend.ts:262,410
# 门禁自身无测试
grep -rl "check-swallow-fallbacks" spec/ || echo "no spec"

# 判定类重构的等价性证明（§7.11-1 用的就是这一招）：改之前先存金标准，改完对拍 stdout
node scripts/quality/check-manager-codegen-coverage.mjs > /tmp/old.out   # ← 改动之前跑
# …改动脚本…
node scripts/quality/check-manager-codegen-coverage.mjs > /tmp/new.out   # ← 改动之后跑
diff -q /tmp/old.out /tmp/new.out   # 无输出 = 「只改成本、不改判定」
# 注意要在仓库根目录跑：脚本用 process.cwd() 定位，不能把脚本 copy 到 /tmp 再执行

# 上面这三步已产品化（§7.12）：capture 存金标准、verify 对拍、attrib 归因
node scripts/audit/gate-golden.mjs capture manager-codegen --script quality:manager-codegen
# …改动脚本…
node scripts/audit/gate-golden.mjs verify  manager-codegen          # 逐字节对拍，改后可直接跑
node scripts/audit/gate-golden.mjs attrib  quality:cross-repo-pin   # 本来就红 → PRE_EXISTING，exit 0
node scripts/audit/gate-golden.mjs attrib  --script quality:no-default-key --json
node scripts/audit/gate-golden.mjs list
# 判据速记：退出码 0=一致/无回归，1=有差异(verify)/本轮改红(attrib)，2=用法或 IO 错误。
# 临时世界删不掉时它会打印可直接粘贴的 rm -rf <路径>；排查用 GATE_GOLDEN_DEBUG=1。

# 门禁 spec 必须串行跑（并发会让 setupTests.ts 的全局 beforeAll 超时，造成假红，见 §7.11-5）
npx vitest run --no-file-parallelism spec/unit/codegen-coverage-gate.spec.ts

# ── §7.13 孤岛脚本盘点 + P6 长尾 ──────────────────────────────────────────────
# 可执行性盘点的唯一入口：门禁自己会打印三层分类与孤岛清单
node scripts/quality/check-gate-reachability.mjs
#   期望：44 个受管辖门禁全可达；孤岛 7 个（均已登记）→ exit 0
#   scripts/ 下脚本总数、自称门禁数、未接入 lint/CI 数都在输出头部

# 孤岛台账（ratchet）：新增未登记孤岛 / 台账腐烂 都会让门禁 exit 1
cat scripts/quality/orphan-scripts-baseline.json
# 变异自证：造一个新孤岛 → 应报"未登记的孤岛脚本"
printf '#!/usr/bin/env node\nconsole.log(1);\n' > scripts/quality/orphan-probe-tmp.mjs
node scripts/quality/check-gate-reachability.mjs   # 期望 exit 1
rm -f scripts/quality/orphan-probe-tmp.mjs

# P6 口径复算（52 个 quality 脚本里有几个被 spec 引用）
node -e 'const fs=require("fs");const q=fs.readdirSync("scripts/quality").filter(f=>f.endsWith(".mjs"));
const s=(function w(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+"/"+e.name;
e.isDirectory()?w(p,o):/\.(ts|tsx|mts|cts)$/.test(e.name)&&o.push(fs.readFileSync(p,"utf8"));}return o;})("spec").join("\n");
const no=q.filter(f=>!s.includes(f.replace(/\.mjs$/,"")));console.log(q.length,"总 /",no.length,"无 spec");'

# 18 个 granular 门禁是同一模板的副本（helper 逐字重复，只有 CHECKS 数据不同）
for f in scripts/quality/check-*-granular-coverage.mjs; do
  printf "%s  " "$(grep -c 'function hasMethod' "$f")"; echo "$f"
done   # 每个都是 1（同一份 hasMethod 被复制了 18 次）
```

## 附录 B：本文核验边界

- β 的"6/64"由配平解析（屏蔽注释/字符串后按 `{}` 配对）得出，并**已逐条打开源码人工核验 6 处**，非估算。
- γ 的"约 35 处"、δ 的"14 处"为配平解析统计的**量级**，逐条纳入 baseline 前需再核。
- "门禁匹配总数 64 = baseline 64"说明当前门禁自洽（不自洽的是**匹配语义**）。

---

**生成时间**: 2026-10-06
**最后更新**: 2026-10-07（§7.11 续修：`manager-codegen` 性能、`probe-contract-drift` 死脚本、门禁 spec 长期红灯；
§7.12 **P8 落地**：`scripts/audit/gate-golden.mjs` 把「存金标准 → 改 → 对拍」与红灯归因产品化；
§7.13 **孤岛脚本盘点 + P6 长尾一轮**：可达性门禁补三条"假绿"通道、新增孤岛台账 ratchet，
口径重测 52/37，新守 4 个门禁，并查明 18 个 granular 门禁是同一模板的 18 份副本；
§7.14 **处置一轮**：清掉 2 条既有 CI 红灯（exports / public-api-docs），补上第 4 条假绿通道
（受管辖改为按路径，否则抽库会让 44 → 26），新显形 5 个死门禁（1 接线 / 4 豁免），
**granular 抽库 18→1 且 18/18 金标准逐字节对拍通过**，P6 未覆盖 37 → 18，孤岛 7 → 2，
修 waiver-expiry 报告头 UTC 打印。收尾全量扫描 **46 个门禁 44 绿 / 2 红**（`cross-repo-pin` 按设计红、`quality:report` 超时）；
§7.15 **全仓复检二轮（逐条实跑 60+ 脚本，而非只看门禁自述）**：澄清 2 条"缺 lcov"红属本地环境问题
（CI 里它们排在 `pnpm test --coverage` 之后），修 `pnpm lint` 真红（prettier 3 个 md，含本轮引入的审计文档），
修"跑一遍门禁就污染工作区"（报告生成器产物入 `.gitignore`），
`check-type-coverage` 并发化 **85.8s → ~40s**（gate-golden 对拍 stdout 逐字节一致），
补 `.lintstagedrc` 覆盖 `.mjs`，P6 口径精算为"52 个脚本中 17 个非 granular 无 spec（13 个判定类）"
并新守 `check-public-api-docs`（16 例 + 两次变异自证）；
**§7.15 续修（P6 收尾一轮）**：13 个判定类门禁**全部守住**，新增
`check-exports-docs`(25) / `check-sdk-contract-alignment`(46) / `check-docs-examples`(18) /
`check-entrypoint-layering`(21) 共 110 例，均走「capture → 抽纯函数 → verify 对拍 → 变异自证」、
CLI 行为逐字节一致；并定位修掉 `quality:report` 240s 超时
（根因：缺 lcov 时静默重跑两遍全量 vitest，11m14s，见 §7.15-8）；
**§7.15 续修（P6 收尾二轮）**：发现并换掉一处**纸面 spec** ——
`verify-path-contract` 的 spec 抄了一份常量副本自己测自己（3 处已漂移），
根因是门禁顶层 `process.exit(2)` 逼得 spec 只能抄副本；已改造门禁并改为 import 真模块
（28 例，含与 `src/http-api/prefix.ts` 的一致性守卫，兑现门禁注释里的空头承诺，见 §7.15-9）。
至此**判定类门禁 0 个未覆盖**，剩余 6 个全是报告生成器 / 查询器 / runner / 诊断工具；
口径判据改为「spec 真不真跑这个脚本」而非文件名配对）；
**§7.15-11 全仓复检三轮（判据下沉到共享库层）**：`scripts/quality/lib/` 3 个库里
2 个零 spec，补 `stable-id`(18) 与 `spec-import-graph`(28) 共 46 例，把这两个文件注释里
记的历史坑全部转成断言；记录变异自证的两类新坑（同一处代码两个变异会**互相遮蔽**、
变异构造错会"纸面通过"），以及**不要在门禁扫描运行时施加变异**（本轮因此误报
`quality:contracts` 67 条假红，还原后 exit 0）；并查清 `quality:coverage:critical`
三模块红的真相是 floor 本身高于实测（口径不一致的假说已定向重测证伪），未擅自改动 floor）；
**§7.15-12 覆盖率红的闭环**：挖出 `push` 89.01 → 74.28 是**真实回归**，那 74 行是
2026-09-29 为「让契约缺口报告变绿」塞进 SDK 的重复别名方法（`getPushersWithTrailingSlash`
/ `createPusher`，零调用方、与既有方法逐字节等价）—— 删掉后实现面覆盖反而 89.4% → 90.9%；
再补 30 例覆盖真实缺测（8 处 catch 分支、缓存命中、房间规则、生命周期、20+ 便捷访问器），
三模块定向覆盖率均达 **100%**，混合 lcov 端到端验证门禁 exit 0；记录验证方法自身的坑
（定向 lcov 冒充全仓 lcov 会假红，判据是先对齐 LF）；并订正 `critical-modules.json`
`measuredBy` 的错误描述（floor 来自全仓 lcov，"定向可能低于全仓"的说法正是误放假说的由来）；
**§7.15-13 事后审查**：以代码审查视角复核那 30 例，发现自己跳过了变异自证；补做 9 个变异
有 1 个没转红 —— 记下**第四类失效**：断言强度不足（`rejects.toThrow(Type)` 在异常有多个
来源时失效，必须断言消息），并给出判据「把这一层删掉，还有谁能抛同一种异常？」）
**§7.15-14 全仓排查第五轮**：判据从"源码里有没有这段"推进到"那段有没有被执行到"。
修 `getAdminExternalServiceManager` 的运行时 TypeError（类型声明了、admin 忘了挂）；
清 knip 两处红（死导出 `StripAdminPath` + 过时 ignore）使 CI 的 `analyse_dead_code` 恢复绿；
用**运行时探针**（真实执行初始化后逐个 `typeof`）量出 **46 个方法「类型检查通过、调用即
TypeError」**（25 个模块未接线 + 21 个上游 API 残留声明），登记台账并新增运行时守卫 spec
（5 例，变异自证 3/3）；记下教训「静态存在 ≠ 运行时可执行」，与 §7.15-9「有 spec ≠ 有覆盖」同构；
**§7.15-15 修正上一轮的测量方法**：`setupTests.ts` 的全局 beforeAll 已初始化过，而
`extendMatrixClientWithManagers` 幂等 ⇒ 守卫 spec 里 `{includeAll:true}` 被**静默忽略**，
一度把「不在默认集合里」误判成「模块没接线」。加 `resetManagerExtensions()` 后重测：
`getDirectMessageManager` 是误登记（已在 MODULE_DEFS），而 **`getSamlAuthManager` 是真 bug**
（MODULE_DEFS 标了 `standalone:false` ⇒ 生成器不产出 import 块 ⇒ saml 从不被加载），已修。
台账 pendingWiring 25 → **23**；三连同构：spec 存在/代码存在/**调用存在**，都可「形似而神不至」）
**§7.15-16 判据漏了一半**：把 `MatrixClientInternalMethods` 纳入（它自称"类中已实现"，
实际另缺 74 个），合计 95 个假声明；新一类**空壳模块**（模块自己的方法转发给不存在的方法），
**接线治不了它**；四连同构：spec 存在 / 代码存在 / 调用存在 / **模块存在且能加载**，断链都在下一层）；
**§7.15-17 空壳收口第一批**：7 个模块 31 处转发改走真实能力
（push-rules→PushManager、room-events→Room/EphemeralManager、invites→invite/joinRoom/leaveRoomChain、
push-notifications→PushManager、room-creation→createRoom、uploads→uploadContent、lifecycle→**删除**），
并修掉一处**活 bug**（`inviteByThreePid` 用双重断言按反向顺序传参，运行时 medium 被当成 roomId；
类型表注释早已承认、旧 spec 还把错误顺序断言成期望值）；删 20 条 MatrixClient 从未实现的声明，
使"转发到不存在"**直接编译失败**；用**改名实验**（临时改名后跑 tsc）拿到完备清单 ——
25 条报错全部落在已知位置，证明无模块外依赖（同时暴露我自己的判据漏了 `x?: T` 形式）；
台账 notOnMatrixClient 21→16、emptyShellModules 10→**3**；剩余 device-keys / sessions /
sync-accumulator 共 12 处属"语义映射 vs 删模块"的架构选择，留给下一次决策）
**§7.15-18 空壳收口第二批（空壳模块归零）**：device-keys 3 处（`getDeviceKeys` 与
`getUserDevices` 重复 ⇒ 删；`uploadDeviceKeys` → `uploadKeysRequest`；`hasDevice` →
`getCachedDevice()`）、sync-accumulator 5 处（`client.syncAccumulator` **属性不存在** ⇒
改模块内自持实例）、**sessions 整模块删除**（Matrix 没有 session 概念，其 `ISessionInfo`
的 `accessToken`/`refreshToken` 是客户端凭据、`refreshSession()` 无参不可实现）；
`emptyShellModules` **10 → 0**；新发现「同名 spec ≠ 覆盖」（`sync-accumulator.spec.ts` 测的是
上游 **类**，Manager 5 个方法零覆盖）与弱断言新形态（**只断言返回值、不断言入参形状**）；
第二轮改名实验证明删声明的阻力只剩 test-utils 2 行（已修，且该工具零消费者）；
**删 69 条声明的批量脚本本轮失败未提交**（只删掉 8 条并吃掉一个 `}`，已还原）
**关联**: `docs/sdk-encapsulation-audit.md` §13.15.8（本问题上一次以"重记基线"收尾，本文给出根因与根治方案）
