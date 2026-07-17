/**
 * Re-export aggregator for internal request builders used by MatrixClient.
 *
 * Only re-exports that are actually consumed by `src/client.ts` are listed here.
 * Other request builders in `client-*-requests.ts` files have been superseded
 * by manager methods and are no longer re-exported; they remain in their source
 * files for backwards compatibility but are not part of the active call graph.
 */

// Used by client.ts: room member listing, room directory, alias management, etc.
export {
    getJoinedRoomMembersRequest,
    getJoinedRoomsRequest,
    getOpenIdTokenRequest,
    membersRequest,
    publicRoomsRequest,
} from "./client-batch-requests";

// Used by client.ts: room key request lifecycle.
export {
    deleteRoomKeyRequestHttpRequest,
    getRoomKeyRequestsHttpRequest,
    requestRoomKeyHttpRequest,
} from "./client-crypto-requests";

// Used by client.ts: room discovery (timestamp-to-event, space hierarchy).
export { timestampToEventRequest } from "./client-room-discovery-requests";

// Used by client.ts: secure backup lifecycle.
export {
    createSecureBackupRequest,
    deleteSecureBackupRequest,
    getClientConfigRequest,
    getSSOUserInfoRequest,
    getSecureBackupRequest,
    restoreSecureBackupRequest,
    storeSecureBackupKeysRequest,
    verifySecureBackupPassphraseRequest,
} from "./client-secure-backup-requests";
