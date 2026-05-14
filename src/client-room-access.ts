import {
    EventType,
    RoomCreateTypeField,
    RoomType,
    UNSTABLE_MSC3088_ENABLED,
    UNSTABLE_MSC3088_PURPOSE,
    UNSTABLE_MSC3089_TREE_SUBTYPE,
} from "./@types/event";
import { KnownMembership } from "./@types/membership";
import { Preset } from "./@types/partials";
import type { ICreateRoomOpts, IGuestAccessOpts } from "./@types/requests";
import { DEFAULT_TREE_POWER_LEVELS_TEMPLATE, MSC3089TreeSpace } from "./models/MSC3089TreeSpace";
import type { Room } from "./models/room";

export function setGuestAccessRequest(
    roomId: string,
    opts: IGuestAccessOpts,
    sendGuestAccessState: (roomId: string, allowJoin: boolean) => Promise<unknown>,
    sendHistoryVisibilityWorldReadable: (roomId: string) => Promise<unknown>,
): Promise<void> {
    const writePromise = sendGuestAccessState(roomId, opts.allowJoin);

    let readPromise: Promise<unknown> = Promise.resolve();
    if (opts.allowRead) {
        readPromise = sendHistoryVisibilityWorldReadable(roomId);
    }

    return Promise.all([readPromise, writePromise]).then(); // .then() to hide results for contract
}

export async function createFileTreeSpaceRequest(
    name: string,
    getUserId: () => string | null,
    createRoom: (opts: ICreateRoomOpts) => Promise<{ room_id: string }>,
    createTreeSpace: (roomId: string) => MSC3089TreeSpace,
): Promise<MSC3089TreeSpace> {
    const { room_id: roomId } = await createRoom({
        name: name,
        preset: Preset.PrivateChat,
        power_level_content_override: {
            ...DEFAULT_TREE_POWER_LEVELS_TEMPLATE,
            users: {
                [getUserId()!]: 100,
            },
        },
        creation_content: {
            [RoomCreateTypeField]: RoomType.Space,
        },
        initial_state: [
            {
                type: UNSTABLE_MSC3088_PURPOSE.name,
                state_key: UNSTABLE_MSC3089_TREE_SUBTYPE.name,
                content: {
                    [UNSTABLE_MSC3088_ENABLED.name]: true,
                },
            },
            {
                type: EventType.RoomEncryption,
                state_key: "",
                content: {
                    algorithm: "m.megolm.v1.aes-sha2",
                },
            },
        ],
    });
    return createTreeSpace(roomId);
}

export function getFileTreeSpaceReference(
    roomId: string,
    getRoom: (roomId: string) => Room | null,
    createTreeSpace: (roomId: string) => MSC3089TreeSpace,
): MSC3089TreeSpace | null {
    const room = getRoom(roomId);
    if (room?.getMyMembership() !== KnownMembership.Join) return null;

    const createEvent = room.currentState.getStateEvents(EventType.RoomCreate, "");
    const purposeEvent = room.currentState.getStateEvents(
        UNSTABLE_MSC3088_PURPOSE.name,
        UNSTABLE_MSC3089_TREE_SUBTYPE.name,
    );

    if (!createEvent) throw new Error("Expected single room create event");

    if (!purposeEvent?.getContent()?.[UNSTABLE_MSC3088_ENABLED.name]) return null;
    if (createEvent.getContent()?.[RoomCreateTypeField] !== RoomType.Space) return null;

    return createTreeSpace(roomId);
}
