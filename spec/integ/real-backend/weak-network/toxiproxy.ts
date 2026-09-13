/*
 * L4 弱网设施：toxiproxy 控制面封装（阶段 3 · P3-2）。
 *
 * 拓扑：
 *   SDK ──https://matrix.test:8666──> toxiproxy ──TCP──> synapse-nginx:443 ──> synapse-app:8008
 *
 * 容器由同目录的 `docker-compose.toxiproxy.yml` 起（挂在后端 compose 的网络上，
 * 所以容器内用 `synapse-nginx` 这个名字找上游）。toxiproxy 只转发 TCP，TLS 仍由 nginx
 * 终结，因此证书依旧是 matrix.test 那张，改端口不影响主机名校验。
 *
 * 未安装/未启动 toxiproxy 时 `isAvailable()` 返回 false，调用方据此 skip，而不是让
 * 整套 real-backend 用例变红（与 L2 spec 的 `backendAvailable` 约定一致）。
 */

declare const process: { env: Record<string, string | undefined> };

/** toxiproxy 2.12 支持的 toxic 类型（`loss` 不在其中，见 §30% 丢包如何模拟）。 */
export type ToxicType = "latency" | "reset_peer" | "slicer" | "timeout" | "bandwidth" | "limit_data" | "slow_close";

export interface ToxicSpec {
    name: string;
    type: ToxicType;
    attributes: Record<string, number>;
    /** `downstream` = 服务端→SDK（默认），`upstream` = SDK→服务端。 */
    stream?: "upstream" | "downstream";
    /** 生效概率（0~1）。1 = 每次连接都生效。 */
    toxicity?: number;
}

export interface ToxiproxyOptions {
    /** 控制面地址 */
    apiUrl?: string;
    /** 代理名（在 toxiproxy 内唯一） */
    proxyName?: string;
    /** 代理监听地址（容器内），需与 compose 里发布的端口一致 */
    listen?: string;
    /** 上游（后端 nginx 的容器名:端口） */
    upstream?: string;
}

export const TOXIPROXY_DEFAULTS = {
    apiUrl: process.env.TOXIPROXY_API_URL ?? "http://127.0.0.1:8474",
    proxyName: process.env.TOXIPROXY_PROXY_NAME ?? "matrix-l4",
    listen: process.env.TOXIPROXY_LISTEN ?? "0.0.0.0:8666",
    upstream: process.env.TOXIPROXY_UPSTREAM ?? "synapse-nginx:443",
};

/** L4 默认入口：SDK 的 baseUrl 应指向 `https://<host>:8666`。 */
export const L4_PROXY_PORT = 8666;

/**
 * 审计文档 §4 要求「30% 丢包 + 200ms 抖动」。
 *
 * toxiproxy 2.12 **没有 `loss` toxic**（`loss` / `toxicity` 作 type 都会返回
 * "invalid toxic type"，已实测），可用的是 latency / reset_peer / slicer / timeout /
 * bandwidth / limit_data / slow_close。这里用「约 30% 的新连接被 RST + 200ms 延迟 +
 * 100ms 抖动」等价表达。
 *
 * ⚠️ `reset_peer` 是**按连接**生效的，不是按请求：
 *   - curl（每次新连接）连打 20 次 → 失败 5 次（25%，符合 toxicity 0.3）；
 *   - SDK（复用 keep-alive 连接）发 8 条 → 一次都没触发。
 * 所以只靠 toxics 无法保证弱网用例真的走到重试路径，spec 里另加了**确定性断链窗口**
 * （关掉代理若干毫秒），并把「SDK 内部重试次数 > 0」作为断言，避免扰动失效时假绿。
 */
export const L4_TOXICS: ToxicSpec[] = [
    {
        name: "latency-200ms",
        type: "latency",
        attributes: { latency: 200, jitter: 100 },
        stream: "downstream",
    },
    {
        name: "reset-30pct",
        type: "reset_peer",
        attributes: { timeout: 0 },
        stream: "upstream",
        toxicity: 0.3,
    },
];

interface ProxyRecord {
    name: string;
    listen: string;
    upstream: string;
    enabled: boolean;
}

export class Toxiproxy {
    private readonly apiUrl: string;
    private readonly proxyName: string;
    private readonly listen: string;
    private readonly upstream: string;

    public constructor(options: ToxiproxyOptions = {}) {
        this.apiUrl = options.apiUrl ?? TOXIPROXY_DEFAULTS.apiUrl;
        this.proxyName = options.proxyName ?? TOXIPROXY_DEFAULTS.proxyName;
        this.listen = options.listen ?? TOXIPROXY_DEFAULTS.listen;
        this.upstream = options.upstream ?? TOXIPROXY_DEFAULTS.upstream;
    }

    /** 控制面是否在线（未起 toxiproxy 时返回 false，调用方应 skip）。 */
    public async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiUrl}/proxies`, {
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /** 幂等创建代理：已存在则先删掉重建，保证 listen/upstream 与当前配置一致。 */
    public async ensureProxy(): Promise<void> {
        const existing = await this.listProxies();
        if (existing[this.proxyName]) {
            await this.deleteProxy();
        }
        await this.request("POST", "/proxies", {
            name: this.proxyName,
            listen: this.listen,
            upstream: this.upstream,
            enabled: true,
        });
    }

    public async listProxies(): Promise<Record<string, ProxyRecord>> {
        const response = await this.request("GET", "/proxies");
        return (await response.json()) as Record<string, ProxyRecord>;
    }

    public async deleteProxy(): Promise<void> {
        await this.request("DELETE", `/proxies/${this.proxyName}`);
    }

    /** 断网/恢复：禁用代理等价于链路中断（TCP 直接拒连）。 */
    public async setEnabled(enabled: boolean): Promise<void> {
        await this.request("POST", `/proxies/${this.proxyName}`, { enabled });
    }

    public async addToxic(toxic: ToxicSpec): Promise<void> {
        await this.request("POST", `/proxies/${this.proxyName}/toxics`, {
            name: toxic.name,
            type: toxic.type,
            attributes: toxic.attributes,
            stream: toxic.stream ?? "downstream",
            toxicity: toxic.toxicity ?? 1,
        });
    }

    /** 清空所有 toxic 并重新启用代理（toxiproxy 官方 reset 语义）。 */
    public async reset(): Promise<void> {
        await this.request("POST", "/reset");
    }

    public async listToxics(): Promise<{ name: string; type: string; toxicity: number }[]> {
        const response = await this.request("GET", `/proxies/${this.proxyName}/toxics`);
        return (await response.json()) as { name: string; type: string; toxicity: number }[];
    }

    /**
     * 在给定 toxic 组合下执行 `run()`，无论成败都恢复链路。
     *
     * 恢复放在 finally 里是硬要求：用例失败时若把 30% 的连接重置留在容器里，
     * 后续所有 real-backend 用例都会被连累。
     */
    public async withToxics<T>(toxics: ToxicSpec[], run: () => Promise<T>): Promise<T> {
        await this.reset();
        for (const toxic of toxics) {
            await this.addToxic(toxic);
        }
        try {
            return await run();
        } finally {
            await this.reset();
        }
    }

    private async request(method: string, path: string, body?: unknown): Promise<Response> {
        const response = await fetch(`${this.apiUrl}${path}`, {
            method,
            headers: body === undefined ? undefined : { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`toxiproxy ${method} ${path} failed: ${response.status} ${text}`);
        }
        return response;
    }
}
