import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { createClient } from "../../src/matrix";
import { resetManagerExtensions } from "../../src/manager-extensions";
import {
    registerManagerClass,
    registerManagerFactory,
    clearManagerRegistry,
    clearManagerClassRegistry,
} from "../../src/client-infra/manager-registry";
import type { MatrixClient } from "../../src/client";

// Minimal test managers
class TestManager {
    public name = "test";
    constructor(_client: MatrixClient) {}
}

class OtherManager {
    public name = "other";
    constructor(_client: MatrixClient) {}
}

class SpecialManager {
    public name = "special";
    constructor(_client: MatrixClient, _extra: string) {}
}

describe("client.manager() accessor", () => {
    let client: MatrixClient;

    beforeEach(() => {
        client = createClient({
            baseUrl: "https://example.com",
            userId: "@alice:example.com",
            accessToken: "token",
            deviceId: "DEVICE_TEST",
        });
    });

    afterEach(() => {
        resetManagerExtensions();
        clearManagerRegistry(client);
        clearManagerClassRegistry();
    });

    // Helper: manager() is typed — use any to test runtime behavior with test classes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mgr = (c: MatrixClient, name: string): any => (c as any).manager(name);

    // ── Basic access ────────────────────────────────────────────

    it("returns a manager when a class has been registered", () => {
        registerManagerClass("auth", TestManager);

        const result = mgr(client, "auth");

        expect(result).toBeInstanceOf(TestManager);
        expect(result.name).toBe("test");
    });

    it("throws an error when no class or factory is registered", () => {
        expect(() => mgr(client, "auth")).toThrow(/No manager registered for "auth"/);
    });

    it("returns the same instance on repeated calls (singleton)", () => {
        registerManagerClass("auth", TestManager);

        const a = mgr(client, "auth");
        const b = mgr(client, "auth");

        expect(a).toBe(b);
    });

    // ── Factory override ────────────────────────────────────────

    it("uses factory over constructor when both are registered", () => {
        const factoryResult = new SpecialManager({} as MatrixClient, "extra");
        registerManagerClass("auth", TestManager);
        registerManagerFactory("auth", () => factoryResult);

        const result = mgr(client, "auth");

        expect(result).toBe(factoryResult);
        expect(result).not.toBeInstanceOf(TestManager);
    });

    it("uses factory when only factory is registered", () => {
        registerManagerFactory("auth", (c) => new SpecialManager(c as MatrixClient, "factory-arg"));

        const result = mgr(client, "auth");

        expect(result).toBeInstanceOf(SpecialManager);
        expect(result.name).toBe("special");
    });

    // ── Multiple managers ───────────────────────────────────────

    it("can register and retrieve multiple different managers", () => {
        registerManagerClass("auth", TestManager);
        registerManagerClass("admin", OtherManager);

        const auth = mgr(client, "auth");
        const admin = mgr(client, "admin");

        expect(auth).toBeInstanceOf(TestManager);
        expect(admin).toBeInstanceOf(OtherManager);
        expect(auth).not.toBe(admin);
    });

    // ── Typed access compiles and works ────────────────────────

    it("returns the singleton manager for a registered key", () => {
        // Register with a key that maps to the test class
        registerManagerClass("auth", TestManager);

        const mgr1 = client.manager("auth");
        const mgr2 = client.manager("auth");

        expect(mgr1).toBe(mgr2);
        expect(mgr1).toBeInstanceOf(TestManager);
    });
});
