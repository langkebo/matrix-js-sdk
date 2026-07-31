/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Federation Room Sub-Manager Types - 联邦房间子管理器类型
 *
 * 基于 Matrix Federation API spec 定义标准端点的响应类型；
 * Synapse 扩展端点使用 `Record<string, unknown>` 标注（结构未标准化）。
 */

import type { IEvent } from "../../models/event";

/**
 * GET /_matrix/federation/v1/state/{roomId} 响应
 *
 * @see https://spec.matrix.org/v1.11/server-server-api/#get_matrixfederationv1stateroomid
 */
export interface IFederationStateResponse {
    pdus: IEvent[];
}

/**
 * GET /_matrix/federation/v1/state_ids/{roomId} 响应
 *
 * @see https://spec.matrix.org/v1.11/server-server-api/#get_matrixfederationv1state_idsroomid
 */
export interface IFederationStateIdsResponse {
    pdu_ids: string[];
    auth_chain_ids: string[];
}

/**
 * GET /_matrix/federation/v1/event/{eventId} 响应
 *
 * @see https://spec.matrix.org/v1.11/server-server-api/#get_matrixfederationv1eventeventid
 */
export type IFederationEventResponse = IEvent;

/**
 * GET /_matrix/federation/v1/backfill/{roomId} 响应
 *
 * @see https://spec.matrix.org/v1.11/server-server-api/#get_matrixfederationv1backfillroomid
 */
export interface IFederationBackfillResponse {
    origin: string;
    origin_server_ts: number;
    pdus: IEvent[];
}

/**
 * GET /_matrix/federation/v1/members/{roomId} 响应
 *
 * @see https://spec.matrix.org/v1.11/server-server-api/#get_matrixfederationv1membersroomid
 */
export interface IFederationMembersResponse {
    /** 成员事件的 PDU 列表（仅包含 membership 事件） */
    chunk: IEvent[];
}

/**
 * GET /_matrix/federation/v1/hierarchy/{roomId} 响应
 *
 * 非 Matrix spec 标准端点，返回房间层级结构。
 * 字段基于 Synapse 实现，使用 index signature 兼容扩展字段。
 */
export interface IFederationHierarchyResponse {
    room_id: string;
    name?: string;
    topic?: string;
    canonical_alias?: string;
    avatar_url?: string;
    join_rule?: string;
    children?: Array<{
        room_id: string;
        via: string[];
        suggested?: boolean;
    }>;
    [key: string]: unknown;
}

/**
 * GET /_matrix/federation/v1/room/{roomId}/{eventId} 响应
 *
 * 非 Matrix spec 标准端点，返回单个事件。
 */
export type IFederationRoomEventResponse = IEvent;

/**
 * GET /_synapse/federation/v1/event_auth 响应
 *
 * Synapse 扩展端点，返回事件授权链。
 */
export interface IFederationEventAuthResponse {
    auth_chain: IEvent[];
}

/**
 * GET /_synapse/federation/v1/get_joining_rules/{roomId} 响应
 *
 * Synapse 扩展端点，响应结构未标准化，使用 `Record<string, unknown>`。
 */
export type IFederationJoiningRulesResponse = Record<string, unknown>;

/**
 * GET /_synapse/federation/v1/room_auth/{roomId} 响应
 *
 * Synapse 扩展端点，响应结构未标准化，使用 `Record<string, unknown>`。
 */
export type IFederationRoomAuthResponse = Record<string, unknown>;

/**
 * GET /_matrix/federation/v1/members/{roomId}/joined 响应
 *
 * @see https://spec.matrix.org/v1.11/server-server-api/#get_matrixfederationv1roomsroomidjoined_members
 */
export interface IFederationJoinedMembersResponse {
    /**
     * 已加入成员映射，key 为用户 ID，value 包含 display_name 和 avatar_url。
     * @example { "@alice:example.com": { "display_name": "Alice", "avatar_url": "mxc://..." } }
     */
    joined: Record<string, { display_name?: string; avatar_url?: string }>;
}

/**
 * GET /_matrix/federation/v1/event/{eventId} 响应
 *
 * @see https://spec.matrix.org/v1.11/server-server-api/#get_matrixfederationv1eventeventid
 */
export interface IFederationEventDetailResponse {
    /** 事件来源服务器 */
    origin: string;
    /** PDU 事件数据 */
    pdus: IEvent[];
}

/**
 * GET /_matrix/federation/v1/media/download/{serverName}/{mediaId} 响应
 *
 * Matrix Federation Media API 响应，返回媒体二进制流元数据。
 * 实际响应是二进制流，但 HTTP 客户端包装为对象返回。
 */
export interface IFederationMediaDownloadResponse {
    /** 媒体内容类型 (MIME type) */
    content_type?: string;
    /** 媒体文件名 */
    filename?: string;
    /** 媒体数据（Buffer 或 base64 编码字符串，取决于客户端实现） */
    data?: Uint8Array | string;
}

/**
 * GET /_matrix/federation/v1/media/thumbnail/{serverName}/{mediaId} 响应
 *
 * Matrix Federation Media API 缩略图响应。
 */
export interface IFederationMediaThumbnailResponse {
    /** 缩略图内容类型 */
    content_type?: string;
    /** 缩略图宽度 */
    width?: number;
    /** 缩略图高度 */
    height?: number;
    /** 缩略图数据 */
    data?: Uint8Array | string;
}
