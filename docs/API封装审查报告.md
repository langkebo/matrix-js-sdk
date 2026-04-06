# API封装审查报告

## 1. 审查基线

- 审查对象：`/Users/ljf/Desktop/hu/matrix-js-sdk`
- 契约基线：`docs/api-contract/*.md`
- 自动审计脚本：`scripts/api-contract-audit.cjs`
- 本轮重点：`auth`、`device`、`presence`、`federation`、`space`、`room-summary`、`manager-extensions`

## 2. 自动审计摘要

### 2.1 契约侧统计

- 契约文件数：15
- 提取到的端点记录数：535
- 端点量最高的契约文档：
  - `admin.md`: 128
  - `auth.md`: 98
  - `room.md`: 88
  - `federation.md`: 49
  - `friend.md`: 28

### 2.2 源码侧统计

- 扫描到的源码文件数：349
- 扫描到的请求调用点：343
- 自动命中的“双前缀”风险调用点：0
- `MatrixClient` Manager 声明数：115
- `MatrixClient.prototype` 实际挂载数：115
- 默认初始化的 Manager 模块数：31
- 审计脚本当前已支持 AST 级路径提取与稳定前缀归一化：
  - `encodeUri(...)`
  - `spacePath(...)`
  - 局部变量与条件分支中的 `path` / `method` / `prefix`
  - `/_matrix/client/{r0,v1,v3}`、`/_matrix/media/{r0,v1,v3}`、`/_matrix/identity/{v1,v2}` 家族归一化
- 最新静态覆盖结果：
  - 归一化契约端点：498
  - 已命中端点：159
  - 缺失端点：339
  - 额外端点：85

### 2.3 模块覆盖率评级

> 说明：当前仓库大量能力仍直接落在 `client.ts`，所以这里给出的是“契约对 SDK 封装层的静态覆盖评级”，不是 1:1 的精确实现率。

| 模块 | 契约端点数 | 当前封装情况 | 覆盖评级 |
|------|-----------|-------------|---------|
| Auth | 98 | 核心能力主要在 `client.ts`，`AuthManager` 很薄 | 中 |
| Room | 88 | `client.ts` 覆盖较多，`RoomManager` 仍偏薄代理 | 中高 |
| Sync | 10 | `client.ts` 已覆盖主要同步 API，专用 Manager 不明显 | 中高 |
| Admin | 128 | `AdminManager` 仅覆盖子集 | 中低 |
| Room Summary | 19 | 读取类较多，写/维护类缺失明显 | 中低 |
| Space | 24 | `SpaceManager` 主要是本地状态拼装，不是契约驱动 HTTP 封装 | 低 |
| Device | 6 | 端点数少，但曾存在路径拼装问题 | 中 |
| Presence | 4 | 端点集中，但曾存在路径拼装问题 | 中 |

## 3. 本轮已修复

### 3.1 已落地修复

1. `AuthManager.getSupportedLoginFlows()` 改为走公开 `request()`，不再错误注入 Bearer Token。
2. `DeviceManager` 改为使用相对路径：
   - `/devices`
   - `/devices/{deviceId}`
   - `/delete_devices`
3. `PresenceManager` 改为使用相对路径：
   - `/presence/{userId}/status`
   - `/presence/list`
4. `FederationManager` 改为：
   - 管理端请求使用 `AdminPrefix.V1`
   - 公共房间查询使用 `/publicRooms` + `ClientPrefix.V3`
5. `matrix-client-extensions.d.ts` 的 `getDeviceManager()` 类型声明改为与运行时实现一致，指向 `./device/index`
6. `MatrixClient` Manager 三元对齐已收敛：
   - 类型声明：115
   - 运行时原型挂载：115
   - 默认初始化模块：31
   - `declaredOnlyManagers` / `implementedOnlyManagers` 已清零
7. 审计脚本 `scripts/api-contract-audit.cjs` 已增强为：
   - AST 提取 `encodeUri(...)`、`spacePath(...)`、局部变量与条件分支
   - 过滤无法静态还原的表达式噪音
   - 统一稳定版本前缀，避免 `r0/v1/v3` 重复放大缺口
8. `DiscoveryManager.getServerDiscoveryInfo()` 改为公开请求，使用 `prefix: ""` 访问 `/.well-known/matrix/client`
9. `GuestManager.canJoinRoom()` 不再使用非标准 `GET /join/{room}` 探测：
   - 房间别名走 `GET /directory/room/{alias}`
   - 房间 ID 仅做本地已知房间判断
10. `ExternalServiceManager` 改为统一使用相对路径 + `AdminPrefix.V1`
11. 已按 `extraEndpoints` 三分类补齐第一批契约文档：
   - `admin.md` 补入 `application_services`、`saml/*`
   - `auth.md` 补入 SAML 登录、secure backup、appservice alias/user、thirdparty protocol
   - `media.md` 补入 `voice/*`
   - `room.md` 补入 widget capabilities / send
12. 已补齐第二批高置信契约缺口：
   - `auth.md` 补入 `/_matrix/client/v1/auth_metadata` 与 legacy `/_matrix/client/unstable/org.matrix.msc2965/auth_issuer`
   - `auth.md` 补入 `thirdparty/protocols|location|user`
   - `media.md` 补入 `/_matrix/client/v1/media/config`

### 3.2 已补充测试

- 新增 `spec/unit/api-encapsulation-audit.spec.ts`
- 覆盖点：
  - 公开登录流请求不带 token
  - Device 路径使用相对 path + `ClientPrefix.V3`
  - Presence 路径使用相对 path + `ClientPrefix.V3`
  - Federation 黑名单请求使用 `AdminPrefix.V1`
  - Federation 公共房间请求使用相对 path + `ClientPrefix.V3`

## 4. 关键问题分级

### 4.1 致命

#### A. SDK 未强制 HTTPS

- `FetchHttpApi` 仅拼接 `baseUrl + prefix + path`，未限制 `http://`
- 在不安全环境下，敏感请求可能明文经过中间链路
- 业务影响：P0
- 建议：
  - 默认拒绝非 HTTPS `baseUrl`
  - 仅在显式 `allowInsecureHttp` 开关下允许本地开发 HTTP

### 4.2 严重

#### B. `SpaceManager` 与契约严重漂移

- 契约定义的是一整套 `/spaces/*` HTTP 路由。
- 当前 `src/space/index.ts` 主要依赖：
  - `client.createRoom`
  - `room.currentState`
  - `sendStateEvent`
  - 本地缓存
- 缺失的高价值契约接口包括：
  - `GET /spaces/public`
  - `GET /spaces/search`
  - `GET /spaces/statistics`
  - `GET /spaces/{space_id}/rooms`
  - `GET /spaces/{space_id}/summary`
  - `GET /spaces/{space_id}/tree_path`
  - `GET /spaces/room/{room_id}/parents`
- 业务影响：P1
- 预计开发量：2.5 人日

#### C. `RoomSummaryManager` 偏读路径，写/维护路径未覆盖

- 已有方法主要覆盖：
  - `GET /rooms/{room_id}/summary`
  - `GET /rooms/{room_id}/summary/members`
  - `GET /rooms/{room_id}/summary/stats`
- 缺失的高价值契约接口包括：
  - `POST /rooms/{room_id}/summary/sync`
  - `GET/PUT /rooms/{room_id}/summary/state/{event_type}/{state_key}`
  - `POST /rooms/{room_id}/summary/stats/recalculate`
  - `POST /rooms/{room_id}/summary/heroes/recalculate`
  - `POST /rooms/{room_id}/summary/unread/clear`
  - `GET/POST /_synapse/room_summary/v1/summaries`
- 业务影响：P1
- 预计开发量：2 人日

### 4.3 一般

#### D. 过度封装 / 重复封装

- `src/device-management/index.ts` 与 `src/device/index.ts` 语义重复
- `FederationBlacklistManager` 与 `FederationManager` 黑名单能力重复
- `SpaceManager` 名义上是 API Manager，实际上更多是本地编排层
- 业务影响：P2
- 预计开发量：1 人日

#### E. 输入校验不一致

- 局部模块有枚举或非空校验，但缺少统一 Matrix 标识校验：
  - 用户 ID: `@user:server`
  - 房间别名: `#room:server`
  - 事件类型: `m.*`
- 业务影响：P2
- 预计开发量：1.5 人日

#### F. GET 缓存与请求合并未形成通用机制

- 未见统一的 ETag / Last-Modified 协商缓存处理
- `/sync` 的 `since` 参数已有支持，但其余 GET 缓存未体系化
- 未见系统性的 `/whoami + /capabilities + /filter/create` 启动并发/合并编排
- 业务影响：P2
- 预计开发量：2 人日

## 5. 缺失接口清单

| 接口组 | 缺失示例 | 影响等级 | 阻塞功能点 | 预计开发人日 |
|-------|---------|---------|-----------|-------------|
| Space | `/spaces/public` `/spaces/search` `/spaces/statistics` | P1 | 公开 Space 发现、检索、统计面板 | 1.0 |
| Space | `/spaces/{space_id}/summary` `/tree_path` `/rooms` `/parents` | P1 | Space 层级导航与父子链路展示 | 1.5 |
| Room Summary | `/summary/sync` `/summary/state/*` | P1 | 摘要同步与增量维护 | 1.0 |
| Room Summary | `/summary/stats/recalculate` `/heroes/recalculate` `/unread/clear` | P1 | 摘要修复、统计回填、未读纠偏 | 1.0 |
| Admin | `/audit/events` `/reports` `/retention/*` `/user_sessions/*` | P1 | 审计、举报、保留策略、会话治理 | 2.0 |
| Admin | `/notifications*` `/server_notices` `/experimental_features` | P2 | 运维通知与平台开关管理 | 1.5 |

## 6. `extraEndpoints` 三分类清单

> 说明：以下结论基于最新 `scripts/api-contract-audit.cjs` 输出与源码复核，目标是把剩余 `extraEndpoints` 直接拆成“改合同 / 改实现 / 待决策”三条处理线，而不是继续混在一份噪音列表里。

### 6.1 应改合同

| 类别 | 本轮动作 | 当前状态 |
|------|---------|---------|
| Admin Application Service | `admin.md` 已补入 `/_synapse/admin/v1/application_services*` | 已从 `extraEndpoints` 移除 |
| Admin SAML | `admin.md` 已补入 `/_synapse/admin/v1/saml/*` | 已从 `extraEndpoints` 移除 |
| Secure Backup | `auth.md` 已补入 `/_matrix/client/v3/keys/backup/secure*` | 已从 `extraEndpoints` 移除 |
| Voice 扩展接口 | `media.md` 已补入 `/_matrix/client/v3/voice/*` | 已从 `extraEndpoints` 移除 |
| Widget 扩展接口 | `room.md` 已补入 `rooms/{room_id}/widgets/{widget_id}/*` | 已从 `extraEndpoints` 移除 |
| Thirdparty / Media Config / OIDC Metadata | `auth.md`、`media.md` 已补入高置信稳定端点 | 已从 `extraEndpoints` 移除或仅剩 legacy fallback |

### 6.2 应改实现

| 文件 | 本轮修复 | 修复后状态 |
|------|---------|-----------|
| `src/discovery/index.ts` | `/.well-known/matrix/client` 改为公开请求 + `prefix: ""` | 已从 `extraEndpoints` 移除 |
| `src/guest/index.ts` | 移除非标准 `GET /join/{room}` 探测，改走目录查询 / 本地判断 | 已从 `extraEndpoints` 移除 |
| `src/external-service/index.ts` | 管理端外部服务统一改为相对路径 + `AdminPrefix.V1` | 已从 `extraEndpoints` 移除 |

### 6.3 待决策 / 人工复核

| 类别 | 代表端点 | 待确认点 | 当前建议 |
|------|---------|---------|---------|
| Unstable MSC | `/_matrix/client/unstable/org.matrix.msc*` | 是否纳入正式契约基线，还是单独维护实验接口清单 | 单独做 `unstable-mscs.md` 或从主契约统计中排除 |
| Identity Server | `/_matrix/identity/{stable}/*`、`POST /account/register` | 是否属于 SDK 主契约范围，还是外部 identity service 能力 | 单独维护 identity 契约，不与 client/media/admin 混合统计 |
| OIDC Discovery | legacy `/_matrix/client/unstable/org.matrix.msc2965/auth_issuer` fallback | 稳定 `auth_metadata` 已入文档，但审计仍对 legacy fallback 和泛化稳定前缀存在口径差异 | 保留为兼容项，必要时单独在脚本中排除 fallback 噪音 |
| Media Preview | `/_matrix/media/{stable}/preview_url` | 当前仅确认传统 media preview 文档，是否存在更多稳定变体需再核后端 | 先核后端路由，再决定补合同还是收敛脚本 |
| Burn After Read | `/_matrix/client/{stable}/rooms/{room_id}/burn*`、`/user/burn/config` | 现有文档只在审查材料出现，主契约未形成正式章节 | 先定是否纳入正式产品能力，再补契约或标注实验性 |

## 7. 过度封装清单

| 模块 | 类型 | 风险 | 处理建议 |
|------|------|------|---------|
| `device-management` | 冗余实现 | 与 `device` 双实现漂移 | 标记废弃并迁移引用 |
| `FederationBlacklistManager` | 子集重复 | 与 `FederationManager` 能力重叠 | 合并到主 Manager |
| `SpaceManager` | 名义过度封装 | 名称暗示 HTTP API，但实现是本地状态编排 | 拆成 `SpaceApiManager + SpaceViewService` |

## 8. 安全实现审查

### 8.1 已验证

- `FetchHttpApi` 默认使用 `Authorization: Bearer <token>`
- 当 `useAuthorizationHeader = false` 时才回退到 query param
- `M_UNKNOWN_TOKEN` 已接入并发安全的 refresh 流程与登出事件

### 8.2 风险与缺口

- 未强制 HTTPS，存在不安全 `baseUrl` 风险
- 未见统一的 Matrix 标识输入校验层
- 未见 SDK 侧 `X-Matrix` 请求签名实现
- `adminRegister()` 仅透传 `mac`，不负责生成签名
- 本轮环境无 `wireshark` 与受控远端链路，未执行抓包验证；TLS1.2+、GZIP、chunked 仅能给出静态结论，不能给出链路实测证明

## 9. 性能优化检查

### 9.1 结论

- `/sync` 相关能力在 `client.ts` 中具备 `since` / 分页参数支持，主链路可用
- SDK 未形成统一的 GET 协商缓存策略
- 未形成统一的初始化请求合并策略
- 大量薄封装 Manager 会增加维护成本和路径漂移概率

### 9.2 性能基准

> 说明：本轮没有受控的真实 homeserver 压测环境，也没有抓包工具；因此不能给出可信的真实网络性能结果。以下仅记录当前可交付状态，防止误判为“已压测通过”。

| 指标 | 结果 | 说明 |
|------|------|------|
| QPS | 未测 | 缺少真实服务端和稳定数据集 |
| P99 延迟 | 未测 | 缺少真实网络链路压测 |
| 内存占用 | 未测 | 缺少长时同步/大房间场景压测 |

## 10. 修复建议示例

### 10.1 URL 组装

```ts
// 错误
client.http.authedRequest(Method.Get, "/_matrix/client/v3/devices", undefined, undefined, {
    prefix: ClientPrefix.V3,
});

// 正确
client.http.authedRequest(Method.Get, "/devices", undefined, undefined, {
    prefix: ClientPrefix.V3,
});
```

### 10.2 管理端前缀

```ts
// 错误
client.http.authedRequest(Method.Get, "/_synapse/admin/v1/federation/blacklist", undefined, undefined, {
    prefix: ClientPrefix.V3,
});

// 正确
client.http.authedRequest(Method.Get, "/federation/blacklist", undefined, undefined, {
    prefix: AdminPrefix.V1,
});
```

## 11. 可执行测试集

- 当前新增：`spec/unit/api-encapsulation-audit.spec.ts`
- 建议继续补齐三类测试：
  - 正向：契约成功路径
  - 负向：`401` `403` `404` `429` `M_UNKNOWN_TOKEN`
  - 边界：空字符串、超长字符串、Unicode、极值数字

## 12. 结论

- 本轮确认 `matrix-js-sdk` 仍存在“契约文档已整理，但 SDK 封装层未完全契约化”的系统性问题；不过 Manager 对齐与静态审计噪音已明显收敛。
- `extraEndpoints` 已可直接拆成三条主线：补合同、改实现、人工决策，不再需要把它们统一当成脚本误报处理。
- 已完成 Manager 声明 / 运行时挂载 / 默认初始化对齐，并增强了 AST 审计脚本。
- 后续最值得优先推进的主线：
  1. 推进 HTTPS 强制策略与开发豁免开关
  2. 重做 `SpaceManager`
  3. 补齐 `RoomSummaryManager` 写路径
  4. 按“三分类清单”分别处理合同缺口与实现偏差
