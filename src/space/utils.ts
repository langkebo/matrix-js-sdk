/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

/**
 * Space 共享纯函数辅助方法
 *
 * 提取自原 index.ts，被多个 sub-managers 共同消费（避免跨 sub-manager 访问私有方法）。
 */

import type { SpacePathPattern } from "./__generated__/route-table";
import type { Space, SpaceListResponse } from "./types";

type JsonObject = Record<string, unknown>; // Dynamic: arbitrary space child state content

export type StripV3<P extends string> = P extends `/_matrix/client/v3${infer Rest}` ? Rest : never;

export function sp<P extends StripV3<SpacePathPattern>>(path: P): P {
    return path;
}

export function spacePath(pathTemplate: string, spaceId: string): string {
    return sp(pathTemplate.replace("$spaceId", encodeURIComponent(spaceId)) as StripV3<SpacePathPattern>);
}

export function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeSpace(space: JsonObject = {}, fallbackId = ""): Space {
    const roomId = asString(space.room_id) || asString(space.space_id) || fallbackId;
    const joinRule = asString(space.join_rule);
    const visibility = asString(space.visibility);
    return {
        ...space,
        space_id: asString(space.space_id) || roomId,
        room_id: roomId,
        name: asString(space.name),
        topic: asString(space.topic),
        avatar_url: asString(space.avatar_url),
        creator: asString(space.creator),
        join_rule: joinRule,
        visibility,
        is_public: asBoolean(space.is_public) ?? (visibility === "public" || joinRule === "public"),
        created_ts: asNumber(space.created_ts),
        updated_ts: asNumber(space.updated_ts),
        parent_space_id: asString(space.parent_space_id),
    };
}

export function extractSpaces(response: unknown): Space[] {
    if (Array.isArray(response)) return response.map((item) => normalizeSpace(item as JsonObject));
    const payload = response as JsonObject;
    const rawList = payload.spaces ?? payload.chunk ?? payload.rooms ?? [];
    if (!Array.isArray(rawList)) return [];
    return rawList.map((item) => normalizeSpace(item as JsonObject));
}

export function normalizeSpaceListResponse(response: SpaceListResponse): SpaceListResponse {
    return { ...response, chunk: extractSpaces(response) };
}
