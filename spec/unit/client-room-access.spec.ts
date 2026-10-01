import { describe, expect, it, vi } from "vitest";
import {
    setGuestAccessRequest,
    createFileTreeSpaceRequest,
    getFileTreeSpaceReference,
} from "../../src/client-room-access";
import { Preset } from "../../src/@types/partials";
import { KnownMembership } from "../../src/@types/membership";
import { EventType, RoomCreateTypeField, RoomType } from "../../src/@types/event";
import { UNSTABLE_MSC3088_ENABLED, UNSTABLE_MSC3088_PURPOSE, UNSTABLE_MSC3089_TREE_SUBTYPE } from "../../src/@types/event";
import type { Room } from "../../src/models/room";
import { MSC3089TreeSpace } from "../../src/models/MSC3089TreeSpace";
import type { MatrixClient } from "../../src/client";

describe("client-room-access", () => {
    describe("setGuestAccessRequest", () => {
        it("should call both sendGuestAccessState and sendHistoryVisibilityWorldReadable when allowRead is true", async () => {
            const roomId = "!room:example.com";
            const opts = { allowJoin: true, allowRead: true };
            
            const sendGuestAccessState = vi.fn().mockResolvedValue(undefined);
            const sendHistoryVisibilityWorldReadable = vi.fn().mockResolvedValue(undefined);
            
            await setGuestAccessRequest(roomId, opts, sendGuestAccessState, sendHistoryVisibilityWorldReadable);
            
            expect(sendGuestAccessState).toHaveBeenCalledWith(roomId, true);
            expect(sendHistoryVisibilityWorldReadable).toHaveBeenCalledWith(roomId);
        });

        it("should only call sendGuestAccessState when allowRead is false", async () => {
            const roomId = "!room:example.com";
            const opts = { allowJoin: false, allowRead: false };
            
            const sendGuestAccessState = vi.fn().mockResolvedValue(undefined);
            const sendHistoryVisibilityWorldReadable = vi.fn().mockResolvedValue(undefined);
            
            await setGuestAccessRequest(roomId, opts, sendGuestAccessState, sendHistoryVisibilityWorldReadable);
            
            expect(sendGuestAccessState).toHaveBeenCalledWith(roomId, false);
            expect(sendHistoryVisibilityWorldReadable).not.toHaveBeenCalled();
        });

        it("should wait for both promises to complete", async () => {
            const roomId = "!room:example.com";
            const opts = { allowJoin: true, allowRead: true };
            
            let firstComplete = false;
            const sendGuestAccessState = vi.fn().mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                firstComplete = true;
            });
            const sendHistoryVisibilityWorldReadable = vi.fn().mockResolvedValue(undefined);
            
            await setGuestAccessRequest(roomId, opts, sendGuestAccessState, sendHistoryVisibilityWorldReadable);
            
            expect(firstComplete).toBe(true);
        });
    });

    describe("createFileTreeSpaceRequest", () => {
        it("should create a file tree space with correct parameters", async () => {
            const name = "Test File Space";
            const userId = "@user:example.com";
            const getUserId = () => userId;
            
            const createdRoom: { room_id: string } = { room_id: "!fileroom:example.com" };
            const createRoom = vi.fn().mockResolvedValue(createdRoom);
            
            // Create a mock client with getRoom
            const mockClient = {
                getRoom: vi.fn().mockReturnValue({ roomId: "!fileroom:example.com" }),
            } as unknown as MatrixClient;
            
            const createdTreeSpace = new MSC3089TreeSpace(mockClient, "!fileroom:example.com");
            const createTreeSpace = vi.fn().mockReturnValue(createdTreeSpace);
            
            const result = await createFileTreeSpaceRequest(name, getUserId, createRoom, createTreeSpace);
            
            expect(createRoom).toHaveBeenCalledOnce();
            const createOpts = createRoom.mock.calls[0][0];
            
            expect(createOpts.name).toBe(name);
            expect(createOpts.preset).toBe(Preset.PrivateChat);
            expect(createOpts.creation_content?.[RoomCreateTypeField]).toBe(RoomType.Space);
            expect(createOpts.power_level_content_override?.users?.[userId]).toBe(100);
            
            expect(result).toBe(createdTreeSpace);
        });

        it("should include encryption state in initial_state", async () => {
            const name = "Encrypted Space";
            const getUserId = () => "@user:example.com";
            
            const createdRoom = { room_id: "!encrypted:example.com" };
            const createRoom = vi.fn().mockResolvedValue(createdRoom);
            
            const mockClient = {
                getRoom: vi.fn().mockReturnValue({ roomId: "!encrypted:example.com" }),
            } as unknown as MatrixClient;
            
            const createTreeSpace = vi.fn().mockReturnValue(new MSC3089TreeSpace(mockClient, "!encrypted:example.com"));
            
            await createFileTreeSpaceRequest(name, getUserId, createRoom, createTreeSpace);
            
            const createOpts = createRoom.mock.calls[0][0];
            const encryptionEvent = createOpts.initial_state.find(
                (e: any) => e.type === EventType.RoomEncryption
            );
            
            expect(encryptionEvent).toBeDefined();
            expect(encryptionEvent.content.algorithm).toBe("m.megolm.v1.aes-sha2");
        });

        it("should include MSC3088 purpose state", async () => {
            const name = "Purpose Space";
            const getUserId = () => "@user:example.com";
            
            const createRoom = vi.fn().mockResolvedValue({ room_id: "!purpose:example.com" });
            
            const mockClient = {
                getRoom: vi.fn().mockReturnValue({ roomId: "!purpose:example.com" }),
            } as unknown as MatrixClient;
            
            const createTreeSpace = vi.fn().mockReturnValue(new MSC3089TreeSpace(mockClient, "!purpose:example.com"));
            
            await createFileTreeSpaceRequest(name, getUserId, createRoom, createTreeSpace);
            
            const createOpts = createRoom.mock.calls[0][0];
            const purposeEvent = createOpts.initial_state.find(
                (e: any) => e.type === UNSTABLE_MSC3088_PURPOSE.name
            );
            
            expect(purposeEvent).toBeDefined();
            expect(purposeEvent.state_key).toBe(UNSTABLE_MSC3089_TREE_SUBTYPE.name);
            expect(purposeEvent.content?.[UNSTABLE_MSC3088_ENABLED.name]).toBe(true);
        });
    });

    describe("getFileTreeSpaceReference", () => {
        it("should return null when room membership is not join", () => {
            const roomId = "!room:example.com";
            
            const mockRoom = {
                getMyMembership: () => KnownMembership.Leave,
            } as unknown as Room;
            
            const getRoom = vi.fn().mockReturnValue(mockRoom);
            const createTreeSpace = vi.fn();
            
            const result = getFileTreeSpaceReference(roomId, getRoom, createTreeSpace);
            
            expect(result).toBeNull();
            expect(createTreeSpace).not.toHaveBeenCalled();
        });

        it("should throw when room create event is missing", () => {
            const roomId = "!room:example.com";
            
            const mockRoom = {
                getMyMembership: () => KnownMembership.Join,
                currentState: {
                    getStateEvents: vi.fn().mockReturnValue(null),
                },
            } as unknown as Room;
            
            const getRoom = vi.fn().mockReturnValue(mockRoom);
            const createTreeSpace = vi.fn();
            
            expect(() => getFileTreeSpaceReference(roomId, getRoom, createTreeSpace)).toThrow("Expected single room create event");
        });

        it("should return null when purpose event is disabled", () => {
            const roomId = "!room:example.com";
            
            const mockRoom = {
                getMyMembership: () => KnownMembership.Join,
                currentState: {
                    getStateEvents: vi.fn((type: string) => {
                        if (type === EventType.RoomCreate) {
                            return {
                                getContent: () => ({ [RoomCreateTypeField]: RoomType.Space }),
                            };
                        }
                        return null;
                    }),
                },
            } as unknown as Room;
            
            const getRoom = vi.fn().mockReturnValue(mockRoom);
            const createTreeSpace = vi.fn();
            
            const result = getFileTreeSpaceReference(roomId, getRoom, createTreeSpace);
            
            expect(result).toBeNull();
        });

        it("should return null when room type is not space", () => {
            const roomId = "!room:example.com";
            
            const mockRoom = {
                getMyMembership: () => KnownMembership.Join,
                currentState: {
                    getStateEvents: vi.fn((type: string, stateKey: string) => {
                        if (type === EventType.RoomCreate) {
                            // 普通房间（非 Space）没有 room type 字段 → 应返回 null
                            return {
                                getContent: () => ({}),
                            };
                        }
                        if (stateKey === UNSTABLE_MSC3089_TREE_SUBTYPE.name) {
                            return {
                                getContent: () => ({ [UNSTABLE_MSC3088_ENABLED.name]: true }),
                            };
                        }
                        return null;
                    }),
                },
            } as unknown as Room;
            
            const getRoom = vi.fn().mockReturnValue(mockRoom);
            const createTreeSpace = vi.fn();
            
            const result = getFileTreeSpaceReference(roomId, getRoom, createTreeSpace);
            
            expect(result).toBeNull();
        });

        it("should return MSC3089TreeSpace when all conditions are met", () => {
            const roomId = "!room:example.com";
            
            const mockRoom = {
                getMyMembership: () => KnownMembership.Join,
                currentState: {
                    getStateEvents: vi.fn((type: string, stateKey: string) => {
                        if (type === EventType.RoomCreate) {
                            return {
                                getContent: () => ({ [RoomCreateTypeField]: RoomType.Space }),
                            };
                        }
                        if (type === UNSTABLE_MSC3088_PURPOSE.name && stateKey === UNSTABLE_MSC3089_TREE_SUBTYPE.name) {
                            return {
                                getContent: () => ({ [UNSTABLE_MSC3088_ENABLED.name]: true }),
                            };
                        }
                        return null;
                    }),
                },
            } as unknown as Room;
            
            // Create a minimal mock client with getRoom
            const mockClient = {
                getRoom: vi.fn().mockReturnValue(mockRoom),
            } as unknown as MatrixClient;
            
            const getRoom = vi.fn().mockReturnValue(mockRoom);
            const createTreeSpace = vi.fn().mockImplementation((rid: string) => new MSC3089TreeSpace(mockClient, rid));
            
            const result = getFileTreeSpaceReference(roomId, getRoom, createTreeSpace);
            
            expect(result).toBeDefined();
            expect(createTreeSpace).toHaveBeenCalledWith(roomId);
        });

        it("should handle null getRoom result", () => {
            const roomId = "!nonexistent:example.com";
            
            const getRoom = vi.fn().mockReturnValue(null);
            const createTreeSpace = vi.fn();
            
            const result = getFileTreeSpaceReference(roomId, getRoom, createTreeSpace);
            
            expect(result).toBeNull();
        });
    });
});
