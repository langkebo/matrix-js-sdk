export { createClient, createRoomWidgetClient, setCryptoStoreFactory } from "./matrix";

export { MatrixClient, type ICreateClientOpts, ClientEvent, type IMatrixClientCreateOpts } from "./client";
export * from "./errors";
export * from "./http-api/index";
export * from "./http-api/prefix";
export * from "./http-api/method";

export * from "./models/event";
export * from "./models/room";
export * from "./models/thread";
export * from "./models/user";

export * from "./@types/event";
export type * from "./@types/events";
export * from "./@types/auth";
export * from "./@types/requests";
export * from "./@types/read_receipts";
