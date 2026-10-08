/**
 * 基线（baseline）更新前的**分类与审查门**。
 *
 * ## 为什么要抽出来
 *
 * 本仓有 4 个 baseline 型门禁（swallow / generated-dto-strictness / technical-debt /
 * real-backend-types），它们都有 `--update-baseline`。这个动作里藏着两种**性质完全不同**
 * 的写入，混在一起就会出事：
 *
 *   · **重记（drift）**：指纹没变，只是行号字段变了 —— 安全，可以无条件重记；
 *   · **赦免新条目（new）**：当前扫到、基线里本来没有 —— **必须有人看过**，
 *     否则一次手滑就能把一批新缺陷静默洗白。
 *
 * 2026-10-07 起 `check-swallow-fallbacks.mjs` 与 `check-generated-dto-strictness.mjs`
 * 已经这么做了（新增项默认拒绝写入，要显式 `--accept-new`）；另外两个还没有。
 * 这条判据本身很短，但它是"让债务可以永久不还"的唯一闸门，所以抽成共享实现 + spec，
 * 避免 4 份各自漂移的副本。
 *
 * ## 不变量
 *
 *   `added` 与 `removed` 都由**集合差**算出且保序（按 `currentIds` / `previousIds` 的输入顺序），
 *   这样打印与 diff 都稳定；`refuse` 只在"有新增且没给 `--accept-new`"时为真 ——
 *   **纯 drift（added 为空）永远不该被拦**，否则门禁会逼人写豁免而不是重记。
 *
 * @param {object} input
 * @param {string[]} input.previousIds 基线里现有的 id（顺序即打印顺序）
 * @param {string[]} input.currentIds  本次扫到的 id
 * @param {boolean} input.acceptNew    是否显式给了 `--accept-new`
 * @returns {{ added: string[]; removed: string[]; refuse: boolean }}
 */

export function planBaselineWrite({ previousIds, currentIds, acceptNew }) {
    const prev = new Set(previousIds);
    const cur = new Set(currentIds);
    return {
        added: currentIds.filter((id) => !prev.has(id)),
        removed: previousIds.filter((id) => !cur.has(id)),
        refuse: currentIds.some((id) => !prev.has(id)) && !acceptNew,
    };
}
