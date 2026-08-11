import { Filter } from "./filter";
import type { IIdentityServerProvider } from "./@types/IIdentityServerProvider";
import type { MatrixScheduler } from "./scheduler";
import type { QueryDict } from "./utils";
import type { TokenRefreshFunction } from "./http-api/index";
import type { CryptoStore } from "./crypto/store/base";
import type { CryptoCallbacks } from "./crypto-api/index";
import type { RoomNameState } from "./models/room";
import type { Logger } from "./logger";
import type { SlidingSync } from "./sliding-sync";
import type { IStore } from "./store/index";

export interface IKeysUploadResponse {
    one_time_key_counts: {
        [algorithm: string]: number;
    };
}

export interface ICreateClientOpts {
    baseUrl: string;
    idBaseUrl?: string;
    allowInsecureHttp?: boolean;
    store?: IStore;
    cryptoStore?: CryptoStore;
    scheduler?: MatrixScheduler;
    fetchFn?: typeof globalThis.fetch;
    userId?: string;
    deviceId?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenRefreshFunction?: TokenRefreshFunction;
    identityServer?: IIdentityServerProvider;
    localTimeoutMs?: number;
    /** @deprecated Token is always sent via Authorization header (ISSUE-09). This option is ignored. */
    useAuthorizationHeader?: boolean;
    timelineSupport?: boolean;
    queryParams?: QueryDict;
    pickleKey?: string;
    verificationMethods?: Array<string>;
    forceTURN?: boolean;
    iceCandidatePoolSize?: number;
    supportsCallTransfer?: boolean;
    fallbackICEServerAllowed?: boolean;
    useE2eForGroupCall?: boolean;
    livekitServiceURL?: string;
    cryptoCallbacks?: CryptoCallbacks;
    enableEncryptedStateEvents?: boolean;
    roomNameGenerator?: (roomId: string, state: RoomNameState) => string | null;
    isVoipWithNoMediaAllowed?: boolean;
    disableVoip?: boolean;
    disableDynamicExtensions?: boolean;
    useLivekitForGroupCalls?: boolean;
    logger?: Logger;
}

export interface IMatrixClientCreateOpts extends ICreateClientOpts {
    usingExternalCrypto?: boolean;
}

export enum PendingEventOrdering {
    Chronological = "chronological",
    Detached = "detached",
}

export interface IStartClientOpts {
    initialSyncLimit?: number;
    includeArchivedRooms?: boolean;
    resolveInvitesToProfiles?: boolean;
    pendingEventOrdering?: PendingEventOrdering;
    pollTimeout?: number;
    filter?: Filter;
    disablePresence?: boolean;
    lazyLoadMembers?: boolean;
    clientWellKnownPollPeriod?: number;
    threadSupport?: boolean;
    slidingSync?: SlidingSync;
    /**
     * NOT_SENT pending events older than this threshold (in milliseconds) are
     * automatically transitioned to CANCELLED via the existing cleanup path.
     * Default: 86_400_000 (24h). Set to 0 to disable.
     * ISSUE-11b.
     */
    pendingEventNotSentTimeoutMs?: number;
}

export interface IStoredClientOpts extends IStartClientOpts {}
