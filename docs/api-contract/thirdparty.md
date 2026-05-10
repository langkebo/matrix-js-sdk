---
module: thirdparty
generated_from: docs/api-contract/generated/modules/thirdparty.json
generated_hash: sha256-b7bd440dde8b489b98506efe0c87e56384d5827698a877eadadd05314be63728
ledger_schema: 1
last_reviewed: 2026-05-03
---

# Thirdparty Integration API 契约文档

> 后端代码: `synapse-rust/src/web/routes/thirdparty.rs`  
> 装配入口: `synapse-rust/src/web/routes/assembly.rs`  
> 更新日期: 2026-04-27  
> 挂载版本: `r0`, `v3`

## 一、模块概述

### 1.1 功能描述

Thirdparty API 提供第三方协议集成功能，用于：

- 查询支持的第三方协议
- 查询第三方位置（如 IRC 频道）
- 查询第三方用户（如 IRC 用户）
- 桥接 Matrix 与其他通信协议

### 1.2 路由前缀

- `/_matrix/client/{r0,v3}/thirdparty/*`

### 1.3 认证要求

- 所有端点需要 `AuthenticatedUser`

## 二、端点详情

### 2.1 查询所有协议

**路径**: `GET /_matrix/client/{r0,v3}/thirdparty/protocols`  
**认证**: `AuthenticatedUser`  
**挂载版本**: `r0`, `v3`

**响应**: `200 OK`

```typescript
interface ProtocolsResponse {
    [protocol_id: string]: {
        user_fields: string[];
        location_fields: string[];
        icon: string;
        field_types: Record<
            string,
            {
                regexp: string;
                placeholder: string;
            }
        >;
        instances: Array<{
            network_id: string;
            fields: Record<string, string>;
        }>;
    };
}
```

### 2.2 查询单个协议

**路径**: `GET /_matrix/client/{r0,v3}/thirdparty/protocol/{protocol}`  
**认证**: `AuthenticatedUser`  
**挂载版本**: `r0`, `v3`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `protocol` | string | 协议 ID（如 `irc`） |

**响应**: `200 OK` - 同 2.1 中的单个协议对象

### 2.3 查询协议位置

**路径**: `GET /_matrix/client/{r0,v3}/thirdparty/location/{protocol}`  
**认证**: `AuthenticatedUser`  
**挂载版本**: `r0`, `v3`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `searchFields...` | string | 否 | 协议特定的搜索字段 |

**响应**: `200 OK`

```typescript
interface LocationResponse {
    alias: string;
    protocol: string;
    fields: Record<string, string>;
}
[];
```

### 2.4 查询协议用户

**路径**: `GET /_matrix/client/{r0,v3}/thirdparty/user/{protocol}`  
**认证**: `AuthenticatedUser`  
**挂载版本**: `r0`, `v3`

**查询参数**: 同 2.3

**响应**: `200 OK`

```typescript
interface UserResponse {
    userid: string;
    protocol: string;
    fields: Record<string, string>;
}
[];
```

### 2.5 查询所有位置（v3）

**路径**: `GET /_matrix/client/v3/thirdparty/location`  
**认证**: `AuthenticatedUser`  
**挂载版本**: `v3`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `alias` | string | 否 | 房间别名 |

**响应**: `200 OK` - 同 2.3

### 2.6 查询所有用户（v3）

**路径**: `GET /_matrix/client/v3/thirdparty/user`  
**认证**: `AuthenticatedUser`  
**挂载版本**: `v3`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `userid` | string | 否 | Matrix 用户 ID |

**响应**: `200 OK` - 同 2.4

## 三、SDK 对齐状态

### 3.1 SDK Manager 对应关系

| 后端端点                   | SDK 方法                              | 状态                                                    |
| -------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `GET /protocols`           | `ThirdPartyManager.getProtocols()`    | ✅ 已封装                                               |
| `GET /protocol/{protocol}` | `ThirdPartyManager.getProtocol()`     | ⚠️ 间接实现（复用 `getProtocols()` 全量查询后本地筛选） |
| `GET /location/{protocol}` | `ThirdPartyManager.searchLocations()` | ✅ 已封装                                               |
| `GET /user/{protocol}`     | `ThirdPartyManager.searchUsers()`     | ✅ 已封装                                               |
| `GET /location`            | -                                     | ❌ 未封装                                               |
| `GET /user`                | -                                     | ❌ 未封装                                               |

### 3.2 封装覆盖率

- **总端点数**: 6
- **直连已封装**: 3
- **间接实现**: 1
- **直连覆盖率**: 50%

### 3.3 已知差异

- `ThirdPartyManager.getProtocol()` 当前不会调用 `GET /thirdparty/protocol/{protocol}`，而是复用 `getProtocols()` 拉取全量协议后在本地筛选
- 缺少 v3 的通用位置和用户查询方法

## 四、常见错误码

| 状态码 | 错误码            | 说明       |
| ------ | ----------------- | ---------- |
| 400    | `M_INVALID_PARAM` | 参数无效   |
| 401    | `M_UNAUTHORIZED`  | 未认证     |
| 404    | `M_NOT_FOUND`     | 协议不存在 |

## 五、变更历史

| 日期       | 变更 | 影响 |
| ---------- | ---- | ---- |
| 2026-04-27 | 初版 | -    |
