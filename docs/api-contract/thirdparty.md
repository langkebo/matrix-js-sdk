---
module: thirdparty
generated_from: docs/api-contract/generated/modules/thirdparty.json
generated_hash: sha256-530b4b3441538f648b68ff0c54232ac07db2639f10a4148755729f7d16e718b7
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

| 后端端点                   | SDK 方法                                 | 状态      |
| -------------------------- | ---------------------------------------- | --------- |
| `GET /protocols`           | `ThirdPartyManager.getProtocols()`       | ✅ 已封装 |
| `GET /protocol/{protocol}` | `ThirdPartyManager.getProtocol()`        | ✅ 已封装 |
| `GET /location/{protocol}` | `ThirdPartyManager.searchLocations()`    | ✅ 已封装 |
| `GET /user/{protocol}`     | `ThirdPartyManager.searchUsers()`        | ✅ 已封装 |
| `GET /location`            | `ThirdPartyManager.searchAllLocations()` | ✅ 已封装 |
| `GET /user`                | `ThirdPartyManager.searchAllUsers()`     | ✅ 已封装 |

### 3.2 封装覆盖率

- **总端点数**: 6
- **直连已封装**: 6
- **间接实现**: 0
- **直连覆盖率**: 100%

### 3.3 已知差异

- `src/thirdparty/index.ts` 现已绑定生成 `route-table` 的 `v3` 路径模式，避免手写 thirdparty 路由漂移。
- `getProtocol()` 现已直连 `GET /thirdparty/protocol/{protocol}`。
- `searchAllLocations()` / `searchAllUsers()` 补齐了 `v3` 通用位置与用户查询。

### 3.4 人工 Review 对齐

- 仍保留 `searchLocations(protocol, params)` 与 `searchUsers(protocol, params)` 作为按协议精确查询入口。
- 新增 `searchAllLocations(params)` 与 `searchAllUsers(params)` 作为 `v3` 通用查询入口。
- 单测已覆盖单协议直连、通用位置查询、通用用户查询和 fallback 行为。

## 四、常见错误码

| 状态码 | 错误码            | 说明       |
| ------ | ----------------- | ---------- |
| 400    | `M_INVALID_PARAM` | 参数无效   |
| 401    | `M_UNAUTHORIZED`  | 未认证     |
| 404    | `M_NOT_FOUND`     | 协议不存在 |

## 五、变更历史

| 日期       | 变更                                           | 影响              |
| ---------- | ---------------------------------------------- | ----------------- |
| 2026-04-27 | 初版                                           | -                 |
| 2026-05-11 | 补齐 thirdparty 直连协议查询与 v3 通用查询封装 | 覆盖率更新为 100% |
