/*
S-8 回归测试：`withRetry()` 的幂等判定必须与 `request()` 一致（按 HTTP 方法）。

背景：`withRetry()` 原先把 `idempotent` 默认值取 `true`，而 `request()` 按方法判定
（仅 GET/HEAD 幂等）。fork 各 manager 普遍用 `withRetry(() => this.request({ method: Post }))`
包裹写请求且不传 `idempotent: false`，导致 5xx / 429 / 网络瞬断时写操作被重复提交
（建好友、建 DM、发验证码等）。

以下用例锁定修复后的行为，防止回归。
*/

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
    BaseManager,
    type RequestSpec,
    type RetryOptions,
    type Transport,
    type TransportOpts,
} from "../../../src/managers/base-manager";
import { Method } from "../../../src/http-api/method";
import { RetryableError } from "../../../src/errors";
import type { Body } from "../../../src/http-api/interface";
import type { QueryDict } from "../../../src/http-api/utils";
import type { MatrixClient } from "../../../src/client";

/** 记录每次调用的 method；默认所有方法均抛可重试错误，可从 `failing` 中移除以模拟成功。 */
class FakeTransport implements Transport {
    public calls: string[] = [];
    public paths: string[] = [];
    public failing = new Set<string>([Method.Get, Method.Post, Method.Put, Method.Delete]);
    /** 抛出的错误实例；默认非限流的可重试错误（500 语义）。 */
    public error: unknown = new RetryableError("simulated retryable failure");
    /** 可选：按 (method, path) 精确决定是否失败；返回 undefined 时回落到 `failing` 集合。 */
    public failWhen?: (method: Method, path: string) => boolean | undefined;

    public async request<T>(
        method: Method,
        path: string,
        _queryParams?: QueryDict,
        _body?: Body,
        _opts?: TransportOpts,
    ): Promise<T> {
        this.calls.push(method);
        this.paths.push(path);
        const decided = this.failWhen?.(method, path);
        if (decided ?? this.failing.has(method)) {
            throw this.error;
        }
        return {} as T;
    }
}

/** 暴露 protected 成员的测试用 manager。 */
class TestManager extends BaseManager {
    public callWithRetry<T>(fn: () => Promise<T>, options?: RetryOptions | string): Promise<T> {
        return this.withRetry(fn, options ?? {});
    }

    public callRequest<T>(spec: RequestSpec): Promise<T> {
        return this.request<T>(spec);
    }

    public getRetryIdempotent(): boolean | undefined {
        return this.retryOptions.idempotent;
    }
}

describe("BaseManager.withRetry 幂等判定（S-8）", () => {
    let transport: FakeTransport;
    let manager: TestManager;

    beforeEach(() => {
        transport = new FakeTransport();
        // 注入 transport 后不会触碰 defaultHttpTransport，client 可为最小 mock。
        manager = new TestManager({} as unknown as MatrixClient, {
            transport,
            maxRetries: 3,
            retryDelay: 1,
        });
    });

    it("构造函数不预设 idempotent，留给方法推断", () => {
        expect(manager.getRetryIdempotent()).toBeUndefined();
    });

    it("POST 写请求失败时不重试（默认行为）", async () => {
        const fn = vi.fn(() => manager.callRequest({ method: Method.Post, path: "/friends" }));

        await expect(manager.callWithRetry(fn)).rejects.toBeInstanceOf(RetryableError);
        expect(transport.calls).toEqual([Method.Post]);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("PUT / DELETE 写请求失败时同样不重试", async () => {
        await expect(
            manager.callWithRetry(() => manager.callRequest({ method: Method.Put, path: "/x" })),
        ).rejects.toBeInstanceOf(RetryableError);
        expect(transport.calls).toEqual([Method.Put]);
    });

    it("GET 请求失败时仍然重试（幂等）", async () => {
        const fn = vi.fn(() => manager.callRequest({ method: Method.Get, path: "/friends" }));

        await expect(manager.callWithRetry(fn)).rejects.toBeInstanceOf(RetryableError);
        // 1 次首发 + 3 次重试
        expect(transport.calls).toHaveLength(4);
        expect(fn).toHaveBeenCalledTimes(4);
    });

    it("一次调用中只要出现任一写方法即不重试", async () => {
        // GET 成功、POST 失败：观测到 [GET, POST] 后应立即停止重试，
        // 而不是回到闭包开头把已成功的 GET 也重跑一遍。
        transport.failing.delete(Method.Get);

        await expect(
            manager.callWithRetry(async () => {
                await manager.callRequest({ method: Method.Get, path: "/a" });
                await manager.callRequest({ method: Method.Post, path: "/b" });
            }),
        ).rejects.toBeInstanceOf(RetryableError);
        expect(transport.calls).toEqual([Method.Get, Method.Post]);
    });

    it("显式 idempotent: true 时写请求仍可重试（逃生舱）", async () => {
        await expect(
            manager.callWithRetry(() => manager.callRequest({ method: Method.Post, path: "/x" }), {
                idempotent: true,
            }),
        ).rejects.toBeInstanceOf(RetryableError);
        expect(transport.calls).toHaveLength(4);
    });

    it("retryNonIdempotent: true 时写请求仍可重试", async () => {
        await expect(
            manager.callWithRetry(() => manager.callRequest({ method: Method.Post, path: "/x" }), {
                retryNonIdempotent: true,
            }),
        ).rejects.toBeInstanceOf(RetryableError);
        expect(transport.calls).toHaveLength(4);
    });

    it("未观测到 HTTP 方法时保持既有重试行为（避免可用性回归）", async () => {
        const fn = vi.fn(() => Promise.reject(new RetryableError("no http method observed")));

        await expect(manager.callWithRetry(fn)).rejects.toBeInstanceOf(RetryableError);
        expect(fn).toHaveBeenCalledTimes(4);
    });

    it("并发 withRetry 的方法观测互不干扰", async () => {
        const writeFn = vi.fn(() => manager.callRequest({ method: Method.Post, path: "/write" }));
        const readFn = vi.fn(() => manager.callRequest({ method: Method.Get, path: "/read" }));

        await Promise.all([
            expect(manager.callWithRetry(writeFn)).rejects.toBeInstanceOf(RetryableError),
            expect(manager.callWithRetry(readFn)).rejects.toBeInstanceOf(RetryableError),
        ]);

        // 写请求只发 1 次；读请求发 4 次（1 + 3 重试）
        expect(writeFn).toHaveBeenCalledTimes(1);
        expect(readFn).toHaveBeenCalledTimes(4);
        expect(transport.calls.filter((m) => m === Method.Post)).toHaveLength(1);
    });

    it("独立调用 request() 时 POST 不重试、GET 重试", async () => {
        await expect(manager.callRequest({ method: Method.Post, path: "/x" })).rejects.toBeInstanceOf(RetryableError);
        expect(transport.calls).toEqual([Method.Post]);

        transport.calls = [];
        await expect(manager.callRequest({ method: Method.Get, path: "/y" })).rejects.toBeInstanceOf(RetryableError);
        expect(transport.calls).toHaveLength(4);
    });

    // ── 429 / M_LIMIT_EXCEEDED：服务端在执行前就拒绝了，重试不会重复提交 ──
    //
    // S-8 的护栏目的是「避免写操作被重复提交」。限流响应意味着服务端**根本没有执行**
    // 该请求，因此对非幂等请求重试是安全的；若不重试，客户端会在限流窗口内直接失败。
    // 注意 5xx 不在此列：服务端可能已经提交，重试有重复写入风险。

    const rateLimited = (): RetryableError =>
        new RetryableError("rate limited", { httpStatus: 429, errcode: "M_LIMIT_EXCEEDED" });

    it("非幂等 POST 遇到 429 限流时重试（服务端未执行该请求）", async () => {
        transport.error = rateLimited();

        await expect(manager.callRequest({ method: Method.Post, path: "/friends" })).rejects.toBeInstanceOf(
            RetryableError,
        );
        // 1 次首发 + 3 次重试
        expect(transport.calls).toHaveLength(4);
        expect(transport.calls.every((m) => m === Method.Post)).toBe(true);
    });

    it("非幂等 PUT 遇到 M_LIMIT_EXCEEDED 时在 withRetry 路径同样重试", async () => {
        transport.error = new RetryableError("rate limited", { errcode: "M_LIMIT_EXCEEDED" });

        const fn = vi.fn(() => manager.callRequest({ method: Method.Put, path: "/rooms/x/summary" }));
        await expect(manager.callWithRetry(fn)).rejects.toBeInstanceOf(RetryableError);
        expect(fn).toHaveBeenCalledTimes(4);
        expect(transport.calls.every((m) => m === Method.Put)).toBe(true);
    });

    it("非幂等 POST 遇到 500 时仍然不重试（服务端可能已提交）", async () => {
        transport.error = new RetryableError("server error", { httpStatus: 500 });

        await expect(manager.callRequest({ method: Method.Post, path: "/friends" })).rejects.toBeInstanceOf(
            RetryableError,
        );
        expect(transport.calls).toEqual([Method.Post]);
    });

    it("闭包中已有写请求成功时，后续限流不触发整体重放（避免重复提交）", async () => {
        // 关键安全边界：withRetry 重试会重跑整个闭包，若闭包前半段已经成功写入，
        // 仅因后半段被限流就整体重放会造成重复提交。此处必须放弃重试。
        transport.failing.clear();
        transport.error = rateLimited();
        transport.failWhen = (_method, path) => (path === "/second" ? true : undefined);

        const first = vi.fn(() => manager.callRequest({ method: Method.Post, path: "/first" }));
        const second = vi.fn(() => manager.callRequest({ method: Method.Post, path: "/second" }));

        await expect(
            manager.callWithRetry(async () => {
                await first();
                await second();
            }),
        ).rejects.toBeInstanceOf(RetryableError);

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });
});
