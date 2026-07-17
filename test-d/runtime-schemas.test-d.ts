import { expectType } from "tsd";

import {
    type MatrixEvent,
    type MatrixEventWire,
    type MatrixEventSnapshot,
    matrixEventWireSchema,
    parseMatrixEventWire,
    createMatrixEventSnapshot,
} from "../lib/index";

const wireEvent = parseMatrixEventWire({
    event_id: "$event",
    type: "m.room.message",
    content: {
        body: "hello",
        msgtype: "m.text",
    },
    sender: "@alice:example.org",
    room_id: "!room:example.org",
    origin_server_ts: 1,
    unsigned: {},
});

expectType<MatrixEventWire>(wireEvent);
expectType<MatrixEventWire>(matrixEventWireSchema.parse(wireEvent));

const snapshot = createMatrixEventSnapshot({
    getId: () => "$event",
    getRoomId: () => "!room:example.org",
    getType: () => "m.room.message",
    getSender: () => "@alice:example.org",
    getTs: () => 1,
    getStateKey: () => undefined,
    getContent: (() => ({
        body: "hello",
        msgtype: "m.text",
    })) as MatrixEvent["getContent"],
    getUnsigned: () => ({}),
});

expectType<MatrixEventSnapshot>(snapshot);
