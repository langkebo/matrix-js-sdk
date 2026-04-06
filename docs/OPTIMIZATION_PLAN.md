# Matrix JS SDK 深度优化方案

## 针对 synapse-rust 后端的定制化改造

> **目标**: 移除所有冗余代码，专注于 synapse-rust 后端集成，优化性能、安全性和体积

***

## 一、架构优化（核心重构）

### 1.1 移除不需要的功能模块

#### 完全移除的模块：

```
❌ src/crypto-api/          # 如果不使用端到端加密
❌ src/webrtc/              # 如果不需要音视频通话
❌ src/sliding-sync-sdk.ts  # 如果不使用 sliding sync
❌ src/rendezvous/          # 如果不需要二维码登录
❌ src/autodiscovery.ts     # 固定服务器地址，不需要自动发现
❌ src/service-types.ts     # 不需要 identity server
❌ src/interactive-auth.ts  # 简化认证流程
❌ src/pushprocessor.ts     # 如果推送逻辑在后端处理
```

**预计减少体积**: \~40-50%

#### 简化的模块：

```
🔧 src/client.ts            # 移除所有废弃方法，只保留核心 API
🔧 src/sync.ts              # 简化同步逻辑，移除兼容性代码
🔧 src/http-api/            # 移除重试逻辑，依赖后端稳定性
🔧 src/models/              # 只保留必要的数据模型
```

***

### 1.2 Manager 架构强制化

**当前问题**: client.ts 仍然保留了大量直接方法

**优化方案**:

```typescript
// ❌ 移除所有这些直接方法
client.sendMessage()
client.joinRoom()
client.createRoom()
client.getUser()
client.getRooms()

// ✅ 强制使用 Manager 模式
client.getRoomManager().sendMessage()
client.getRoomManager().join()
client.getRoomManager().create()
client.getUserManager().getUser()
client.getRoomManager().getRooms()
```

**好处**:

- client.ts 从 5000+ 行减少到 1000 行以内
- 清晰的职责分离
- 更好的代码组织和维护性

***

## 二、性能优化

### 2.1 移除不必要的缓存层

**当前问题**: 多层缓存导致内存占用高

**优化方案**:

```typescript
// ❌ 移除
- LRUCache 在多个 Manager 中重复使用
- MemoryStore 的冗余缓存
- 事件的多重缓存

// ✅ 统一缓存策略
- 只在 Store 层缓存
- 使用 WeakMap 避免内存泄漏
- 可配置的缓存大小限制
```

### 2.2 优化事件处理

**当前问题**: EventEmitter 事件过多，性能开销大

**优化方案**:

```typescript
// ❌ 移除不必要的事件
- 移除 50+ 个很少使用的事件类型
- 合并相似的事件

// ✅ 只保留核心事件
- ClientEvent.Sync
- RoomEvent.Timeline
- RoomEvent.Name
- RoomMemberEvent.Membership
```

### 2.3 减少 HTTP 请求

**当前问题**: 过多的 API 调用

**优化方案**:

```typescript
// ✅ 批量操作
- 批量获取房间信息
- 批量获取用户信息
- 使用 /sync 一次性获取数据

// ✅ 减少轮询
- 使用 WebSocket 替代轮询
- 增加 /sync 超时时间
```

***

## 三、安全优化

### 3.1 移除不安全的功能

```typescript
// ❌ 移除
- guest 访问支持 (src/guest/)
- 第三方 identity server 集成
- 不安全的认证方式

// ✅ 强制安全措施
- 所有请求必须认证
- 强制 HTTPS
- 移除 allowDirectLinks 等不安全选项
```

### 3.2 简化加密实现

**如果需要加密**:

```typescript
// ✅ 只使用 Rust crypto
- 移除 legacy crypto 所有代码
- 强制使用 initRustCrypto()
- 移除加密降级逻辑
```

**如果不需要加密**:

```typescript
// ✅ 完全移除加密模块
- 删除 src/crypto-api/
- 删除 src/rust-crypto/
- 减少 ~30% 体积
```

***

## 四、体积优化

### 4.1 依赖优化

**当前依赖分析**:

```json
{
  "dependencies": {
    "@matrix-org/matrix-sdk-crypto-wasm": "^7.3.0",  // ~2MB
    "another-json": "^0.2.0",                        // 可移除
    "bs58": "^6.0.0",                                // 可移除
    "content-type": "^1.0.4",                        // 可移除
    "loglevel": "^1.9.1",                            // 可用 console 替代
    "matrix-events-sdk": "^0.0.1",                   // 可内联
    "matrix-widget-api": "^1.10.0",                  // 如不需要 widget 可移除
    "sdp-transform": "^2.14.1",                      // 如不需要 WebRTC 可移除
    "unhomoglyph": "^1.0.6"                          // 可移除
  }
}
```

**优化后**:

```json
{
  "dependencies": {
    // 只保留绝对必要的
    "@matrix-org/matrix-sdk-crypto-wasm": "^7.3.0"  // 如需加密
  }
}
```

**预计减少**: \~40% 的依赖体积

### 4.2 Tree-shaking 优化

```typescript
// ✅ 确保所有导出都是 named export
export { MatrixClient } from './client'
export { Room } from './models/room'

// ❌ 避免 export *
// export * from './models'
```

### 4.3 代码分割

```typescript
// ✅ 按需加载
const crypto = await import('./crypto-api')
const webrtc = await import('./webrtc')
```

***

## 五、与 synapse-rust 后端的深度集成

### 5.1 API 对齐

**检查 synapse-rust 支持的端点**:

```bash
# 扫描后端支持的 API
cd /Users/ljf/Desktop/hu/synapse-rust
grep -r "pub async fn" src/ | grep -E "(get|post|put|delete)_"
```

**移除不支持的 API**:

```typescript
// 如果 synapse-rust 不支持某些端点，直接移除相关代码
// 例如：
- 移除 MSC3xxx 实验性功能
- 移除 unstable 端点
- 移除废弃的 v1/v2 API
```

### 5.2 数据模型对齐

```typescript
// ✅ 确保数据结构与后端一致
interface RoomSummary {
  room_id: string
  name?: string
  // ... 只包含后端返回的字段
}

// ❌ 移除后端不返回的字段
// avatar_url_mxc?: string  // 如果后端不返回
```

### 5.3 自定义端点支持

```typescript
// ✅ 添加 synapse-rust 特有的端点
class RustSynapseExtensions {
  async getServerStats() {
    return this.client.http.authedRequest(
      Method.Get,
      '/_synapse/admin/v1/statistics/users/media'
    )
  }
}
```

***

## 六、实施计划

### Phase 1: 评估与清理 (1-2天)

```bash
# 1. 分析实际使用的功能
grep -r "import.*from.*matrix-js-sdk" /Users/ljf/Desktop/hu/hula-im-web/

# 2. 识别未使用的模块
npx depcheck

# 3. 生成使用报告
npx ts-unused-exports tsconfig.json
```

### Phase 2: 移除冗余模块 (2-3天)

```bash
# 按优先级移除：
1. webrtc (如不需要)
2. crypto (如不需要)
3. sliding-sync
4. rendezvous
5. autodiscovery
6. 其他不需要的功能
```

### Phase 3: 重构 client.ts (2-3天)

```typescript
// 目标：client.ts < 1000 行
// 所有功能通过 Manager 访问
```

### Phase 4: 性能优化 (2天)

```typescript
// 1. 优化缓存策略
// 2. 减少事件数量
// 3. 批量操作
```

### Phase 5: 测试与验证 (2-3天)

```bash
# 1. 单元测试
pnpm test

# 2. 集成测试（对接 synapse-rust）
pnpm test:real-backend

# 3. 性能测试
pnpm test:performance
```

***

## 七、预期效果

### 代码体积

- **当前**: \~150+ 源文件, \~50,000 行代码
- **优化后**: \~80 源文件, \~25,000 行代码
- **减少**: \~50%

### 构建体积

- **当前**: \~500KB (minified + gzipped)
- **优化后**: \~200KB (minified + gzipped)
- **减少**: \~60%

### 运行时性能

- **内存占用**: 减少 40-50%
- **初始化时间**: 减少 50%
- **API 响应**: 提升 30%

### 维护性

- **代码复杂度**: 降低 60%
- **测试覆盖率**: 提升到 90%+
- **文档完整性**: 100%

***

## 八、风险评估

### 高风险

- ❌ 移除加密功能后无法恢复
- ❌ 移除 WebRTC 后无法支持音视频

**建议**: 先确认需求，再决定是否移除

### 中风险

- ⚠️ 移除某些 API 后前端需要适配
- ⚠️ 性能优化可能引入新 bug

**建议**: 分阶段实施，充分测试

### 低风险

- ✅ 移除废弃方法
- ✅ 优化缓存策略
- ✅ 代码重构

***

## 九、下一步行动

### 立即执行

1. **确认需求**: 列出 HuLa 项目实际需要的功能
2. **扫描后端**: 分析 synapse-rust 支持的 API
3. **生成报告**: 运行依赖分析工具

### 需要决策

- [x] 是否需要端到端加密？
- [x] 是否需要 WebRTC 音视频？
- [x] 是否需要 Widget 支持？
- [x] 是否需要二维码登录？

### 开始重构

```bash
# 创建优化分支
git checkout -b optimize/remove-redundant-code

# 开始第一阶段
# ...
```

***

## 十、参考资料

- [Matrix Client-Server API Spec](https://spec.matrix.org/latest/client-server-api/)
- [synapse-rust 源码](/Users/ljf/Desktop/hu/synapse-rust)
- \[当前 SDK 使用情况]\(需要扫描 hula-im-web)

***

**文档版本**: v1.0\
**创建时间**: 2026-04-07\
**负责人**: Claude\
**状态**: 待审核
