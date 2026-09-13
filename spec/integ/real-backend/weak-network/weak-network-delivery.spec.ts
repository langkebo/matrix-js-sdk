/*
 * L4 弱网：丢包/延迟/断链下的「最终送达 + 不重复」（阶段 3 · P3-2）。
 *
 * 审计文档 §4 的目标：30% 丢包 + 200ms 抖动下送达 ≥99.9% 且无重复。
 *
 * 实测（见 toxiproxy.ts 注释）：toxiproxy 2.12 没有 `loss` toxic；而 `reset_peer` 是
 * **按连接**生效的 —— 用 curl（每次新连接）打 20 次、toxicity 0.3 时失败 5 次（25%），
 * 但 SDK 复用 keep-alive 连接，8 条消息可能一次都不触发。所以本 spec 用三层扰动：
 *   1. latency 200ms + jitter 100ms（每次请求都生效，可观测）；
 *   2. reset_peer toxicity 0.3（新连接里约 30% 被 RST）；
 *   3. 确定性的断链窗口（每 N 条关掉代理 M 毫秒）—— 保证重试链路一定被走到，
 *      并让「首次尝试失败数」成为一个**断言**，避免扰动没生效时门禁假绿。
 *
 * 前置（未满足则 skip，不让整套 real-backend 变红）：
 *   docker compose -f spec/integ/real-backend/weak-network/docker-compose.toxiproxy.yml up -d
 *   pnpm test:real-backend:l4
 *
 * 规模：默认 20 条（CI 友好），`L4_MESSAGE_COUNT=1000` 走 nightly 量级。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MatrixClient } from "../../../../src/matrix";
import { Method } from "../../../../src/http-api/method";
import { TestConfig } from "../TestConfig";
import { loginAsConfiguredUser, withRateLimitRetry } from "../auth-test-helpers";
import { L4_TOXICS, Toxiproxy } from "./toxiproxy";

const MESSAGE_COUNT = Number(process.env.L4_MESSAGE_COUNT ?? 20);
/** 测试侧的有界重试预算（见文件末尾「为什么不是零重试」）。 */
const SEND_BUDGET = Number(process.env.L4_SEND_BUDGET ?? 8);
/** 每 N 条制造一次断链；0 表示只靠 toxics（本地调试用）。 */
const INTERRUPT_EVERY = Number(process.env.L4_INTERRUPT_EVERY ?? 4);
/** 断链窗口（毫秒）：要短于有界重试预算的累积退避，让重试落在窗口之后。 */
const INTERRUPT_MS = Number(process.env.L4_INTERRUPT_MS ?? 600);

interface SendOutcome {
    body: string;
    eventId?: string;
    attempts: number;
    error?: string;
}

describe("L4 弱网交付（延迟 + 30% 连接重置 + 断链窗口）", () => {
    let client: MatrixClient | null = null;
    let roomId = "";
    let proxy: Toxiproxy;
    let proxyAvailable = false;
    let backendAvailable = false;
    let setupError: unknown;

    beforeAll(async () => {
        proxy = new Toxiproxy();
        proxyAvailable = await proxy.isAvailable();
        if (!proxyAvailable) return;

        try {
            // 代理入口就绪后再建房间：此时还没注入 toxic，避免 setup 阶段被干扰
            await proxy.ensureProxy();
            client = await loginAsConfiguredUser(TestConfig.testUser);
            // getSendingManager 是异步注册的 manager 扩展（AGENTS.md 陷阱 #8）
            await client.whenManagerExtensionsReady();
            const room = await withRateLimitRetry(() => client!.createRoom({ name: `l4_weak_network_${Date.now()}` }));
            roomId = room.room_id;
            backendAvailable = true;
        } catch (error) {
            setupError = error;
            backendAvailable = false;
        }
    }, 180_000);

    afterAll(async () => {
        // 用例失败也必须恢复链路，否则后续 real-backend 用例全被连累
        await proxy?.reset().catch(() => undefined);
        client?.stopClient();
        await client?.logout?.().catch(() => undefined);
    });

    it("弱网下所有消息最终送达，且服务端按 txnId 去重后每条只出现一次", async (context) => {
        if (!proxyAvailable) {
            context.skip();
            return;
        }
        if (!backendAvailable) {
            throw new Error(`后端不可用: ${String(setupError)}`);
        }

        const runId = `l4-${Date.now()}`;
        const bodies = Array.from({ length: MESSAGE_COUNT }, (_, index) => `${runId}-${index}`);
        const outcomes: SendOutcome[] = [];
        let interruptions = 0;
        // SDK 自己的重试计数（SendingManager.withRetry 写入 requestStats.retried）。
        // 这比"测试侧调用了几次"更接近事实：SDK 内部重试成功时，测试侧只会看到一次调用。
        const retriedBefore = client!.getSendingManager().getRequestStats().retried;

        await proxy.withToxics(L4_TOXICS, async () => {
            for (const [index, body] of bodies.entries()) {
                const shouldInterrupt = INTERRUPT_EVERY > 0 && index % INTERRUPT_EVERY === INTERRUPT_EVERY - 1;
                if (!shouldInterrupt) {
                    outcomes.push(await sendWithBudget(client!, roomId, body));
                    continue;
                }

                // 断链窗口：这一次请求必然失败，重试要在链路恢复后才可能成功。
                // 稳定的 txnId 让"发出去但响应丢了"的那次也被服务端去重。
                interruptions += 1;
                await proxy.setEnabled(false);
                const pending = sendWithBudget(client!, roomId, body);
                await sleepMs(INTERRUPT_MS);
                await proxy.setEnabled(true);
                outcomes.push(await pending);
            }
        });

        const sdkRetries = client!.getSendingManager().getRequestStats().retried - retriedBefore;
        const helperRetries = outcomes.filter((outcome) => outcome.attempts > 1).length;
        const maxAttempts = Math.max(...outcomes.map((outcome) => outcome.attempts));
        console.log(
            `[l4] ${MESSAGE_COUNT} 条消息：断链窗口 ${interruptions} 次，SDK 内部重试 ${sdkRetries} 次，` +
                `测试侧兜底重试 ${helperRetries} 条，测试侧最大调用次数 ${maxAttempts}`,
        );

        // 扰动必须真的发生过，否则这门禁就是假绿。实测过两种假绿：
        // 只加 reset_peer 时 SDK 复用 keep-alive 连接 → 0 次重试；断链窗口下
        // SDK 自己就重试成功了 → 测试侧调用次数仍是 1。所以断言 SDK 的重试计数。
        if (interruptions > 0) {
            expect(sdkRetries, "断链窗口必须触发 SDK 内部重试").toBeGreaterThan(0);
        }

        const undelivered = outcomes.filter((outcome) => !outcome.eventId);
        expect(
            undelivered.map((outcome) => `${outcome.body}: ${outcome.error ?? "unknown"}`),
            "弱网下必须最终送达（测试侧有界重试预算内的每一条）",
        ).toEqual([]);

        // 关键不变量：服务端按 txnId 去重，因此每个 body 只能出现一次
        const received = await collectBodies(client!, roomId, MESSAGE_COUNT * 3);
        for (const body of bodies) {
            expect(
                received.filter((seen) => seen === body),
                `消息 ${body} 出现次数`,
            ).toHaveLength(1);
        }
    }, 600_000);
});

/**
 * 发送一条消息，最多 `SEND_BUDGET` 次。
 *
 * 为什么不是零重试：这一层的验收指标是**系统级**「最终送达率」（审计 §4），而
 * `client.getSendingManager().sendEvent()` 自身已带 withRetry（连接错误 + 稳定 txnId）。
 * 测试侧再加一层有界预算，是为了让"最终"二字在确定性断链下成立，并把"用了几次尝试"
 * 记录下来（否则扰动没生效时无法察觉）。去重不靠这层重试：它靠同一 txnId 被复用
 * （SendingManager.resolveTxnId 在 withRetry 之外解析），服务端按事务去重。
 */
async function sendWithBudget(client: MatrixClient, roomId: string, body: string): Promise<SendOutcome> {
    let lastError = "";
    for (let attempt = 1; attempt <= SEND_BUDGET; attempt++) {
        try {
            const response = await client.getSendingManager().sendEvent(roomId, "m.room.message", {
                msgtype: "m.text",
                body,
            });
            return { body, eventId: response.event_id, attempts: attempt };
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            await sleepMs(Math.min(250 * attempt, 2000));
        }
    }
    return { body, attempts: SEND_BUDGET, error: lastError };
}

/** 拉取房间消息，返回正文列表（用于统计每个 body 出现几次）。 */
async function collectBodies(client: MatrixClient, roomId: string, limit: number): Promise<string[]> {
    const response = await client.http.authedRequest<{ chunk?: { content?: { body?: string } }[] }>(
        Method.Get,
        `/rooms/${encodeURIComponent(roomId)}/messages`,
        { dir: "b", limit: String(limit) },
    );
    return (response.chunk ?? []).map((event) => event.content?.body ?? "").filter((body) => body.length > 0);
}

function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
