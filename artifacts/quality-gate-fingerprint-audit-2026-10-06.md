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
> 均已修复并附变异自证；P1 / P2 / P3 / P4 / P5 / P7 已修复；P6 长尾 / P8 / P9 明确未做。
> **执行中有 3 处按实测证据修正了本文原方案**（§4.2 的 rethrow 判定、
> §4.4 的裸 `return;`、§4.1 的 id 形态），详见 **§7**。§5 的问题清单状态见 **§7.1**。

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

| 编号   | 问题                                      | 现状                                                                                                             | 影响                                                                      |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **P1** | **baseline 指纹策略无统一规范**           | 4 个 baseline 型门禁里 **2 个对、2 个错**，无共享 lib、无文字规范                                                | 后来者反复踩坑；本仓已有两个正解却未被复用                                |
| **P2** | **`--update-baseline` 无条件全量重写**    | swallow / generated-dto / technical-debt / real-backend-types 皆有，均无 diff 分类、无 `--accept-new`、无 reason | 「重记行号」与「静默放行新缺陷」共用一个动作，只能靠人工 `git diff` 兜底  |
| **P3** | **baseline 赦免缺到期强制（口径不一致）** | `path-contract-waivers` 有 `expires` + `quality:waiver-expiry` 硬阻断；swallow 的 baseline 过期**只 warn**       | 同一仓库两种豁免纪律，可永久不还的债务存在                                |
| **P4** | **门禁检测器用字符窗口而非语法边界**      | swallow 的 `catch(){[\s\S]{0,240}?return…}` 已确认 6/64 错配                                                     | 假阳性 + **定位错误**（报表指向错误的 catch）+ snippet 跨边界加剧指纹漂移 |
| **P5** | **假阳性被"加注释消警"掩盖**              | 6 处错配 catch 前都有 `@swallow-error` 注释（`refactor-bot` 名下 8 条）                                          | 误报被固化成"已豁免债务"，无人再质疑；注释与代码语义相反                  |
| **P6** | **门禁自身缺测试**                        | 27 个 quality 脚本中 **18 个无任何 spec 引用**，含出事的 swallow                                                 | 门禁是"守门人的守门人"，却没被守；对照 P1 相关性极强                      |
| **P7** | **门禁脚本不在 lint 作用域**              | `lint:js = eslint src spec perf`，不含 `scripts/`                                                                | `scripts/quality/*.mjs` 的代码质量问题永远不被发现                        |
| **P8** | **红灯归因不可自证**                      | 判断"是本轮改红还是本来就红"需人工 `git worktree add HEAD --detach` 复现                                         | 每轮都要重建环境；无 `lastGreenCommit` / 无 pass 快照                     |
| **P9** | **依赖环境特性的质量门不可重复执行**      | `npx eslint <多文件>` 在沙箱内**第二次调用即挂**（file-broker IPC 超时，EXIT=2）                                 | 门禁结论依赖执行方式；须非沙箱才能取确定结果                              |

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

| 编号   | 审计结论                                   | 落地结果                                                                               |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| **α**  | 指纹含行号                                 | ✅ 已修：`stableId(file, [snippet, ordinal])`，行号降为展示字段                        |
| **β**  | 字符窗口跨块                               | ✅ 已修：配平扫描，只在 catch 语法块内判定                                             |
| **γ**  | 语法族偏窄                                 | ✅ 已修，**但边界与本文 §4.4 不同**（见 7.4-2）                                        |
| **δ**  | 240 字符上限                               | ✅ 已修：块内判定天然无长度上限                                                        |
| **加** | 白名单注解泄漏进指纹（收尾复核发现，§7.9） | ✅ 已修：指纹输入剔除注解                                                              |
| **P1** | 指纹策略无规范                             | ✅ 共享 lib + generated-dto 横向整改 + 补 id 稳定性 spec                               |
| **P2** | `--update-baseline` 无审查                 | ✅ 两个门禁均加四分类摘要 + `--accept-new`                                             |
| **P4** | 字符窗口                                   | ✅ 同 β                                                                                |
| **P5** | 加注释消警                                 | ✅ 删 8 处误加注释、补 5 处真实缺失                                                    |
| **P6** | 门禁缺测试                                 | ◐ 只补了出事的两个门禁（swallow 32 例 / generated-dto +2 例）；18 个无 spec 的长尾未动 |
| **P7** | scripts 不在 lint 作用域                   | ✅ 已纳入，**代价与本文明示不同**（见 7.7）                                            |
| **P3** | 豁免无到期强制                             | ✅ 已开 `--strict-baseline`（原先预估的"会转红"未出现，见 7.6）                        |
| **P8** | 红灯归因不可自证                           | ❌ 未做                                                                                |
| **P9** | 沙箱内 eslint 不可重复执行                 | ❌ 未做（环境问题）                                                                    |

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
- **P8**：`lastGreenCommit` / pass 快照未做（本轮仍是人工 `git worktree add HEAD --detach` 复现归因）。
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
  修法是把 O(模块 × 文件) 降到 O(模块 + 文件)（全量扫描一次、按模块归并）。**本轮未改**
  （不在本文 §5 清单内，避免顺手扩大范围）。

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

其余门禁复跑（提交后）全部 EXIT=0：
`debt-markers` / `no-default-key` / `real-backend-types` / `timer-pairing` / `gate-reachability` /
`path-contract` / `waiver-expiry` / `contract-freshness` / `contract-drift` / `manager-extensions` /
`manager-codegen`（≈27 分钟，见 7.8）。`git status` 洁净。

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
```

## 附录 B：本文核验边界

- β 的"6/64"由配平解析（屏蔽注释/字符串后按 `{}` 配对）得出，并**已逐条打开源码人工核验 6 处**，非估算。
- γ 的"约 35 处"、δ 的"14 处"为配平解析统计的**量级**，逐条纳入 baseline 前需再核。
- "门禁匹配总数 64 = baseline 64"说明当前门禁自洽（不自洽的是**匹配语义**）。

---

**生成时间**: 2026-10-06
**关联**: `docs/sdk-encapsulation-audit.md` §13.15.8（本问题上一次以"重记基线"收尾，本文给出根因与根治方案）
