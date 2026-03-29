# Matrix-JS-SDK API 契约文档

> 本目录包含 SDK 与后端的统一接口契约文档

## 目录结构

```
docs/
├── api-contract/
│   ├── auth.md          # 认证 API 契约
│   ├── room.md          # 房间 API 契约
│   ├── dm.md            # 私聊 API 契约
│   ├── friend.md        # 好友管理 API 契约
│   ├── admin.md         # 管理员 API 契约
│   ├── space.md         # 空间 API 契约
│   ├── push.md          # 推送 API 契约
│   ├── sync.md          # 同步 API 契约
│   ├── template.md      # 契约模板
│   ├── VERIFICATION_REPORT.md  # 一致性验证报告
│   └── CHANGELOG.md     # 变更日志
```

## 模块契约索引

| 模块 | 契约文件 | API 数量 | 状态 |
|------|----------|----------|------|
| Auth | [auth.md](./auth.md) | 5 | ✅ 完整 |
| Room | [room.md](./room.md) | 11 | ✅ 完整 |
| DM | [dm.md](./dm.md) | 4 | ✅ 完整 |
| Friend | [friend.md](./friend.md) | 15+ | ✅ 完整 |
| Admin | [admin.md](./admin.md) | 20+ | ✅ 完整 |
| Space | [space.md](./space.md) | 6 | ✅ 完整 |
| Push | [push.md](./push.md) | 8 | ✅ 完整 |
| Sync | [sync.md](./sync.md) | 6 | ✅ 完整 |
| **总计** | | **75+** | |

## 使用说明

### 契约条目格式

每个 API 契约包含：
- **后端路由**: Rust 路由路径
- **HTTP 方法**: GET/POST/PUT/DELETE
- **SDK 方法**: TypeScript 方法名
- **SDK 模块**: 所属 Manager
- **请求参数**: 类型与说明
- **响应结构**: 返回类型
- **状态码**: 成功/错误码
- **对应关系**: 后端/SDK/前端实现位置

### 验证契约

```bash
# 检查契约与代码一致性
cd /Users/ljf/Desktop/hu/matrix-js-sdk
pnpm lint:types

# 运行测试
cd /Users/ljf/Desktop/hu/matrix-js-sdk
pnpm test -- --run
```

## 更新流程

1. 后端 API 变更 → 更新对应契约文档
2. SDK 方法变更 → 同步更新契约文档
3. 运行测试验证一致性
4. 记录变更到 changelog.md
5. 运行 `pnpm lint:types` 确保无类型错误
