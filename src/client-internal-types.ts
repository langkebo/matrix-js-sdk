import type { IRoomEvent, IStateEvent } from "./sync-accumulator.ts";
import type { IHierarchyRoom } from "./@types/spaces.ts";
import type { ISignatures } from "./@types/signed.ts";
import type { Membership } from "./@types/membership.ts";

export interface IKeyBackupPath {
    path: string;
    queryData?: {
        version: string;
    };
}

export interface IMediaConfig {
    [key: string]: unknown;
    "m.upload.size"?: number;
}

export interface IThirdPartySigned {
    sender: string;
    mxid: string;
    token: string;
    signatures: ISignatures;
}

export interface IJoinRequestBody {
    third_party_signed?: IThirdPartySigned;
}

export interface ITagMetadata {
    [key: string]: unknown;
    order?: number;
}

export interface IMyRoomInfo {
    room_id: string;
    name?: string;
    avatar_url?: string;
    membership?: Membership;
    topic?: string;
    canonical_alias?: string;
    join_state?: Membership;
    member_count?: number;
    [key: string]: unknown;
}

export interface IMessagesResponse {
    start?: string;
    end?: string;
    chunk: IRoomEvent[];
    state?: IStateEvent[];
}

export interface IThreadedMessagesResponse {
    prev_batch: string;
    next_batch: string;
    chunk: IRoomEvent[];
    state: IStateEvent[];
}

export interface IUserDirectoryResponse {
    results: {
        user_id: string;
        display_name?: string;
        avatar_url?: string;
    }[];
    limited: boolean;
}

export interface IThirdPartyLocation {
    alias: string;
    protocol: string;
    fields: object;
}

export interface IThirdPartyUser {
    userid: string;
    protocol: string;
    fields: object;
}

export interface IRoomHierarchy {
    rooms: IHierarchyRoom[];
    next_batch?: string;
}

export interface IWhoamiResponse {
    user_id: string;
    device_id?: string;
    is_guest?: boolean;
}
