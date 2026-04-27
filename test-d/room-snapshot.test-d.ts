import { expectType } from "tsd";

import { type RoomSnapshot, createRoomSnapshot } from "../lib/index";

const snapshot = createRoomSnapshot({
    roomId: "!room:example.org",
    name: "Room",
    normalizedName: "room",
    tags: {
        favourite: {
            order: 0.1,
        },
    },
    getMyMembership: () => "join",
    getType: () => "m.space",
    getPendingEvents: () => [],
});

expectType<RoomSnapshot>(snapshot);
