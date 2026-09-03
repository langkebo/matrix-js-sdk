---
module: sliding_sync
generated_from: docs/api-contract/generated/modules/sliding_sync.json
generated_hash: sha256-8101390c43c53a191837cc99376038b283f8555edb7265ed938b7b1cd279c782
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Sliding Sync 契约

> 审查来源: `synapse-rust/src/web/routes/sliding_sync.rs`
> 审计状态: ✅ `MatrixClient.slidingSync()` 已绑定生成 `SlidingSyncPathPattern`

## 真实后端路由

| 方法 | 路径                              | 说明         | 认证 |
| ---- | --------------------------------- | ------------ | ---- |
| POST | `/_matrix/client/v3/sync/sliding` | Sliding Sync | 用户 |

## SDK 对齐状态

| 端点                 | SDK Manager      | 方法     | 状态      |
| -------------------- | ---------------- | -------- | --------- |
| `POST /sync/sliding` | `SlidingSyncSdk` | `sync()` | ✅ 已封装 |

## 本轮收口

- `src/client.ts` 中的 `MatrixClient.slidingSync()` 现已将 `"/sync"` 绑定到生成的 `SlidingSyncPathPattern`。
- SDK 继续默认走 `/_matrix/client/unstable/org.matrix.simplified_msc3575/sync` 前缀，并保留 `pos` / `timeout` 走查询参数、`clientTimeout` 只映射到 `localTimeoutMs` 的现有语义。
- 当前契约主入口与单测断言已对齐，不再依赖裸字符串路径。

## 常见状态码

| 状态码 | 说明                            |
| ------ | ------------------------------- |
| `200`  | 请求成功                        |
| `400`  | `pos`、列表窗口或请求体格式非法 |
| `401`  | Token 无效或缺失                |
| `429`  | Sliding Sync 长轮询触发限流     |

## 错误语义对齐（BaseManager）

| 场景                    | HTTP / errcode                         | SDK 统一错误类型 | 调用方建议                                                  |
| ----------------------- | -------------------------------------- | ---------------- | ----------------------------------------------------------- |
| 未认证或 token 失效     | `401` / `M_UNKNOWN_TOKEN`              | `AuthError`      | 引导重新登录                                                |
| Sliding Sync 参数不合法 | `400` / `M_BAD_JSON` `M_INVALID_PARAM` | `ApiError`       | 修正 `pos`、list ranges、subscriptions 或 extensions 后重试 |
| 长轮询限流或暂时拥塞    | `429` / `M_LIMIT_EXCEEDED`             | `RetryableError` | 使用退避重试并保留上一次 `pos`                              |

## 典型 errcode

| errcode            | 常见 HTTP | 说明                                |
| ------------------ | --------- | ----------------------------------- |
| `M_UNKNOWN_TOKEN`  | `401`     | access token 无效、过期或缺失       |
| `M_BAD_JSON`       | `400`     | Sliding Sync 请求体结构不合法       |
| `M_INVALID_PARAM`  | `400`     | `pos`、列表窗口、订阅或扩展参数非法 |
| `M_LIMIT_EXCEEDED` | `429`     | Sliding Sync 长轮询触发限流         |

## DTO 类型定义

以下类型对应后端 `synapse-storage/src/sliding_sync/models.rs` 中的 `SlidingSyncRequest` 和 `SlidingSyncResponse`。

```typescript
// ============================================================
// Sliding Sync 请求 DTO (POST /sync/sliding)
// ============================================================

/**
 * Sliding Sync 主请求体（MSC3575）
 * 对应后端 SlidingSyncRequest
 */
export interface SlidingSyncRequest {
    /** Sliding sync 位置令牌，null 或空字符串表示初始同步 */
    pos?: string;
    /** 长轮询超时（毫秒），默认 30000 */
    timeout?: number;
    /** 列表配置（Map<string, SlidingSyncList>） */
    lists?: Record<string, SlidingSyncList>;
    /** 房间订阅 */
    room_subscriptions?: Record<string, SlidingSyncRoomSubscription>;
    /** 退订房间 ID 列表 */
    unsubscribe_rooms?: string[];
    /** 扩展配置 */
    extensions?: SlidingSyncExtensions;
    /** MSC4186: 事务 ID，用于幂等重试 */
    txn_id?: string;
    /** 本地客户端超时（毫秒），仅用于 localTimeoutMs，不进入 HTTP 请求体 */
    clientTimeout?: number;
}

/**
 * Sliding Sync 列表配置
 * 对应后端 SlidingSyncListData
 */
export interface SlidingSyncList {
    /** 排序规则，如 ["by_recency", "by_name"] */
    sort?: string[];
    /** 过滤器 */
    filters?: SlidingSyncFilters;
    /** 请求的房间详情字段 */
    room_details?: boolean;
    /** 包含未读线程通知数 */
    unread_thread_notifications?: boolean;
    /** 房间订阅（数组或对象） */
    subscriptions?: string[] | Record<string, SlidingSyncRoomSubscription>;
    /** 同步类型 */
    sync_type?: string;
    /** 范围，如 [[0, 49]] 表示前 50 个房间 */
    ranges?: number[][];
    /** 时间线事件数量限制 */
    timeline_limit?: number;
    /** 要求的 state 类型列表 [[event_type, state_key], ...] */
    required_state?: string[][];
    /** 慢速房间排序权重 */
    slow_by?: number;
    /** Bump 事件类型列表 */
    bump_event_types?: string[];
}

/**
 * Sliding Sync 过滤器
 */
export interface SlidingSyncFilters {
    /** 是否为邀请房间 */
    is_invite?: boolean;
    /** 是否为主页房间 */
    is_home?: boolean;
    /** 排除的房间 ID 列表 */
    not_rooms?: string[];
    /** 包含的房间 ID 列表 */
    rooms?: string[];
    /** 房间名称模糊匹配 */
    room_name_like?: string;
    /** 包含的标签列表 */
    tags?: string[];
    /** 排除的标签列表 */
    not_tags?: string[];
    /** 临时事件过滤器 */
    ephemeral?: Array<{ type: string; key?: string }>;
}

/**
 * 房间订阅配置
 */
export interface SlidingSyncRoomSubscription {
    /** 要求的 state 类型列表 */
    required_state?: string[][];
    /** 时间线事件数量限制 */
    timeline_limit?: number;
    /** 永久化的 state（服务端缓存） */
    permanent?: string[][];
    /** 强制重新发送事件 */
    force_resend?: boolean;
}

/**
 * Sliding Sync 扩展配置
 */
export interface SlidingSyncExtensions {
    /** E2EE 扩展 */
    e2ee?: SlidingSyncE2EEExtension;
    /** ToDevice 消息扩展 */
    todevice?: SlidingSyncToDeviceExtension;
    /** 账户数据扩展 */
    account_data?: SlidingSyncAccountDataExtension;
    /** Receipt 扩展 */
    receipts?: SlidingSyncReceiptsExtension;
    /** Typing 通知扩展 */
    typing?: SlidingSyncTypingExtension;
}

/** E2EE 扩展请求 */
export interface SlidingSyncE2EEExtension {
    enabled: boolean;
}

/** ToDevice 扩展请求 */
export interface SlidingSyncToDeviceExtension {
    enabled: boolean;
    /** 最大 ToDevice 事件数 */
    limit?: number;
}

/** 账户数据扩展请求 */
export interface SlidingSyncAccountDataExtension {
    enabled: boolean;
}

/** Receipt 扩展请求 */
export interface SlidingSyncReceiptsExtension {
    enabled: boolean;
}

/** Typing 扩展请求 */
export interface SlidingSyncTypingExtension {
    enabled: boolean;
}

// ============================================================
// Sliding Sync 响应 DTO
// ============================================================

/**
 * Sliding Sync 主响应体
 * 对应后端 SlidingSyncResponse
 */
export interface SlidingSyncResponse {
    /** 下一批位置令牌 */
    pos: string;
    /** 列表更新操作 */
    lists?: Record<string, SlidingSyncListUpdate>;
    /** 房间数据 */
    rooms?: Record<string, SlidingSyncRoom>;
    /** 扩展响应 */
    extensions?: SlidingSyncExtensionsResponse;
}

/**
 * 列表更新操作
 */
export interface SlidingSyncListUpdate {
    /** 房间总数 */
    count: number;
    /** 更新操作列表 */
    ops?: SlidingSyncListOperation[];
}

/**
 * 列表操作
 */
export interface SlidingSyncListOperation {
    op: "SYNC" | "POST" | "DELETE";
    range?: number[];
    room_id?: string;
}

/**
 * Sliding Sync 房间数据
 */
export interface SlidingSyncRoom {
    /** 房间 ID */
    room_id: string;
    /** 房间名称 */
    name?: string;
    /** 房间头像 URL */
    avatar?: string;
    /** 必选 state 事件数组 */
    required_state?: SlidingSyncStateEvent[];
    /** 时间线事件 */
    timeline?: SlidingSyncTimeline;
    /** 临时事件 */
    ephemeral?: Array<{ type: string; sender?: string; content: unknown }>;
    /** 账户数据事件 */
    account_data?: Array<{ type: string; content: unknown }>;
    /** 未读通知数 */
    unread_count?: number;
    /** Joined 成员数 */
    joined_member_count?: number;
    /** Invited 成员数 */
    invited_member_count?: number;
    /** 高亮未读数 */
    highlight_count?: number;
    /** 通知数 */
    notification_count?: number;
    /** 粘性事件（MSC4354） */
    sticky_events?: SlidingSyncStateEvent[];
}

/**
 * State 事件
 */
export interface SlidingSyncStateEvent {
    type: string;
    state_key: string;
    sender?: string;
    content: unknown;
    /** 事件 ID（可选） */
    event_id?: string;
    /** 服务器时间戳（可选） */
    origin_server_ts?: number;
}

/**
 * 时间线
 */
export interface SlidingSyncTimeline {
    /** 事件数组 */
    events: unknown[];
    /** 是否被截断 */
    limited?: boolean;
    /** 上一页 batch token */
    prev_batch?: string;
}

/**
 * 扩展响应
 */
export interface SlidingSyncExtensionsResponse {
    /** E2EE 扩展响应 */
    e2ee?: SlidingSyncE2EEExtensionResponse;
    /** ToDevice 扩展响应 */
    todevice?: SlidingSyncToDeviceExtensionResponse;
    /** 账户数据扩展响应 */
    account_data?: SlidingSyncAccountDataExtensionResponse;
    /** Receipt 扩展响应 */
    receipts?: Record<string, Record<string, SlidingSyncReceipt>>;
    /** Typing 扩展响应 */
    typing?: SlidingSyncTypingExtensionResponse;
}

/** E2EE 扩展响应 */
export interface SlidingSyncE2EEExtensionResponse {
    device_lists?: {
        changed?: string[];
        left?: string[];
    };
    device_one_time_keys_count?: Record<string, number>;
    device_unused_fallback_key_types?: string[];
    fallback_key?: string;
}

/** ToDevice 扩展响应 */
export interface SlidingSyncToDeviceExtensionResponse {
    events: unknown[];
}

/** 账户数据扩展响应 */
export interface SlidingSyncAccountDataExtensionResponse {
    events: Array<{ type: string; content: unknown }>;
}

/** Receipt */
export interface SlidingSyncReceipt {
    receipt_type: string;
    user_id: string;
    event_id: string;
    ts: number;
}

/** Typing 扩展响应 */
export interface SlidingSyncTypingExtensionResponse {
    events: Array<{
        type: string;
        sender: string;
        content: { user_ids: string[] };
    }>;
}
```
