# API 契约文档索引

> 更新日期: 2026-04-27

## 核心客户端 API

| 模块 | 文档 | 端点数 | SDK 覆盖率 | 优先级 |
|------|------|--------|-----------|--------|
| 认证 | [auth.md](auth.md) | 15+ | 95% | ✅ 完善 |
| 账户数据 | [account-data.md](account-data.md) | 10+ | 90% | ✅ 完善 |
| 设备管理 | [device.md](device.md) | 8+ | 85% | ✅ 完善 |
| 房间 | [room.md](room.md) | 50+ | 80% | ✅ 完善 |
| 同步 | [sync.md](sync.md) | 5+ | 90% | ✅ 完善 |
| 推送 | [push.md](push.md) | 12+ | 85% | ✅ 完善 |

## 社交功能 API

| 模块 | 文档 | 端点数 | SDK 覆盖率 | 优先级 |
|------|------|--------|-----------|--------|
| 好友 | [friend.md](friend.md) | 25 | 100% | ✅ 完善 |
| 私聊 | [dm.md](dm.md) | 8+ | 90% | ✅ 完善 |
| 空间 | [space.md](space.md) | 15+ | 85% | ✅ 完善 |
| 在线状态 | [presence.md](presence.md) | 5 | 80% | ⚠️ 待提升 |

## 加密 API

| 模块 | 文档 | 端点数 | SDK 覆盖率 | 优先级 |
|------|------|--------|-----------|--------|
| E2EE 核心 | [e2ee.md](e2ee.md) | 15+ | 75% | ⚠️ 待提升 |
| 密钥备份 | [key-backup.md](key-backup.md) | 16 | 0% | 🔴 紧急 |
| 密钥轮换 | [key-rotation.md](key-rotation.md) | 6 | 0% | 🔴 紧急 |
| 设备验证 | [verification.md](verification.md) | 10+ | 70% | ⚠️ 待提升 |

## 媒体与内容 API

| 模块 | 文档 | 端点数 | SDK 覆盖率 | 优先级 |
|------|------|--------|-----------|--------|
| 媒体 | [media.md](media.md) | 18 | 78% | ⚠️ 待提升 |
| 语音 | [voice.md](voice.md) | 11 | 70% | ⚠️ 待提升 |
| 房间摘要 | [room-summary.md](room-summary.md) | 12+ | 75% | ⚠️ 待提升 |

## 交互功能 API

| 模块 | 文档 | 端点数 | SDK 覆盖率 | 优先级 |
|------|------|--------|-----------|--------|
| 关系事件 | [relations.md](relations.md) | 5 | 60% | ⚠️ 待提升 |
| 反应 | [reactions.md](reactions.md) | 1 | 100% | ✅ 完善 |
| 输入状态 | [typing.md](typing.md) | 3 | 33% | ⚠️ 待提升 |
| 线程 | [thread.md](thread.md) | 21 | 80% | ✅ 完善 |
| Widget | [widget.md](widget.md) | 17 | 75% | ⚠️ 待提升 |

## 审核与安全 API

| 模块 | 文档 | 端点数 | SDK 覆盖率 | 优先级 |
|------|------|--------|-----------|--------|
| 内容审核 | [moderation.md](moderation.md) | 4 | 25% | ⚠️ 待提升 |
| 事件举报 | [event-report.md](event-report.md) | 3 | 0% | 🔴 待封装 |

## 管理员 API

| 模块 | 文档 | 端点数 | SDK 覆盖率 | 优先级 |
|------|------|--------|-----------|--------|
| 管理核心 | [admin.md](admin.md) | 140+ | 59% | ⚠️ 待提升 |
| 联邦 | [federation.md](federation.md) | 20+ | 60% | ⚠️ 待提升 |
| Worker | [worker-admin.md](worker-admin.md) | 15+ | 40% | ⚠️ 待提升 |
| 遥测 | [telemetry.md](telemetry.md) | 6 | 0% | 🔴 待封装 |
| 特性开关 | [feature-flags.md](feature-flags.md) | 4 | 0% | 🔴 待封装 |
| 后台更新 | [background-update.md](background-update.md) | 10 | 0% | 🔴 待封装 |

## 集成 API

| 模块 | 文档 | 端点数 | SDK 覆盖率 | 优先级 |
|------|------|--------|-----------|--------|
| 第三方集成 | [thirdparty.md](thirdparty.md) | 6 | 67% | ⚠️ 待提升 |
| 应用服务 | [app-service.md](app-service.md) | 5 | 0% | 🔴 待封装 |
| Rendezvous | [rendezvous.md](rendezvous.md) | 3 | 80% | ✅ 完善 |

## 总览统计

- **总文档数**: 36
- **总端点数**: ~500
- **平均 SDK 覆盖率**: ~65%
- **完善模块**: 10 (28%)
- **待提升模块**: 15 (42%)
- **待封装模块**: 11 (30%)

## 图例

- ✅ 完善：SDK 覆盖率 ≥ 85%
- ⚠️ 待提升：SDK 覆盖率 50-84%
- 🔴 紧急/待封装：SDK 覆盖率 < 50%
