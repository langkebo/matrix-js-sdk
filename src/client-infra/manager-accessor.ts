import { MatrixClient } from "../client";
import {
    getOrCreateManager,
    getManagerClass,
    getManagerFactory,
    type ManagerName,
    type ManagerTypeMap,
} from "./manager-registry";

declare module "../client" {
    interface MatrixClient {
        manager<K extends ManagerName>(name: K): ManagerTypeMap[K];
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.manager = function <K extends ManagerName>(name: K): ManagerTypeMap[K] {
        // Try factory first (for managers with non-standard constructors, e.g. admin sub-managers)
        const factory = getManagerFactory(name);
        if (factory) {
            return getOrCreateManager(this, name, () => factory(this)) as ManagerTypeMap[K];
        }

        // Try class constructor
        const Ctor = getManagerClass(name);
        if (!Ctor) {
            throw new Error(
                `No manager registered for "${name}". ` +
                    `Ensure the corresponding extendMatrixClient() has been called before using client.manager().`,
            );
        }

        return getOrCreateManager(this, name, () => new Ctor(this)) as ManagerTypeMap[K];
    };
}
