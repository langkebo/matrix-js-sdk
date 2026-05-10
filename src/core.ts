export { createClient, createRoomWidgetClient, setCryptoStoreFactory } from "./matrix";
export { MatrixClient, type ICreateClientOpts, ClientEvent, type IMatrixClientCreateOpts } from "./client";
export { PendingEventOrdering } from "./client-config-types";
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
export * from "./models/room-member";
export * from "./@types/PushRules";
export * from "./@types/membership";
export * from "./@types/search";
export * from "./@types/topic";
export * from "./@types/threepids";
export * from "./@types/read_receipts";
export { Visibility } from "./@types/partials";
export { Preset } from "./@types/partials";
export { Direction } from "./models/event-timeline";
export { TelemetryManager } from "./telemetry/index";
export { extendMatrixClientWithManagers, isManagerExtensionsInitialized } from "./manager-extensions/index";
