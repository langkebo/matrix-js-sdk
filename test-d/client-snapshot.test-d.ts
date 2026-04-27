import { expectType } from "tsd";

import { type MatrixClientSnapshot, createMatrixClientSnapshot } from "../lib/index";

const snapshot = createMatrixClientSnapshot({
    baseUrl: "https://matrix.example.org",
    clientRunning: true,
    getUserId: () => "@alice:example.org",
    getDeviceId: () => "DEVICE",
    supportsVoip: () => true,
});

expectType<MatrixClientSnapshot>(snapshot);
