/**
 * RoomManager Extensions 类型定义
 * 
 * 用于补全 Room 模块的 API 接口覆盖
 */

/**
 * 房间详细信息接口
 */
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

/**
 * 已固定事件列表
 */
export interface IPinnedEvents {
    pinned: string[];
}

/**
 * 房间别名列表
 */
export interface IRoomAliases {
    aliases: string[];
}

/**
 * 外部 ID 列表
 */
export interface IExternalIds {
    external_ids: Array<{
        external_id: string;
        type: string;
    }>;
}

/**
 * 消息队列
 */
export interface IMessageQueue {
    messages: IRoomEvent[];
    next_token?: string;
}

/**
 * 最近成员列表
 */
export interface IRecentMembers {
    members: IStateEvent[];
}

/**
 * 成员详情
 */
export interface IMembership {
    membership: string;
    event_id: string;
    sender: string;
    ts: number;
}

/**
 * 通知数量
 */
export interface INotifications {
    highlight_count: number;
    notification_count: number;
}

/**
 * 权限设置
 */
export interface IPermissions {
    power_levels: {
        users: Record<string, number>;
        events: Record<string, number>;
    };
}

/**
 * 服务类型
 */
export interface IServiceTypes {
    service_types: Array<{ type: string }>;
}

/**
 * 精简事件列表
 */
export interface IReducedEvents {
    events: IRoomEvent[];
}

/**
 * 事件 URL
 */
export interface IEventUrl {
    url: string;
}

/**
 * 事件片段
 */
export interface IFragment {
    fragment_id: string;
    content: unknown;
}

/**
 * 房间片段列表
 */
export interface IFragments {
    fragments: IFragment[];
}

/**
 * 房间密钥
 */
export interface IRoomKey {
    key: string;
    algorithm: string;
}

/**
 * 房间密钥列表
 */
export interface IRoomKeys {
    keys: Array<{
        algorithm: string;
        device_id: string;
        keys: string;
    }>;
}

/**
 * 存储库条目
 */
export interface IVaultEntry {
    id: string;
    data: unknown;
}

/**
 * 存储库数据
 */
export interface IVaultData {
    vault_entries: IVaultEntry[];
}

/**
 * 事件透视信息
 */
export interface IEventPerspective {
    perspective?: unknown;
    events?: IRoomEvent[];
}

/**
 * 线程信息
 */
export interface IThread {
    thread_id: string;
    replies: IRoomEvent[];
}

/**
 * 时间线
 */
export interface ITimeline {
    events: IRoomEvent[];
}

/**
 * 验证结果
 */
export interface IVerifyResult {
    verified: boolean;
}

/**
 * 转换结果
 */
export interface IConvertResult {
    converted: boolean;
}

/**
 * 转译文本
 */
export interface ITranslatedText {
    translated_text: string;
}

/**
 * 防截屏设置
 */
export interface IAntiScreenshot {
    enabled: boolean;
}

/**
 * 阅后即焚策略
 */
export interface IRetentionPolicy {
    min_lifetime?: number;
    max_lifetime?: number;
}

/**
 * 已解析的别名
 */
export interface IResolvedAlias {
    canonical_alias: string;
}

/**
 * TURN 服务器信息
 */
export interface ITurnServer {
    uris: string[];
    ttl: number;
}

/**
 * 未读数量
 */
export interface IUnreadCount {
    unread_count: number;
}

/**
 * 搜索 results
 */
export interface ISearchResults {
    results: IRoomEvent[];
}

/**
 * 成员事件列表
 */
export interface IMembershipEvents {
    events: IRoomEvent[];
}

// 类型导入（从父模块）
import type { IRoomEvent } from "./RoomManager";
import type { IStateEvent } from "./RoomManager";
