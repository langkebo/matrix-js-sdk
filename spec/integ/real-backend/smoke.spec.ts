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

import { beforeAll, describe, expect, it } from "vitest";

import type { Capabilities } from "../../../src/serverCapabilities";
import type { IServerVersions } from "../../../src/client-api-types";
import {
    isCapabilityEnabled,
    isUnstableFeatureEnabled,
    resolveSynapseRustFeatureSupport,
    SynapseRustFeature,
    type SynapseRustFeatureName,
} from "../../../src/server-capabilities";
import { TestConfig } from "./TestConfig";
import { localpartFromMxid } from "./auth-test-helpers";

type FeatureProbe = {
    key: keyof ReturnType<typeof resolveSynapseRustFeatureSupport>;
    label: string;
    feature: SynapseRustFeatureName;
    capabilityAliases: string[];
};

const CORE_HULA_FEATURES: FeatureProbe[] = [
    {
        key: "extendedProfile",
        label: "extended-profile",
        feature: SynapseRustFeature.ExtendedProfile,
        capabilityAliases: [],
    },
    {
        key: "slidingSync",
        label: "sliding-sync",
        feature: SynapseRustFeature.SlidingSync,
        capabilityAliases: ["io.hula.sliding_sync"],
    },
    {
        key: "dehydratedDevice",
        label: "dehydrated-device",
        feature: SynapseRustFeature.DehydratedDevice,
        capabilityAliases: [],
    },
    {
        key: "widget",
        label: "widget",
        feature: SynapseRustFeature.Widget,
        capabilityAliases: ["io.hula.widget"],
    },
    {
        key: "burnAfterRead",
        label: "burn-after-read",
        feature: SynapseRustFeature.BurnAfterRead,
        capabilityAliases: ["io.hula.burn_after_read"],
    },
    {
        key: "friends",
        label: "friends",
        feature: SynapseRustFeature.Friends,
        capabilityAliases: ["io.hula.friends"],
    },
    {
        key: "voice",
        label: "voice",
        feature: SynapseRustFeature.Voice,
        capabilityAliases: ["m.voice", "io.hula.voice_extended"],
    },
    {
        key: "openClaw",
        label: "openclaw",
        feature: SynapseRustFeature.OpenClaw,
        capabilityAliases: ["openclaw"],
    },
    {
        key: "aiConnection",
        label: "ai-connection",
        feature: SynapseRustFeature.AIConnection,
        capabilityAliases: ["ai_connection"],
    },
];

const SMOKE_TIMEOUT_MS = 3000;

function requestUrl(path: string): string {
    return new URL(path, TestConfig.baseUrl).toString();
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has("accept")) {
        headers.set("accept", "application/json");
    }
    const controller = init.signal ? undefined : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), SMOKE_TIMEOUT_MS) : undefined;

    try {
        const response = await fetch(requestUrl(path), {
            ...init,
            signal: init.signal ?? controller?.signal,
            headers,
        });

        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }

        return (await response.json()) as T;
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

async function loginOnce(): Promise<string> {
    const response = await fetchJson<{ access_token: string }>("/_matrix/client/v3/login", {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({
            type: "m.login.password",
            user: localpartFromMxid(TestConfig.testUser.userId),
            password: TestConfig.testUser.password,
            device_id: TestConfig.testUser.deviceId,
        }),
    });

    return response.access_token;
}

function summarizeVersions(versions: IServerVersions): Record<string, unknown> {
    const unstableFeatures = versions.unstable_features ?? {};
    return {
        versions: versions.versions,
        unstable_feature_count: Object.keys(unstableFeatures).length,
        enabled_unstable_features: Object.keys(unstableFeatures)
            .filter((feature) => unstableFeatures[feature] === true)
            .sort(),
    };
}

function summarizeCapabilities(capabilities: Capabilities | undefined): Record<string, unknown> {
    if (!capabilities) {
        return { available: false };
    }

    return {
        available: true,
        keys: Object.keys(capabilities).sort(),
    };
}

function buildFeatureMatrix(versions: IServerVersions, capabilities: Capabilities | undefined): Record<string, unknown>[] {
    const resolved = resolveSynapseRustFeatureSupport(versions, capabilities);

    return CORE_HULA_FEATURES.map((probe) => {
        const capabilityEvidence = probe.capabilityAliases.some((capability) =>
            isCapabilityEnabled(capabilities, capability),
        );
        return {
            feature: probe.label,
            unstable_feature: probe.feature,
            versions: isUnstableFeatureEnabled(versions, probe.feature),
            capabilities: capabilityEvidence,
            resolved: resolved[probe.key],
        };
    });
}

function writeDiagnostic(label: string, value: unknown): void {
    process.stdout.write(`[real-backend smoke] ${label} ${JSON.stringify(value, null, 2)}\n`);
}

function writeFeatureMatrix(rows: ReturnType<typeof buildFeatureMatrix>): void {
    process.stdout.write("[real-backend smoke] core Hula extension matrix\n");
    process.stdout.write("feature             versions  capabilities  resolved  unstable_feature\n");
    process.stdout.write("-----------------------------------------------------------------------\n");
    for (const row of rows) {
        const feature = String(row.feature).padEnd(19);
        const versions = String(row.versions).padEnd(8);
        const capabilities = String(row.capabilities).padEnd(12);
        const resolved = String(row.resolved).padEnd(8);
        process.stdout.write(`${feature} ${versions}  ${capabilities}  ${resolved}  ${row.unstable_feature}\n`);
    }
}

describe("real-backend smoke diagnostics", () => {
    let versions: IServerVersions | undefined;
    let capabilities: Capabilities | undefined;
    let backendAvailable = false;

    beforeAll(async () => {
        try {
            versions = await fetchJson<IServerVersions>("/_matrix/client/versions");
            backendAvailable = true;
            try {
                const accessToken = await loginOnce();
                const response = await fetchJson<{ capabilities: Capabilities }>("/_matrix/client/v3/capabilities", {
                    headers: {
                        authorization: `Bearer ${accessToken}`,
                    },
                });
                capabilities = response.capabilities;
            } catch (error) {
                writeDiagnostic("/capabilities probe failed:", (error as Error).message);
            }
        } catch (error) {
            writeDiagnostic(`backend unavailable at ${TestConfig.baseUrl}:`, (error as Error).message);
        }
    }, TestConfig.timeout.short);

    it("prints /versions, /capabilities, and core Hula extension support", () => {
        if (!backendAvailable || !versions) {
            return;
        }

        writeDiagnostic("/_matrix/client/versions", summarizeVersions(versions));
        writeDiagnostic("/_matrix/client/v3/capabilities", summarizeCapabilities(capabilities));
        writeFeatureMatrix(buildFeatureMatrix(versions, capabilities));

        expect(versions.versions).toEqual(expect.any(Array));
    });
});
