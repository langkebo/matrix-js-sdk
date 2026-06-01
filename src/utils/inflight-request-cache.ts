/*
Copyright 2026 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { LRUCache } from "./lru-cache";

function isObject(value: unknown): value is Record<string, unknown> /* Dynamic: generic object type guard */ {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stableSerialize(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
    }

    if (isObject(value)) {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
    }

    return JSON.stringify(value);
}

export class InflightRequestCache<T> {
    private readonly inflight = new Map<string, Promise<T>>();

    public constructor(private readonly cache?: LRUCache<T>) {}

    public get(key: string): T | undefined {
        return this.cache?.get(key);
    }

    public async getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
        const cached = this.cache?.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const existing = this.inflight.get(key);
        if (existing) {
            return existing;
        }

        const request = Promise.resolve()
            .then(factory)
            .then((result) => {
                this.cache?.set(key, result);
                return result;
            })
            .catch((error) => {
                this.cache?.delete(key);
                throw error;
            })
            .finally(() => {
                this.inflight.delete(key);
            });

        this.inflight.set(key, request);
        return request;
    }

    public delete(key: string): void {
        this.cache?.delete(key);
        this.inflight.delete(key);
    }

    public clear(): void {
        this.cache?.clear();
        this.inflight.clear();
    }
}
