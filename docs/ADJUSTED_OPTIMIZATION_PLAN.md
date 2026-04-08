# Matrix JS SDK 调整后的优化方案
## 基于后端最新实现状态

**日期**: 2026-04-08  
**调整原因**: Sliding Sync、Beacons、Location 已在后端完整实现

---

## 一、调整说明

### 1.1 功能状态更新

#### ✅ 需要保留的功能（后端已实现）
- **Sliding Sync** - 后端已完整实现，保留 ✅
- **Beacons** - 后端已完整实现，需要恢复 ✅
- **Location** - 后端已完整实现，需要恢复 ✅

#### ❌ 可以移除的功能（后端未实现）
- **Polls** - 后端无相关端点，前端仅基础实现
- **Extensible Events v1** - 后端无支持，前端未使用

### 1.2 当前状态
根据 git status，以下文件已添加/修改：
- `src/@types/beacon.ts` - 新增 ✅
- `src/@types/location.ts` - 新增 ✅
- `src/beacon/index.ts` - 新增 ✅
- `src/models/beacon.ts` - 新增/修改 ✅
- `src/client.ts` - 已修改
- `src/sliding-sync-sdk.ts` - 已修改

---

## 二、调整后的实施计划

### Phase 1: 移除不需要的功能 ✅ 部分完成

#### 1.1 移除 Polls 功能
```bash
# 移除 Poll 相关文件
rm -rf src/models/poll.ts
rm -rf spec/unit/models/poll.spec.ts
```

#### 1.2 移除 Extensible Events v1
```bash
# 移除可扩展事件 v1
rm -rf src/extensible_events_v1/
```

#### 1.3 更新导出文件
- 从 `src/matrix.ts` 移除 Poll 相关导出
- 确保 Beacon、Location 相关导出正确

### Phase 2: 依赖优化

#### 2.1 移除未使用的依赖
```bash
pnpm remove another-json unhomoglyph
```

#### 2.2 审查其他依赖
- 检查 `matrix-events-sdk` 使用情况
- 评估是否可以内联类型定义

### Phase 3: 性能优化

#### 3.1 缓存策略优化
- 统一 LRUCache 配置
- 优化事件缓存大小
- 使用 WeakMap 防止内存泄漏

#### 3.2 HTTP 请求优化
- 批量操作 API
- 优化 /sync 超时配置
- 减少不必要的轮询

#### 3.3 内存优化
- 优化事件缓存清理策略
- 及时清理过期数据
- 实现事件缓存自动清理

### Phase 4: 代码重构

#### 4.1 client.ts 继续瘦身
- 目标：从 5000+ 行减少到 2000 行
- 将更多功能迁移到 Manager
- 保持所有后端支持的 API

#### 4.2 类型定义优化
- 移除未使用的类型
- 合并重复的类型定义
- 优化类型导出结构

#### 4.3 事件类型优化
- 审查 50+ 个事件类型
- 合并相似事件
- 只保留前端实际监听的事件

### Phase 5: 构建优化

#### 5.1 Tree-shaking 配置
- 优化 rollup 配置
- 确保未使用代码被正确移除

#### 5.2 代码分割
- 按功能模块分割
- 实现按需加载

#### 5.3 构建产物优化
- 优化 sourcemap 生成
- 减少构建产物体积

---

## 三、必须保留的功能清单

### 3.1 核心功能
✅ E2EE 完整功能（密钥管理、备份、验证、信任）
✅ WebRTC（TURN 服务器配置）
✅ Widget（状态事件支持）
✅ **Sliding Sync**（后端已实现）
✅ **Beacons**（后端已实现）
✅ **Location**（后端已实现）
✅ Rendezvous（会合协议）
✅ Guest 访问（后端支持）
✅ OIDC/SAML/CAS 认证

### 3.2 HuLa 自定义功能
✅ 好友管理（FriendManager）
✅ 直接消息（DirectMessageManager）
✅ 空间管理（SpaceManager）
✅ 管理功能（AdminManager）
✅ 房间摘要（RoomSummaryManager）
✅ 缓存管理（CacheManager）

### 3.3 标准 Matrix 功能
✅ 所有房间操作
✅ 所有设备管理功能
✅ 所有推送通知功能
✅ 所有同步功能
✅ 所有账户管理功能
✅ 所有媒体功能
✅ 所有关系功能（回复、编辑、反应、线程）

---

## 四、执行优先级

### 高优先级（立即执行）
1. ✅ 确认 Beacon/Location 功能已正确恢复
2. 移除 Polls 功能
3. 移除 Extensible Events v1
4. 移除未使用的依赖

### 中优先级（本周完成）
5. 缓存策略优化
6. HTTP 请求优化
7. 内存优化

### 低优先级（后续优化）
8. client.ts 继续瘦身
9. 类型定义优化
10. 构建优化

---

## 五、预期效果（调整后）

### 5.1 代码体积
| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| 源文件数 | 150+ | ~148 | -1.3% |
| 代码行数 | ~50,000 | ~48,500 | -3% |
| client.ts | 5000+ | ~2000 | -60% |

### 5.2 构建体积
| 指标 | 当前 | 优化后 | 改善 |
|------|------|--------|------|
| 未压缩 | ~2MB | ~1.9MB | -5% |
| Minified | ~800KB | ~760KB | -5% |
| Gzipped | ~500KB | ~475KB | -5% |

### 5.3 运行时性能
| 指标 | 改善 |
|------|------|
| 内存占用 | -10~15% |
| 初始化时间 | -15~20% |
| API 响应 | +10~15% |

---

## 六、风险评估

### 6.1 零风险项
✅ 移除 Polls（后端不支持）
✅ 移除 Extensible Events v1（后端不支持）
✅ 移除未使用的依赖
✅ 优化缓存策略
✅ 性能优化

### 6.2 需要测试的项
⚠️ 确保 Beacon/Location 功能完整
⚠️ 验证所有导出正确
⚠️ 运行完整测试套件

---

**文档版本**: v2.1（调整版）  
**创建时间**: 2026-04-08  
**状态**: 执行中
