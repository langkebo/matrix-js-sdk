import { describe, expect, it, vi } from "vitest";
import { EventType } from "../../src/@types/event";
import {
    findPredecessorRoomsForUpgrade,
    findSuccessorRoomsForUpgrade,
    buildRoomUpgradeHistory,
    selectVisibleRoomsForClient,
} from "../../src/client-room-upgrade";

describe("client-room-upgrade", () => {
    describe("findPredecessorRoomsForUpgrade", () => {
        it("should find predecessor chain", () => {
            const room3 = {
                roomId: "!room3:example.com",
                findPredecessor: vi.fn().mockReturnValue({ roomId: "!room2:example.com" }),
            } as any;

            const room2 = {
                roomId: "!room2:example.com",
                findPredecessor: vi.fn().mockReturnValue({ roomId: "!room1:example.com" }),
            } as any;

            const room1 = {
                roomId: "!room1:example.com",
                findPredecessor: vi.fn().mockReturnValue(undefined),
            } as any;

            const getRoom = vi.fn((roomId: string | undefined) => {
                if (roomId === "!room1:example.com") return room1;
                if (roomId === "!room2:example.com") return room2;
                return null;
            });

            const result = findPredecessorRoomsForUpgrade(room3, getRoom, false, false);

            expect(result).toHaveLength(2);
            expect(result[0].roomId).toBe("!room1:example.com");
            expect(result[1].roomId).toBe("!room2:example.com");
        });

        it("should return empty array when no predecessor", () => {
            const room = {
                roomId: "!room1:example.com",
                findPredecessor: vi.fn().mockReturnValue(undefined),
            } as any;

            const getRoom = vi.fn();

            const result = findPredecessorRoomsForUpgrade(room, getRoom, true, false);

            expect(result).toHaveLength(0);
        });

        it("should respect verifyLinks parameter", () => {
            const room2 = {
                roomId: "!room2:example.com",
                findPredecessor: vi.fn().mockReturnValue(undefined),
                currentState: {
                    getStateEvents: (type: string) => {
                        if (type === EventType.RoomTombstone) {
                            return { getContent: () => ({ replacement_room: "!wrong:example.com" }) };
                        }
                        return null;
                    },
                },
            } as any;

            const room1 = {
                roomId: "!room1:example.com",
                findPredecessor: vi.fn().mockReturnValue(undefined),
            } as any;

            const getRoom = vi.fn((roomId: string | undefined) => {
                if (roomId === "!room2:example.com") return room2;
                if (roomId === "!room1:example.com") return room1;
                return null;
            });

            const result = findPredecessorRoomsForUpgrade(room1, getRoom, true, false);

            // With verifyLinks=true, should not include room2 because replacement_room doesn't match
            expect(result).toHaveLength(0);
        });
    });

    describe("findSuccessorRoomsForUpgrade", () => {
        it("should find successor chain", () => {
            const room1 = {
                roomId: "!room1:example.com",
                currentState: {
                    getStateEvents: (type: string) => {
                        if (type === EventType.RoomTombstone) {
                            return { getContent: () => ({ replacement_room: "!room2:example.com" }) };
                        }
                        return null;
                    },
                },
            } as any;

            const room2 = {
                roomId: "!room2:example.com",
                findPredecessor: vi.fn().mockReturnValue({ roomId: "!room1:example.com" }),
                currentState: {
                    getStateEvents: (type: string) => {
                        if (type === EventType.RoomTombstone) {
                            return { getContent: () => ({ replacement_room: "!room3:example.com" }) };
                        }
                        return null;
                    },
                },
            } as any;

            const room3 = {
                roomId: "!room3:example.com",
                findPredecessor: vi.fn(),
                currentState: {
                    getStateEvents: () => null,
                },
            } as any;

            const getRoom = vi.fn((roomId: string | undefined) => {
                if (roomId === "!room2:example.com") return room2;
                if (roomId === "!room3:example.com") return room3;
                return null;
            });

            const result = findSuccessorRoomsForUpgrade(room1, getRoom, false, false);

            expect(result).toHaveLength(2);
            expect(result[1].roomId).toBe("!room3:example.com");
        });

        it("should return empty array when no successor", () => {
            const room = {
                roomId: "!room1:example.com",
                currentState: {
                    getStateEvents: () => null,
                },
            } as any;

            const getRoom = vi.fn();

            const result = findSuccessorRoomsForUpgrade(room, getRoom, false, false);

            expect(result).toHaveLength(0);
        });
    });

    describe("buildRoomUpgradeHistory", () => {
        it("should return combined history", () => {
            const room1 = {
                roomId: "!room1:example.com",
                findPredecessor: vi.fn().mockReturnValue(undefined),
                currentState: { getStateEvents: () => null },
            } as any;

            const room2 = {
                roomId: "!room2:example.com",
                findPredecessor: vi.fn().mockReturnValue({ roomId: "!room1:example.com" }),
                currentState: {
                    getStateEvents: (type: string) => {
                        if (type === EventType.RoomTombstone) {
                            return { getContent: () => ({ replacement_room: "!room3:example.com" }) };
                        }
                        return null;
                    },
                },
            } as any;

            const room3 = {
                roomId: "!room3:example.com",
                findPredecessor: vi.fn().mockReturnValue(undefined),
                currentState: { getStateEvents: () => null },
            } as any;

            const getRoom = vi.fn((roomId: string | undefined) => {
                if (roomId === "!room1:example.com") return room1;
                if (roomId === "!room2:example.com") return room2;
                if (roomId === "!room3:example.com") return room3;
                return null;
            });

            const result = buildRoomUpgradeHistory("!room2:example.com", getRoom, false, false);

            expect(result).toHaveLength(3);
            expect(result[0].roomId).toBe("!room1:example.com");
            expect(result[1].roomId).toBe("!room2:example.com");
            expect(result[2].roomId).toBe("!room3:example.com");
        });

        it("should return empty array when room not found", () => {
            const getRoom = vi.fn().mockReturnValue(null);

            const result = buildRoomUpgradeHistory("!nonexistent:example.com", getRoom, false, false);

            expect(result).toHaveLength(0);
        });
    });

    describe("selectVisibleRoomsForClient", () => {
        it("should exclude predecessor rooms", () => {
            const room1 = {
                roomId: "!room1:example.com",
                findPredecessor: vi.fn().mockReturnValue(undefined),
                currentState: {
                    getStateEvents: () => ({
                        getContent: () => ({ replacement_room: "!room2:example.com" }),
                    }),
                },
            } as any;

            const room2 = {
                roomId: "!room2:example.com",
                findPredecessor: vi.fn().mockReturnValue({ roomId: "!room1:example.com" }),
                currentState: { getStateEvents: () => null },
            } as any;

            const getRoom = vi.fn((roomId: string | undefined) => {
                if (roomId === "!room1:example.com") return room1;
                if (roomId === "!room2:example.com") return room2;
                return null;
            });

            const result = selectVisibleRoomsForClient([room1, room2], getRoom, false);

            // room1 is predecessor of room2, so only room2 should be visible
            expect(result).toHaveLength(1);
            expect(result[0].roomId).toBe("!room2:example.com");
        });

        it("should keep all rooms when none have predecessors", () => {
            const room1 = {
                roomId: "!room1:example.com",
                findPredecessor: vi.fn().mockReturnValue(undefined),
            } as any;

            const room2 = {
                roomId: "!room2:example.com",
                findPredecessor: vi.fn().mockReturnValue(undefined),
            } as any;

            const getRoom = vi.fn();

            const result = selectVisibleRoomsForClient([room1, room2], getRoom, false);

            expect(result).toHaveLength(2);
        });
    });
});
