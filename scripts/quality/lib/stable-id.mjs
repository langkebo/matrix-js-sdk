/**
 * 稳定指纹（stable id）—— 供 `scripts/quality/**` 的 baseline 机制共用。
 *
 * 为什么要单独抽出来：本仓已经有两个门禁各自独立悟到同一个道理，并把结论写进了注释——
 *   `check-real-backend-types.mjs`: "Fingerprint = file + TS code + message (NOT the line number)"
 *   `check-timer-pairing.mjs`:    "序号而不是行号：在上方插代码不会失效"
 * 但 `check-swallow-fallbacks.mjs` 与 `check-generated-dto-strictness.mjs` 仍然把行号编进指纹，
 * 于是「上方插入任意一行」（哪怕只是 prettier 重排）都会让整批 baseline 条目 STALE，
 * 逼迫开发者执行一次无审查的全量重记——而重记动作同时会吸收真正的新缺陷。
 *
 * 把实现收在一处，后写的门禁就不必再猜一次。
 *
 * 约定（写新门禁时请遵守）：
 *   1. 指纹**只由稳定维度构成**——文件路径、代码片段、错误码、序号。
 *      **绝不接受行号/列号**：它们随无关改动漂移。
 *   2. 行号可以留在 baseline 条目里，但只能作为**展示字段**，不参与 id 计算。
 *   3. 同一文件内出现**完全相同**的指纹时，用 `nextOrdinal()` 分配序数，
 *      不要简单折叠成一条——折叠会让「又复制粘贴了一份同样的缺陷」隐身。
 */

import crypto from "node:crypto";

/** 维度连接符：用 NUL 而不是 `|`，避免维度内容里出现 `|` 时产生歧义拼接。 */
const SEPARATOR = "\u0000";

/** 指纹摘要长度。16 个 hex 字符（64 bit）对单仓量级的 baseline 足够抗碰撞，且便于阅读。 */
const DIGEST_LENGTH = 16;

/**
 * 由稳定维度构造指纹。
 *
 * @param {string} filePath 归一化后的仓库相对路径（正斜杠）。
 * @param {ReadonlyArray<string | number>} stableParts
 *        稳定维度，例如代码片段、错误码。**不要传行号**。
 * @returns {string} `${filePath}#${digest}`
 */
export function stableId(filePath, stableParts) {
    const digest = crypto
        .createHash("sha1")
        .update([filePath, ...stableParts].join(SEPARATOR))
        .digest("hex")
        .slice(0, DIGEST_LENGTH);
    return `${filePath}#${digest}`;
}

/**
 * 为「本文件内完全相同的片段」分配 1-based 序数。
 *
 * 传入同一个 `counter` 累加器、同一个 `key` 反复调用，会依次得到 1、2、3…
 * 这样即使两处片段一字不差，也能各自拥有独立身份；删掉其中一处时，
 * 另一处的序数不会被重排（只有删除**前面**的那处才会，这是可接受的近似——
 * 与 `check-timer-pairing.mjs` 的既有做法一致）。
 *
 * @param {Map<string, number>} counter 本次扫描的累加器，由调用方持有。
 * @param {string} key 片段指纹（通常是 `文件` + 规范化片段）。
 * @returns {number} 该片段在本文件内的第几处。
 */
export function nextOrdinal(counter, key) {
    const ordinal = (counter.get(key) ?? 0) + 1;
    counter.set(key, ordinal);
    return ordinal;
}

/**
 * 把一行文本规范化成可比对的片段：折叠所有空白、去首尾。
 *
 * 之所以要规范化：snippet 会随 prettier 重排（换行、缩进）而变化，
 * 但这些变化不改变语义，不该让指纹漂移。
 *
 * @param {string} snippet
 * @returns {string}
 */
export function normalizeSnippet(snippet) {
    return snippet.replace(/\s+/g, " ").trim();
}
