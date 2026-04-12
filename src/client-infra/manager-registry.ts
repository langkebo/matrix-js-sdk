import { MatrixClient } from "../client.ts";

const MANAGER_REGISTRY = Symbol.for("matrix-js-sdk.manager-registry");

type ManagerRegistryCarrier = MatrixClient & {
    [MANAGER_REGISTRY]?: Map<string, unknown>;
};

function getRegistry(client: MatrixClient): Map<string, unknown> {
    const carrier = client as ManagerRegistryCarrier;
    if (!carrier[MANAGER_REGISTRY]) {
        carrier[MANAGER_REGISTRY] = new Map<string, unknown>();
    }
    return carrier[MANAGER_REGISTRY];
}

export function getOrCreateManager<T>(client: MatrixClient, key: string, factory: () => T): T {
    const registry = getRegistry(client);
    const cached = registry.get(key);
    if (cached !== undefined) {
        return cached as T;
    }

    const manager = factory();
    registry.set(key, manager as unknown);
    return manager;
}

export function clearManagerRegistry(client: MatrixClient): void {
    getRegistry(client).clear();
}
