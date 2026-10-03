import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeTransport } from "../../test-utils/FakeTransport";
import { Method } from "../../../src/http-api/method";
import { ClientPrefix } from "../../../src/http-api/prefix";
import { UnsupportedAccountStatusEndpointError, ValidationError } from "../../../src/errors";

const PATH = "/org.matrix.msc3720/account_status";

describe("AccountStatusManager (MSC3720)", () => {
    let transport: FakeTransport;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let manager: any;

    beforeEach(async () => {
        transport = new FakeTransport();
        client = { doesServerAdvertiseSynapseRustFeature: vi.fn().mockResolvedValue(true) };
        const { AccountStatusManager } = await import("../../../src/account-status/index");
        manager = new AccountStatusManager(client, { transport });
    });

    it("POST 到 MSC3720 端点：body {user_ids} + unstable 前缀，响应原样返回", async () => {
        const response = {
            account_statuses: {
                "@alice:example.org": { locked: false, suspended: true },
                "@bob:example.org": { locked: false, suspended: false },
            },
        };
        transport.respondWith(response);

        await expect(manager.getAccountStatuses(["@alice:example.org", "@bob:example.org"])).resolves.toEqual(response);

        transport.expectCalledWithArgs(
            Method.Post,
            PATH,
            undefined,
            { user_ids: ["@alice:example.org", "@bob:example.org"] },
            { prefix: ClientPrefix.Unstable },
        );
    });

    it("远端失败时 failures 也原样返回（不吞错、不改形）", async () => {
        const response = {
            account_statuses: { "@alice:example.org": { locked: true } },
            failures: { "@remote:other.org": { errcode: "M_UNREACHABLE", error: "remote down" } },
        };
        transport.respondWith(response);

        await expect(manager.getAccountStatuses(["@alice:example.org", "@remote:other.org"])).resolves.toEqual(
            response,
        );
    });

    it("允许空数组（MSC 规定返回空对象，不是错误）", async () => {
        transport.respondWith({});

        await expect(manager.getAccountStatuses([])).resolves.toEqual({});

        transport.expectCalledWithArgs(
            Method.Post,
            PATH,
            undefined,
            { user_ids: [] },
            {
                prefix: ClientPrefix.Unstable,
            },
        );
    });

    it("参数不合法时抛 ValidationError 且不发请求", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(manager.getAccountStatuses("nope" as any)).rejects.toBeInstanceOf(ValidationError);
        await expect(manager.getAccountStatuses([""])).rejects.toBeInstanceOf(ValidationError);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(manager.getAccountStatuses([42 as any])).rejects.toBeInstanceOf(ValidationError);
        expect(transport.request).not.toHaveBeenCalled();
    });

    it("服务端未声明 capability 时 fail closed：抛错且不发请求", async () => {
        client.doesServerAdvertiseSynapseRustFeature.mockResolvedValue(false);

        await expect(manager.getAccountStatuses(["@alice:example.org"])).rejects.toBeInstanceOf(
            UnsupportedAccountStatusEndpointError,
        );
        expect(transport.request).not.toHaveBeenCalled();
    });

    it("探针缺失（老 client）时同样 fail closed（S-13：不乐观放行）", async () => {
        const { AccountStatusManager } = await import("../../../src/account-status/index");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bare = new AccountStatusManager({} as any, { transport });

        await expect(bare.isSupported()).resolves.toBe(false);
        await expect(bare.getAccountStatuses(["@alice:example.org"])).rejects.toBeInstanceOf(
            UnsupportedAccountStatusEndpointError,
        );
        expect(transport.request).not.toHaveBeenCalled();
    });

    it("探针抛错时也 fail closed（并调用 onError 记日志）", async () => {
        client.doesServerAdvertiseSynapseRustFeature.mockRejectedValue(new Error("capabilities unavailable"));

        await expect(manager.isSupported()).resolves.toBe(false);
        await expect(manager.getAccountStatuses(["@alice:example.org"])).rejects.toBeInstanceOf(
            UnsupportedAccountStatusEndpointError,
        );
    });

    it("后端关闭开关（403 M_FORBIDDEN）时原样抛出", async () => {
        transport.rejectWith(new Error("M_FORBIDDEN: msc3720 disabled"));

        await expect(manager.getAccountStatuses(["@alice:example.org"])).rejects.toThrow(/M_FORBIDDEN/);
    });
});
