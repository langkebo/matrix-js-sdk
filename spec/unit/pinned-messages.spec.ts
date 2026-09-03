import { beforeEach, describe, expect, it, vi } from "vitest";

import { PinnedMessagesManager } from "../../src/pinned-messages";
import { MatrixError } from "../../src/http-api/errors";

describe("PinnedMessagesManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: PinnedMessagesManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getRoom: vi.fn(),
            getUserId: vi.fn().mockReturnValue("@alice:example.com"),
            sendStateEvent: vi.fn(),
        };

        manager = new PinnedMessagesManager(mockClient);
        manager.setRetryOptions({ maxRetries: 2, retryDelay: 0 });
    });

    it("classifies rate limits as RetryableError with metadata for reads", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError(
                { errcode: "M_LIMIT_EXCEEDED", error: "slow down", retry_after_ms: 325 },
                429,
                undefined,
                undefined,
                new Headers({ "x-trace-id": "pinned-trace" }),
            ),
        );

        await expect(manager.getPinnedEventsFromServer("!room:example.com")).rejects.toMatchObject({
            name: "RetryableError",
            errorCode: "M_LIMIT_EXCEEDED",
            retryAfter: 325,
            traceId: "pinned-trace",
            isRetryable: true,
        });

        expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(3);
    });

    it("does not retry non-idempotent writes by default", async () => {
        mockClient.http.authedRequest.mockRejectedValue(
            new MatrixError({ errcode: "M_LIMIT_EXCEEDED", error: "slow down", retry_after_ms: 325 }, 429, undefined),
        );

        await expect(manager.pinEventToServer("!room:example.com", "$event")).rejects.toMatchObject({
            name: "RetryableError",
            errorCode: "M_LIMIT_EXCEEDED",
            isRetryable: true,
        });

        expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
    });
});

// FT-103: PinnedMessagesManager GET 响应体结构必须匹配后端实际响应
// 后端 (pinned.rs) 返回 { pinned_events: Vec<String> }，非 { events: [{ event_id, ... }] }
// SDK 必须解析 pinned_events 字段（字符串数组），而非 events 字段（对象数组）
describe("FT-103: getPinnedEventsFromServer 解析后端实际响应格式", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: PinnedMessagesManager;

    beforeEach(() => {
        mockClient = {
            http: {
                authedRequest: vi.fn(),
            },
            getRoom: vi.fn(),
            getUserId: vi.fn().mockReturnValue("@alice:example.com"),
            sendStateEvent: vi.fn(),
        };
        manager = new PinnedMessagesManager(mockClient);
        manager.setRetryOptions({ maxRetries: 0, retryDelay: 0 });
    });

    it("解析后端 { pinned_events: string[] } 响应格式", async () => {
        // 后端实际返回格式：pinned_events 是字符串数组
        mockClient.http.authedRequest.mockResolvedValue({
            pinned_events: ["$ev1:example.com", "$ev2:example.com"],
        });

        const result = await manager.getPinnedEventsFromServer("!room:example.com");

        expect(result).toHaveLength(2);
        expect(result[0].eventId).toBe("$ev1:example.com");
        expect(result[0].roomId).toBe("!room:example.com");
        expect(result[1].eventId).toBe("$ev2:example.com");
    });

    it("空 pinned_events 数组返回空列表", async () => {
        mockClient.http.authedRequest.mockResolvedValue({
            pinned_events: [],
        });

        const result = await manager.getPinnedEventsFromServer("!room:example.com");

        expect(result).toEqual([]);
    });

    it("缺失 pinned_events 字段时返回空列表（后端返回空对象）", async () => {
        mockClient.http.authedRequest.mockResolvedValue({});

        const result = await manager.getPinnedEventsFromServer("!room:example.com");

        expect(result).toEqual([]);
    });
});
