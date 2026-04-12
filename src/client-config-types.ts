import { Filter } from "./filter.ts";
import type { IIdentityServerProvider } from "./@types/IIdentityServerProvider.ts";
import type { MatrixScheduler } from "./scheduler.ts";
import type { QueryDict } from "./utils.ts";
import type { TokenRefreshFunction } from "./http-api/index.ts";
import type { CryptoStore } from "./crypto/store/base.ts";
import type { CryptoCallbacks } from "./crypto-api/index.ts";
import type { RoomNameState } from "./models/room.ts";
import type { Logger } from "./logger.ts";
import type { SlidingSync } from "./sliding-sync.ts";
import type { IStore } from "./store/index.ts";

export interface IKeysUploadResponse {
    one_time_key_counts: {
        // eslint-disable-line camelcase
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
}

export interface IStoredClientOpts extends IStartClientOpts {}
