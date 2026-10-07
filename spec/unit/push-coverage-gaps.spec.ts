/*
 * PushManager 的错误路径与生命周期行为测试（错误分支 / 缓存命中 / 房间规则 / start()）。
 *
 * ⚠️ 来历与内容性质要分清：本文件诞生于一次覆盖率治理（见下），但里面**每一条都是
 * 行为断言**，不是为凑行数写的 —— 覆盖率只是副产品。一条测试该不该留，看的是
 * 「把实现改坏它会不会红」，不是「它在不在这个文件里」。8 处变异自证全部转红。
 *
 * 来历：`src/push/index.ts` 的覆盖率自 2026-09-13（当时实测 89.01%）一路掉到 74.28%，
 * 低于 `critical-modules.json` 的 floor 89。根因是 2026-09-29 那次提交为「完整覆盖后端
 * 路由」塞进来两个零调用方的别名方法（`getPushersWithTrailingSlash` / `createPusher`，
 * 与 `getPushers` / `setPusher` 逐字节等价），它们已删除；剩下的缺口是**真实未测的行为**：
 *
 *   · 8 处 catch 分支（emit PushError + 规范化后重抛）—— 一条都没测；
 *   · 缓存命中早返回（第二次调用不该再发请求）；
 *   · 房间级规则的读写（getRoomPushRule / setRoomMutePushRule / isRoomMuted 成功路径）；
 *   · start() 的并发复用与失败清理（FT-115）。
 *
 * 这些都不是为了凑数字 —— 错误分支有没有 emit、缓存有没有真的命中，是调用方能观察到的行为。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PushManager, PushEvent } from "../../src/push/index";
import { InvalidParamError } from "../../src/common/errors.ts";
import { PushRuleActionName, PushRuleKind } from "../../src/@types/PushRules";
import { logger } from "../../src/logger";

const ROOM_ID = "!room:example.com";

describe("PushManager 覆盖缺口", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let pushManager: PushManager;

    const pushRulesFixture = {
        global: {
            override: [],
            content: [],
            room: [{ rule_id: ROOM_ID, enabled: true, actions: [PushRuleActionName.DontNotify] }],
            sender: [],
            underride: [],
        },
    };

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn().mockImplementation((_method: string, path: string) => {
                    if (path === "/pushers") return Promise.resolve({ pushers: [] });
                    if (path === "/pushrules") return Promise.resolve(pushRulesFixture);
                    if (path === `/pushrules/global/${PushRuleKind.RoomSpecific}`) {
                        return Promise.resolve({ [PushRuleKind.RoomSpecific]: pushRulesFixture.global.room });
                    }
                    return Promise.resolve({});
                }),
            },
            getUserId: vi.fn().mockReturnValue("@test:example.com"),
            pushRules: pushRulesFixture,
            getPushManager: vi.fn(),
        };
        pushManager = new PushManager(mockClient);
        // 必须在 pushManager 建好之后再绑定，否则拿到的是 undefined
        mockClient.getPushManager.mockReturnValue(pushManager);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** 4xx 不触发 withRetry 重试，直接进 catch 分支。 */
    const rejectOnce = (status = 404) =>
        mockClient.http.authedRequest.mockRejectedValueOnce({ httpStatus: status, errcode: "M_NOT_FOUND" });

    describe("缓存命中：第二次调用不再发请求", () => {
        it("getPushers", async () => {
            const first = await pushManager.getPushers();
            const afterFirst = mockClient.http.authedRequest.mock.calls.length;
            const second = await pushManager.getPushers();
            expect(second).toEqual(first);
            expect(mockClient.http.authedRequest.mock.calls.length).toBe(afterFirst);
        });

        it("getPushRules", async () => {
            await pushManager.getPushRules();
            const afterFirst = mockClient.http.authedRequest.mock.calls.length;
            await pushManager.getPushRules();
            expect(mockClient.http.authedRequest.mock.calls.length).toBe(afterFirst);
        });

        it("forceRefresh=true 绕过缓存", async () => {
            await pushManager.getPushers();
            const afterFirst = mockClient.http.authedRequest.mock.calls.length;
            await pushManager.getPushers(true);
            expect(mockClient.http.authedRequest.mock.calls.length).toBe(afterFirst + 1);
        });
    });

    describe("错误分支：emit PushError 后重抛", () => {
        const failingCases: Array<[string, () => Promise<unknown>]> = [
            ["getPushRules", () => pushManager.getPushRules()],
            ["getPushRulesByScope", () => pushManager.getPushRulesByScope("global")],
            ["getPushRulesByKind", () => pushManager.getPushRulesByKind("global", PushRuleKind.RoomSpecific)],
            [
                "createPushRule",
                () =>
                    pushManager.createPushRule("global", PushRuleKind.ContentSpecific, "kw", {
                        actions: [PushRuleActionName.Notify],
                    }),
            ],
            [
                "updatePushRule",
                () =>
                    pushManager.updatePushRule("global", PushRuleKind.ContentSpecific, "kw", {
                        actions: [PushRuleActionName.Notify],
                    }),
            ],
            ["deletePushRule", () => pushManager.deletePushRule("global", PushRuleKind.ContentSpecific, "kw")],
            [
                "setPushRuleEnabled",
                () => pushManager.setPushRuleEnabled("global", PushRuleKind.ContentSpecific, "kw", true),
            ],
            [
                "setPushRuleActions",
                () =>
                    pushManager.setPushRuleActions("global", PushRuleKind.ContentSpecific, "kw", [
                        PushRuleActionName.Notify,
                    ]),
            ],
        ];

        for (const [name, invoke] of failingCases) {
            it(`${name} 失败时 emit PushError 且重抛`, async () => {
                const emitted: unknown[] = [];
                pushManager.on(PushEvent.PushError, (e: unknown) => emitted.push(e));
                rejectOnce();
                await expect(invoke()).rejects.toThrow();
                expect(emitted).toHaveLength(1);
            });
        }
    });

    describe("参数校验：空 scope / kind / ruleId 一律拒绝", () => {
        it("规则增删改查方法", async () => {
            const rule = { actions: [PushRuleActionName.Notify] };
            await expect(pushManager.createPushRule("", PushRuleKind.ContentSpecific, "r", rule)).rejects.toThrow(
                InvalidParamError,
            );
            await expect(pushManager.updatePushRule("", PushRuleKind.ContentSpecific, "r", rule)).rejects.toThrow(
                InvalidParamError,
            );
            await expect(pushManager.deletePushRule("", PushRuleKind.ContentSpecific, "r")).rejects.toThrow(
                InvalidParamError,
            );
            await expect(pushManager.getPushRuleEnabled("", PushRuleKind.ContentSpecific, "r")).rejects.toThrow(
                InvalidParamError,
            );
            await expect(pushManager.setPushRuleEnabled("", PushRuleKind.ContentSpecific, "r", true)).rejects.toThrow(
                InvalidParamError,
            );
            await expect(
                pushManager.setPushRuleActions("", PushRuleKind.ContentSpecific, "r", [PushRuleActionName.Notify]),
            ).rejects.toThrow(InvalidParamError);
        });

        it("关键字 / 用户 ID 快捷方法：空参数必须在**本层**就被拦下", async () => {
            // ⚠️ 这里必须断言**具体错误消息**，不能只断言 InvalidParamError。
            // 这四个方法内部会转发给 createPushRule/deletePushRule，而后者自己也校验
            // `!scope || !kind || !ruleId` —— 只断言异常类型的话，把本层的校验删掉，
            // 下游照旧抛 InvalidParamError，断言仍然通过（变异自证实测如此）。
            await expect(pushManager.addKeywordHighlight("")).rejects.toThrow("keyword is required");
            await expect(pushManager.removeKeywordHighlight("")).rejects.toThrow("keyword is required");
            await expect(pushManager.ignoreSender("")).rejects.toThrow("userId is required");
            await expect(pushManager.unignoreSender("")).rejects.toThrow("userId is required");
        });
    });

    describe("房间级推送规则", () => {
        it("getRoomPushRule 在 pushRules 已同步时返回该房间的规则", () => {
            expect(pushManager.getRoomPushRule("global", ROOM_ID)?.rule_id).toBe(ROOM_ID);
        });

        it("getRoomPushRule 在未同步 pushRules 时抛出（要求先 sync）", () => {
            mockClient.pushRules = undefined;
            expect(() => pushManager.getRoomPushRule("global", ROOM_ID)).toThrow();
        });

        it("setRoomMutePushRule(mute=true) 在无既有规则时创建 dont_notify 并回写 pushRules", async () => {
            const emptyRules = { global: { override: [], content: [], room: [], sender: [], underride: [] } };
            mockClient.pushRules = emptyRules;
            mockClient.http.authedRequest.mockImplementation((_m: string, path: string) => {
                if (path === "/pushrules") return Promise.resolve(pushRulesFixture);
                return Promise.resolve({});
            });

            await pushManager.setRoomMutePushRule("global", ROOM_ID, true);

            // 回写回调把最新规则写回了 client（L581）
            expect(mockClient.pushRules).toEqual(pushRulesFixture);
        });

        it("isRoomMuted 命中 dont_notify 规则时返回 true", async () => {
            await expect(pushManager.isRoomMuted(ROOM_ID)).resolves.toBe(true);
        });

        it("isRoomMuted 对未命中的房间返回 false", async () => {
            await expect(pushManager.isRoomMuted("!other:example.com")).resolves.toBe(false);
        });
    });

    describe("start() 生命周期", () => {
        it("并发调用复用同一份初始化，只发一轮请求", async () => {
            const first = pushManager.start();
            const second = pushManager.start();
            await Promise.all([first, second]);
            // getPushers + getPushRules 各一次；若第二次没复用 startPromise，会翻倍
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(2);
        });

        it("初始化失败时 warn 并清空 startPromise，使下次可重试", async () => {
            const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
            mockClient.http.authedRequest.mockRejectedValue({ httpStatus: 404, errcode: "M_NOT_FOUND" });

            await pushManager.start();
            expect(warn).toHaveBeenCalled();

            const afterFirst = mockClient.http.authedRequest.mock.calls.length;
            await pushManager.start();
            // 清空了 promise 才会重新发起（否则第二次直接返回失败的旧 promise）
            expect(mockClient.http.authedRequest.mock.calls.length).toBeGreaterThan(afterFirst);
        });

        it("初始化成功后再次 start() 是 no-op", async () => {
            await pushManager.start();
            const afterFirst = mockClient.http.authedRequest.mock.calls.length;
            await pushManager.start();
            expect(mockClient.http.authedRequest.mock.calls.length).toBe(afterFirst);
        });
    });
});
