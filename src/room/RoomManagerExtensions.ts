/**
 * RoomManager 扩展 - Batch 1: Core Room Operations (P0 Priority)
 * 
 * 基于 synapse-rust ROUTE_CONTRACT.md 定义
 * 补全 Room 模块缺失的核心接口 (当前覆盖率：17.6% → 目标提升 ~25%)
 * 
 * @see ../../../docs/API_COVERAGE_REPORT.md
 */

import { Method } from "../http-api/method";
import { ClientPrefix } from "../http-api/prefix";
import { MatrixError } from "../http-api/errors";
import { validateRoomId, validateUserId } from "../common/validators";
import { type IRoomEvent, type IStateEvent } from "./RoomManager";

// ============================================================================
// Room Details & Metadata Operations
// ============================================================================

export interface IRoomDetails {
    room_id: string;
    name?: string;
    topic?: string;
    avatar_url?: string;
    join_rule?: string;
    history_visibility?: string;
    created_ts?: number;
    member_count?: number;
}

export interface IPinnedEvents {
    pinned: string[];
}

export interface IRoomAliases {
    aliases: string[];
}

export interface IExternalIds {
    external_ids: Array<{
        external_id: string;
        type: string;
    }>;
}

export interface IMessageQueue {
    messages: IRoomEvent[];
    next_token?: string;
}

export interface IRecentMembers {
    members: IStateEvent[];
}

export interface IMembership {
    membership: string;
    event_id: string;
    sender: string;
    ts: number;
}

export interface INotifications {
    highlight_count: number;
    notification_count: number;
}

export interface IPermissions {
    power_levels: {
        users: Record<string, number>;
        events: Record<string, number>;
    };
}

export interface IServiceTypes {
    service_types: Array<{ type: string }>;
}

export interface IReducedEvents {
    events: IRoomEvent[];
}

export interface IEventUrl {
    url: string;
}

export interface IFragment {
    fragment_id: string;
    content: unknown;
}

export interface IFragments {
    fragments: IFragment[];
}

export interface IRoomKey {
    key: string;
    algorithm: string;
}

export interface IRoomKeys {
    keys: Array<{
        algorithm: string;
        device_id: string;
        keys: string;
    }>;
}

export interface IVaultEntry {
    id: string;
    data: unknown;
}

export interface IVaultData {
    vault_entries: IVaultEntry[];
}

export interface IEventPerspective {
    perspective?: unknown;
    events?: IRoomEvent[];
}

export interface IThread {
    thread_id: string;
    replies: IRoomEvent[];
}

export interface ITimeline {
    events: IRoomEvent[];
}

export interface IVerifyResult {
    verified: boolean;
}

export interface IConvertResult {
    converted: boolean;
}

export interface ITranslatedText {
    translated_text: string;
}

export interface IAntiScreenshot {
    enabled: boolean;
}

export interface IRetentionPolicy {
    min_lifetime?: number;
    max_lifetime?: number;
}

export interface IResolvedAlias {
    canonical_alias: string;
}

export interface IMembershipEvents {
    events: IRoomEvent[];
}

export interface ITurnServer {
    uris: string[];
    ttl: number;
}

export interface IUnreadCount {
    unread_count: number;
}

export interface ISearchResults {
    results: IRoomEvent[];
}

/**
 * Room 模块核心操作方法
 * 
 * 这些方法用于补全与 synapse-rust 后端对应的 API 接口
 * 
 * Usage example:
 * ```typescript
 * import { getRoomDetails } from './RoomManagerExtensions';
 * 
 * const details = await getRoomDetails(client, "!room:id");
 * console.log(details.name);
 * ```
 */

/**
 * 获取房间详情
 * @param client MatrixClient instance
 * @param roomId 房间 ID
 */
export async function getRoomDetails(
    client: any,
    roomId: string
): Promise<IRoomDetails> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}`,
    });
}

/**
 * 获取已固定事件列表
 */
export async function getPinnedEvents(
    client: any,
    roomId: string
): Promise<IPinnedEvents> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/pinned_events`,
    });
}

/**
 * 获取房间别名列表
 */
export async function getRoomAliases(
    client: any,
    roomId: string
): Promise<IRoomAliases> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/aliases`,
    });
}

/**
 * 删除固定事件
 */
export async function deletePinnedEvent(
    client: any,
    roomId: string,
    eventId: string
): Promise<void> {
    validateRoomId(roomId);
    
    await client.http.authenticatedRequest({
        method: Method.Delete,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/pinned_events/${encodeURIComponent(eventId)}`,
    });
}

/**
 * 更新固定事件列表
 */
export async function updatePinnedEvents(
    client: any,
    roomId: string,
    pinnedEventIds: string[]
): Promise<{ event_id: string }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Post,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/pinned_events`,
        body: { pinned: pinnedEventIds },
    });
}

/**
 * 获取外部 ID 列表
 */
export async function getExternalIds(
    client: any,
    roomId: string
): Promise<IExternalIds> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/external_ids`,
    });
}

/**
 * 获取消息队列
 */
export async function getMessageQueue(
    client: any,
    roomId: string
): Promise<IMessageQueue> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/message_queue`,
    });
}

/**
 * 获取最近成员列表
 */
export async function getRecentMembers(
    client: any,
    roomId: string,
    limit?: number
): Promise<IRecentMembers> {
    validateRoomId(roomId);
    
    const queryParams = limit ? { limit } : undefined;
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members/recent`,
        queryParams,
    });
}

/**
 * 获取成员详情
 */
export async function getMembership(
    client: any,
    roomId: string,
    userId: string
): Promise<IMembership> {
    validateRoomId(roomId);
    validateUserId(userId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/membership/${encodeURIComponent(userId)}`,
    });
}

/**
 * 获取通知数量
 */
export async function getNotifications(
    client: any,
    roomId: string
): Promise<INotifications> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/notifications`,
    });
}

/**
 * 获取权限设置
 */
export async function getPermissions(
    client: any,
    roomId: string
): Promise<IPermissions> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/permissions`,
    });
}

/**
 * 获取服务类型
 */
export async function getServiceTypes(
    client: any,
    roomId: string
): Promise<IServiceTypes> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/service_types`,
    });
}

/**
 * 获取精简事件
 */
export async function getReducedEvents(
    client: any,
    roomId: string,
    params?: { limit?: number; types?: string[] }
): Promise<IReducedEvents> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/reduced_events`,
        queryParams: params,
    });
}

/**
 * 获取事件 URL
 */
export async function getEventUrl(
    client: any,
    roomId: string,
    eventId: string
): Promise<IEventUrl> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}/url`,
    });
}

/**
 * 获取房间片段
 */
export async function getRoomFragments(
    client: any,
    roomId: string,
    userId: string
): Promise<IFragments> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/fragments/${encodeURIComponent(userId)}`,
    });
}

/**
 * 获取房间密钥
 */
export async function getRoomKey(
    client: any,
    roomId: string,
    eventId: string
): Promise<IRoomKey> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/keys/${encodeURIComponent(eventId)}`,
    });
}

/**
 * 获取房间密钥列表
 */
export async function getRoomKeys(
    client: any,
    roomId: string
): Promise<IRoomKeys> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/keys`,
    });
}

/**
 * 获取密钥计数
 */
export async function getRoomKeysCount(
    client: any,
    roomId: string
): Promise<{ count: number }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/keys/count`,
    });
}

/**
 * 获取密钥版本
 */
export async function getRoomKeysVersion(
    client: any,
    roomId: string
): Promise<{ version: string }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/keys/version`,
    });
}

/**
 * 声明房间密钥
 */
export async function claimRoomKeys(
    client: any,
    roomId: string,
    keys: Record<string, Record<string, string[]>>
): Promise<{ one_keys: Record<string, unknown> }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Post,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/keys/claim`,
        body: keys,
    });
}

/**
 * 上传房间密钥
 */
export async function uploadRoomKeys(
    client: any,
    roomId: string,
    keysData: { sessions: Record<string, unknown> }
): Promise<{ count: number }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Put,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/room_keys/keys`,
        body: keysData,
    });
}

/**
 * 签名房间事件
 */
export async function signRoomEvent(
    client: any,
    roomId: string,
    eventId: string,
    signature: string
): Promise<{ signed: boolean }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Put,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/sign/${encodeURIComponent(eventId)}`,
        body: { signature },
    });
}

/**
 * 更新房间可见性
 */
export async function updateRoomVisibility(
    client: any,
    roomId: string,
    visibility: "public" | "private"
): Promise<void> {
    validateRoomId(roomId);
    
    await client.http.authenticatedRequest({
        method: Method.Put,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/visibility`,
        body: { visibility },
    });
}

/**
 * 获取房间账户数据
 */
export async function getRoomAccountData(
    client: any,
    roomId: string,
    type: string
): Promise<unknown> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/account_data/${encodeURIComponent(type)}`,
    });
}

/**
 * 设置房间账户数据
 */
export async function setRoomAccountData(
    client: any,
    roomId: string,
    type: string,
    data: unknown
): Promise<void> {
    validateRoomId(roomId);
    
    await client.http.authenticatedRequest({
        method: Method.Put,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/account_data/${encodeURIComponent(type)}`,
        body: data,
    });
}

/**
 * 获取存储库数据
 */
export async function getVaultData(
    client: any,
    roomId: string
): Promise<IVaultData> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/vault_data`,
    });
}

/**
 * 更新存储库数据
 */
export async function setVaultData(
    client: any,
    roomId: string,
    entryId: string,
    data: unknown
): Promise<{ updated: boolean }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Put,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/vault_data`,
        body: { id: entryId, data },
    });
}

/**
 * 获取事件透视信息
 */
export async function getEventPerspective(
    client: any,
    roomId: string,
    params?: { event_id?: string; last_known_index?: string }
): Promise<IEventPerspective> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event_perspective`,
        queryParams: params,
    });
}

/**
 * 获取时间线
 */
export async function getTimeline(
    client: any,
    roomId: string,
    params?: { from?: string; to?: string; limit?: number }
): Promise<ITimeline> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/timeline`,
        queryParams: params,
    });
}

/**
 * 获取线程
 */
export async function getThread(
    client: any,
    roomId: string,
    eventId: string
): Promise<IThread> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/thread/${encodeURIComponent(eventId)}`,
    });
}

/**
 * 获取线程列表
 */
export async function getThreadList(
    client: any,
    roomId: string,
    threadId: string,
    params?: { limit?: number }
): Promise<ITimeline> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/threads/${encodeURIComponent(threadId)}`,
        queryParams: params,
    });
}

/**
 * 验证事件
 */
export async function verifyEvent(
    client: any,
    roomId: string,
    eventId: string,
    verificationMethod: string
): Promise<IVerifyResult> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Post,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/verify/${encodeURIComponent(eventId)}`,
        body: { method: verificationMethod },
    });
}

/**
 * 转换事件
 */
export async function convertEvent(
    client: any,
    roomId: string,
    eventId: string,
    targetType: string
): Promise<IConvertResult> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Post,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/convert/${encodeURIComponent(eventId)}`,
        body: { target_type: targetType },
    });
}

/**
 * 获取转译文本
 */
export async function translateEvent(
    client: any,
    roomId: string,
    eventId: string,
    targetLang: string
): Promise<ITranslatedText> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Post,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/translate/${encodeURIComponent(eventId)}`,
        body: { target_lang: targetLang },
    });
}

/**
 * 获取防截屏设置
 */
export async function getAntiScreenshotSetting(
    client: any,
    roomId: string
): Promise<IAntiScreenshot> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/anti_screenshot`,
    });
}

/**
 * 设置防截屏设置
 */
export async function setAntiScreenshotSetting(
    client: any,
    roomId: string,
    enabled: boolean
): Promise<void> {
    validateRoomId(roomId);
    
    await client.http.authenticatedRequest({
        method: Method.Put,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/anti_screenshot`,
        body: { enabled },
    });
}

/**
 * 获取阅后即焚策略
 */
export async function getRetentionPolicy(
    client: any,
    roomId: string
): Promise<IRetentionPolicy> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/retention`,
    });
}

/**
 * 解决房间别名
 */
export async function resolveRoomAlias(
    client: any,
    roomId: string
): Promise<IResolvedAlias> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/resolve`,
    });
}

/**
 * 获取阅读回执
 */
export async function getReceipts(
    client: any,
    roomId: string,
    receiptType: string,
    eventId: string
): Promise<{ receipts: Array<{ user_id: string; ts: number }> }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipts/${encodeURIComponent(receiptType)}/${encodeURIComponent(eventId)}`,
    });
}

/**
 * 发送阅读回执
 */
export async function sendReceipt(
    client: any,
    roomId: string,
    receiptType: string,
    eventId: string
): Promise<void> {
    validateRoomId(roomId);
    
    await client.http.authenticatedRequest({
        method: Method.Post,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/${encodeURIComponent(receiptType)}/${encodeURIComponent(eventId)}`,
    });
}

/**
 * 获取渲染后的内容
 */
export async function getRenderedContent(
    client: any,
    roomId: string,
    eventId: string
): Promise<{ rendered_html: string }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/rendered/`,
        queryParams: { event_id: eventId },
    });
}

/**
 * 同步房间状态
 */
export async function syncRoom(
    client: any,
    roomId: string,
    since?: string
): Promise<ITimeline> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/sync`,
        queryParams: since ? { since } : undefined,
    });
}

/**
 * 获取未读数量
 */
export async function getUnreadCount(
    client: any,
    roomId: string
): Promise<IUnreadCount> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/unread_count`,
    });
}

/**
 * 获取 TURN 服务器信息
 */
export async function getTurnServer(
    client: any,
    roomId: string
): Promise<ITurnServer> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/turn_server`,
    });
}

/**
 * 获取成员事件列表
 */
export async function getMembershipEvents(
    client: any,
    roomId: string
): Promise<IMembershipEvents> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Post,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/get_membership_events`,
    });
}

/**
 * 搜索房间内容
 */
export async function searchRoom(
    client: any,
    roomId: string,
    searchTerm: string,
    params?: { limit?: number; order?: "asc" | "desc" }
): Promise<ISearchResults> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Post,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/search`,
        body: {
            search_term: searchTerm,
            ...params,
        },
    });
}

/**
 * 删除粘滞事件
 */
export async function deleteStickyEvent(
    client: any,
    roomId: string,
    eventType: string
): Promise<void> {
    validateRoomId(roomId);
    
    await client.http.authenticatedRequest({
        method: Method.Delete,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/sticky_events/${encodeURIComponent(eventType)}`,
    });
}

/**
 * 设置粘滞事件
 */
export async function setStickyEvent(
    client: any,
    roomId: string,
    eventType: string,
    content: unknown
): Promise<void> {
    validateRoomId(roomId);
    
    await client.http.authenticatedRequest({
        method: Method.Post,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/sticky_events`,
        body: { event_type: eventType, content },
    });
}

/**
 * 获取设备信息
 */
export async function getRoomDevice(
    client: any,
    roomId: string,
    deviceId: string
): Promise<{ device_info: unknown }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/device/${encodeURIComponent(deviceId)}`,
    });
}

/**
 * 获取加密事件列表
 */
export async function getEncryptedEvents(
    client: any,
    roomId: string,
    params?: { limit?: number; from?: string }
): Promise<{ events: IRoomEvent[] }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/encrypted_events`,
        queryParams: params,
    });
}

/**
 * 获取单个事件详情
 */
export async function getRoomEvent(
    client: any,
    roomId: string,
    eventId: string
): Promise<IRoomEvent> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
    });
}

/**
 * 获取邀请列表
 */
export async function getRoomInvites(
    client: any,
    roomId: string
): Promise<{ invites: Array<{ inviter: string; invite_state: IRoomEvent[] }> }> {
    validateRoomId(roomId);
    
    return await client.http.authenticatedRequest({
        method: Method.Get,
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invites`,
    });
}
