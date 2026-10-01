/*
 * 客户端级停止路径的定时器收口（阶段 3 · P3-3 的 T3.3）。
 *
 * `scripts/quality/check-timer-pairing.mjs` 只能静态证明"清理语句存在"，证明不了
 * "清理路径一定被走到"。这一组用例补后半句：`stopClientLifecycleServices` 必须真的把
 * 客户端级 interval、Room 级 sweep timer、CacheRegistry 的 purge timer 停掉，
 * 并且某个组件 stop() 抛错不能中断其余清理（否则一个坏 manager 就会让整机泄漏）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { stopClientLifecycleServices } from "../../src/client-lifecycle-stop";
import type { MatrixClient } from "../../src/client";

interface FakeRoom {
    roomId: string;
    disposeNotSentSweepTimer: () => void;
}

function makeClient(overrides: { rooms?: FakeRoom[]; managers?: unknown[] } = {}): {
    client: MatrixClient;
    clearIntervalSpy: ReturnType<typeof vi.spyOn>;
} {
    const client = {
        cryptoBackend: { stop: vi.fn() },
        syncApi: { stop: vi.fn() },
        peekSync: { stopPeeking: vi.fn() },
        callEventHandler: { stop: vi.fn() },
        groupCallEventHandler: { stop: vi.fn() },
        toDeviceMessageQueue: { stop: vi.fn() },
        matrixRTC: { stop: vi.fn() },
        serverCapabilitiesService: { stop: vi.fn() },
        getRooms: () => overrides.rooms ?? [],
        checkTurnServersIntervalID: 111,
        clientWellKnownIntervalID: 222,
    } as unknown as MatrixClient;

    // manager registry 是挂在 client 上的 symbol 键（见 client-infra/manager-registry.ts），
    // 这里直接注入，避免为了测停止路径去启动一整个 client
    if (overrides.managers !== undefined) {
        (client as unknown as Record<symbol, Map<string, unknown>>)[Symbol.for("matrix-js-sdk.manager-registry")] =
            new Map(overrides.managers.map((manager, index) => [`manager-${index}`, manager]));
    }

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    return { client, clearIntervalSpy };
}

describe("stopClientLifecycleServices 定时器收口", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("清掉客户端级两个 interval 句柄", () => {
        const { client, clearIntervalSpy } = makeClient();

        stopClientLifecycleServices(client);

        expect(clearIntervalSpy).toHaveBeenCalledWith(111);
        expect(clearIntervalSpy).toHaveBeenCalledWith(222);
    });

    it("clientWellKnownIntervalID 未设置时不调用 clearInterval(undefined)", () => {
        const { client, clearIntervalSpy } = makeClient();
        (client as unknown as { clientWellKnownIntervalID?: unknown }).clientWellKnownIntervalID = undefined;

        stopClientLifecycleServices(client);

        expect(clearIntervalSpy).not.toHaveBeenCalledWith(undefined);
        // checkTurnServers 没有 `!== undefined` 守卫，仍应被清理
        expect(clearIntervalSpy).toHaveBeenCalledWith(111);
    });

    it("逐个 Room 停掉 NOT_SENT sweep timer，且单个 Room 抛错不影响其余 Room", () => {
        const good = { roomId: "!good:test", disposeNotSentSweepTimer: vi.fn() };
        const broken = {
            roomId: "!broken:test",
            disposeNotSentSweepTimer: vi.fn(() => {
                throw new Error("boom");
            }),
        };
        const { client } = makeClient({ rooms: [broken, good] });

        expect(() => stopClientLifecycleServices(client)).not.toThrow();

        expect(broken.disposeNotSentSweepTimer).toHaveBeenCalledTimes(1);
        expect(good.disposeNotSentSweepTimer).toHaveBeenCalledTimes(1);
    });

    it("调用所有 manager 的 stop()，且单个 manager 抛错不影响其余 manager", () => {
        const broken = {
            stop: vi.fn(() => {
                throw new Error("manager boom");
            }),
        };
        const good = { stop: vi.fn() };
        const { client } = makeClient({ managers: [broken, good] });

        expect(() => stopClientLifecycleServices(client)).not.toThrow();

        expect(broken.stop).toHaveBeenCalledTimes(1);
        expect(good.stop).toHaveBeenCalledTimes(1);
    });

    it("幂等：连续停止两次不抛错（stopClient 之外的调用方也能安全重入）", () => {
        const { client } = makeClient();

        expect(() => {
            stopClientLifecycleServices(client);
            stopClientLifecycleServices(client);
        }).not.toThrow();
    });
});
