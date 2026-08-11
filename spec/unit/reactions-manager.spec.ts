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

import { describe, it, expect, beforeEach, vi } from "vitest";

import { ReactionsManager } from "../../src/reactions";
import { RelationType, EventType } from "../../src/@types/event";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

function makeReactionEvent(sender: string, key: string): AnyMock {
    return {
        getSender: vi.fn(() => sender),
        getRelation: vi.fn(() => ({ rel_type: RelationType.Annotation, key })),
        getType: vi.fn(() => EventType.Reaction),
        getId: vi.fn(() => `$reaction:${sender}:${key}`),
    };
}

describe("ReactionsManager", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockClient: any;
    let manager: ReactionsManager;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let relationsMap: Map<string, any>;

    beforeEach(() => {
        relationsMap = new Map();

        mockClient = {
            getUserId: vi.fn(() => "@me:hs"),
            getRoom: vi.fn((roomId: string) => ({
                relations: {
                    getChildEventsForEvent: vi.fn((eventId: string) => relationsMap.get(eventId)),
                },
            })),
            // These should NEVER be called by the manager — calling them would
            // create an infinite recursion (client.getReactionUsers -> manager.getReactionUsers -> ...).
            getReactionUsers: vi.fn(),
            hasReaction: vi.fn(),
        };

        manager = new ReactionsManager(mockClient);
    });

    describe("hasReaction (no recursion)", () => {
        it("returns true when the user has reacted with the given key", async () => {
            relationsMap.set("$msg1", {
                getRelations: () => [makeReactionEvent("@alice:hs", "👍"), makeReactionEvent("@me:hs", "👍")],
            });

            await expect(manager.hasReaction("!r:hs", "$msg1", "@me:hs", "👍")).resolves.toBe(true);
            // Must NOT delegate back to client (would cause infinite recursion)
            expect(mockClient.hasReaction).not.toHaveBeenCalled();
        });

        it("returns false when the user has not reacted with the given key", async () => {
            relationsMap.set("$msg1", {
                getRelations: () => [makeReactionEvent("@alice:hs", "👍")],
            });

            await expect(manager.hasReaction("!r:hs", "$msg1", "@me:hs", "👍")).resolves.toBe(false);
            expect(mockClient.hasReaction).not.toHaveBeenCalled();
        });

        it("returns false when the user reacted with a different key", async () => {
            relationsMap.set("$msg1", {
                getRelations: () => [makeReactionEvent("@me:hs", "❤️")],
            });

            await expect(manager.hasReaction("!r:hs", "$msg1", "@me:hs", "👍")).resolves.toBe(false);
        });

        it("returns false when room is not found", async () => {
            mockClient.getRoom = vi.fn(() => null);

            await expect(manager.hasReaction("!r:hs", "$msg1", "@me:hs", "👍")).resolves.toBe(false);
        });
    });

    describe("getReactionUsers (no recursion)", () => {
        it("returns de-duplicated sender list", async () => {
            relationsMap.set("$msg1", {
                getRelations: () => [
                    makeReactionEvent("@alice:hs", "👍"),
                    makeReactionEvent("@bob:hs", "👍"),
                    makeReactionEvent("@alice:hs", "❤️"), // duplicate sender, different key
                ],
            });

            await expect(manager.getReactionUsers("!r:hs", "$msg1")).resolves.toEqual([
                "@alice:hs",
                "@bob:hs",
            ]);
            expect(mockClient.getReactionUsers).not.toHaveBeenCalled();
        });

        it("returns empty array when room is not found", async () => {
            mockClient.getRoom = vi.fn(() => null);

            await expect(manager.getReactionUsers("!r:hs", "$msg1")).resolves.toEqual([]);
        });

        it("returns empty array when no reactions exist", async () => {
            relationsMap.set("$msg1", { getRelations: () => [] });

            await expect(manager.getReactionUsers("!r:hs", "$msg1")).resolves.toEqual([]);
        });
    });
});
