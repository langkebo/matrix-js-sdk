/*
 * L4 弱网 helper 的负向测试（阶段 3 · P3-2）。
 *
 * 这个 helper 直接操纵真实的网络中间层，它的 bug 不会让用例变红，而是让用例**假绿**：
 * 代理没建成、toxic 没加上、失败后没恢复链路，三种情况都会表现为"消息都送达了"。
 * 这里用一个假 toxiproxy 控制面（node:http）把这些路径钉住。
 */

import http from "node:http";
import fetchMock from "@fetch-mock/vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Toxiproxy, type ToxicSpec } from "../integ/real-backend/weak-network/toxiproxy";

interface RecordedRequest {
    method: string;
    path: string;
    body?: unknown;
}

/** 极简的 toxiproxy 控制面替身：只实现 helper 用到的那几个端点。 */
class FakeToxiproxyServer {
    public readonly requests: RecordedRequest[] = [];
    public readonly proxies = new Map<string, Record<string, unknown>>();
    public readonly toxics = new Map<string, ToxicSpec>();
    /** 让指定端点返回错误，用于验证 helper 不会吞掉失败。 */
    public failNext: { status: number; path?: string } | null = null;

    private server: http.Server | null = null;
    public url = "";

    public async start(): Promise<void> {
        this.server = http.createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8");
                const body = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;
                const url = request.url ?? "/";
                this.requests.push({ method: request.method ?? "GET", path: url, body });

                const shouldFail =
                    this.failNext !== null && (this.failNext.path === undefined || this.failNext.path === url);
                if (shouldFail) {
                    const status = this.failNext!.status;
                    this.failNext = null;
                    response.writeHead(status, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ error: "injected" }));
                    return;
                }

                response.writeHead(200, { "Content-Type": "application/json" });
                if (url === "/proxies" && request.method === "GET") {
                    response.end(JSON.stringify(Object.fromEntries(this.proxies)));
                    return;
                }
                if (url === "/proxies" && request.method === "POST") {
                    const payload = body as { name: string };
                    this.proxies.set(payload.name, payload as unknown as Record<string, unknown>);
                    response.end(JSON.stringify(payload));
                    return;
                }
                if (url === "/reset") {
                    this.toxics.clear();
                    for (const proxy of this.proxies.values()) proxy.enabled = true;
                    response.end("{}");
                    return;
                }
                if (url.startsWith("/proxies/") && url.endsWith("/toxics") && request.method === "POST") {
                    const payload = body as ToxicSpec;
                    this.toxics.set(payload.name, payload);
                    response.end(JSON.stringify(payload));
                    return;
                }
                if (url.startsWith("/proxies/") && request.method === "POST") {
                    const name = url.split("/")[2];
                    const existing = this.proxies.get(name) ?? {};
                    this.proxies.set(name, { ...existing, ...(body as Record<string, unknown>) });
                    response.end(JSON.stringify(this.proxies.get(name)));
                    return;
                }
                if (url.startsWith("/proxies/") && request.method === "DELETE") {
                    this.proxies.delete(url.split("/")[2]);
                    response.end("{}");
                    return;
                }
                response.end("{}");
            });
        });

        await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
        const address = this.server!.address();
        if (address === null || typeof address === "string") throw new Error("no port");
        this.url = `http://127.0.0.1:${address.port}`;
    }

    public async stop(): Promise<void> {
        await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    }
}

describe("Toxiproxy helper", () => {
    let server: FakeToxiproxyServer | null = null;

    beforeEach(() => {
        // spec/setupTests.ts 在每个用例前把 fetch 换成 fetch-mock 的全局实现；
        // 这里要打真实的本机假控制面，所以先还原原生 fetch。
        fetchMock.unmockGlobal();
    });

    afterEach(async () => {
        await server?.stop();
        server = null;
    });

    it("控制面不在线时 isAvailable() 返回 false（调用方据此 skip 而不是让用例变红）", async () => {
        const proxy = new Toxiproxy({ apiUrl: "http://127.0.0.1:1" });

        await expect(proxy.isAvailable()).resolves.toBe(false);
    });

    it("ensureProxy() 幂等：已存在同名代理时先删后建", async () => {
        server = new FakeToxiproxyServer();
        await server.start();
        const proxy = new Toxiproxy({ apiUrl: server.url, proxyName: "matrix-l4" });

        await expect(proxy.isAvailable()).resolves.toBe(true);
        await proxy.ensureProxy();
        await proxy.ensureProxy();

        const deletes = server.requests.filter(
            (request) => request.method === "DELETE" && request.path === "/proxies/matrix-l4",
        );
        const creates = server.requests.filter((request) => request.method === "POST" && request.path === "/proxies");
        expect(creates).toHaveLength(2);
        // 第二次调用必须先删掉旧的，否则 listen/upstream 改了也不会生效
        expect(deletes).toHaveLength(1);
    });

    it("withToxics() 在回调抛错时也会恢复链路（否则后续用例全被连累）", async () => {
        server = new FakeToxiproxyServer();
        await server.start();
        const proxy = new Toxiproxy({ apiUrl: server.url, proxyName: "matrix-l4" });
        await proxy.ensureProxy();

        await expect(
            proxy.withToxics([{ name: "latency", type: "latency", attributes: { latency: 10 } }], async () => {
                // toxic 已注入
                expect(server!.toxics.has("latency")).toBe(true);
                throw new Error("用例自身失败");
            }),
        ).rejects.toThrow("用例自身失败");

        // finally 里的 reset 清空 toxic 并重新启用代理
        expect(server.toxics.size).toBe(0);
        expect(server.proxies.get("matrix-l4")?.enabled).toBe(true);
    });

    it("setEnabled(false) 会真的打到控制面（断链窗口依赖它）", async () => {
        server = new FakeToxiproxyServer();
        await server.start();
        const proxy = new Toxiproxy({ apiUrl: server.url, proxyName: "matrix-l4" });
        await proxy.ensureProxy();

        await proxy.setEnabled(false);

        expect(server.proxies.get("matrix-l4")?.enabled).toBe(false);
    });

    it("控制面返回非 2xx 时抛错，而不是静默继续（假绿防线）", async () => {
        server = new FakeToxiproxyServer();
        await server.start();
        const proxy = new Toxiproxy({ apiUrl: server.url, proxyName: "matrix-l4" });
        await proxy.ensureProxy();

        // toxic 加不上必须炸出来：否则"注入 30% 丢包"变成"什么都没注入"，
        // 用例依然全绿，而这正是这一层最容易出现的假绿。
        server.failNext = { status: 400, path: "/proxies/matrix-l4/toxics" };
        await expect(proxy.addToxic({ name: "loss", type: "reset_peer", attributes: { timeout: 0 } })).rejects.toThrow(
            /toxiproxy POST \/proxies\/matrix-l4\/toxics failed: 400/,
        );

        server.failNext = { status: 500, path: "/proxies" };
        await expect(proxy.ensureProxy()).rejects.toThrow(/toxiproxy (GET|POST) \/proxies failed: 500/);
    });
});
