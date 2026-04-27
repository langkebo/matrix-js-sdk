# 版本策略和 API 兼容性指南

**版本**: v1.0  
**生效日期**: 2026-04-15  
**适用范围**: matrix-js-sdk v40.2.0+

---

## 目录

- [语义化版本](#语义化版本)
- [API 弃用周期](#api-弃用周期)
- [破坏性变更](#破坏性变更)
- [迁移指南](#迁移指南)
- [版本发布流程](#版本发布流程)
- [兼容性承诺](#兼容性承诺)

---

## 语义化版本

matrix-js-sdk 遵循 [语义化版本 2.0.0](https://semver.org/) 规范。

### 版本号格式

```
MAJOR.MINOR.PATCH
```

- **MAJOR**: 包含破坏性变更的版本
- **MINOR**: 向后兼容的新功能
- **PATCH**: 向后兼容的 bug 修复

### 版本号示例

```
40.2.0 → 当前版本
40.3.0 → 新增功能（向后兼容）
40.2.1 → Bug 修复
41.0.0 → 破坏性变更
```

---

## API 弃用周期

### 弃用流程

1. **标记阶段** (当前版本)
   - 在代码中添加 `@deprecated` 标记
   - 在文档中说明替代方案
   - 在 CHANGELOG 中记录

2. **警告阶段** (至少 2 个 minor 版本)
   - 保持功能正常工作
   - 在开发环境中输出警告
   - 提供迁移指南

3. **移除阶段** (下一个 major 版本)
   - 完全移除已弃用的 API
   - 在 CHANGELOG 中详细说明
   - 提供自动化迁移工具（如果可能）

### 弃用标记格式

```typescript
/**
 * Get user list (legacy format)
 *
 * @deprecated Use {@link getUsersPaginated} for consistent pagination format.
 * This method will be removed in v41.0.0 (estimated 2026-Q4).
 * 
 * Migration:
 * ```typescript
 * // Old
 * const result = await adminManager.getUsers(from, limit);
 * result.users.forEach(user => ...);
 * 
 * // New
 * const result = await adminManager.getUsersPaginated({ from, limit });
 * result.items.forEach(user => ...);
 * ```
 */
async getUsers(from?: string, limit?: number): Promise<{ users: UserInfo[]; next_token?: string }> {
    // Implementation
}
```

### 运行时警告

```typescript
function deprecationWarning(
    oldMethod: string,
    newMethod: string,
    removeVersion: string,
    migrationUrl?: string
): void {
    if (process.env.NODE_ENV !== "production") {
        console.warn(
            `[DEPRECATED] ${oldMethod} is deprecated and will be removed in ${removeVersion}.\n` +
            `Use ${newMethod} instead.\n` +
            (migrationUrl ? `Migration guide: ${migrationUrl}` : "")
        );
    }
}

// 使用示例
async getUsers(from?: string, limit?: number) {
    deprecationWarning(
        "getUsers()",
        "getUsersPaginated()",
        "v41.0.0",
        "https://github.com/matrix-org/matrix-js-sdk/blob/develop/docs/MIGRATION_GUIDE.md#getusers"
    );
    // Implementation
}
```

---

## 破坏性变更

### 什么是破坏性变更

以下情况被视为破坏性变更，需要增加 MAJOR 版本号：

1. **删除公共 API**
   - 删除类、方法、属性
   - 删除导出的类型或接口

2. **修改 API 签名**
   - 修改方法参数（添加必需参数、删除参数、改变参数顺序）
   - 修改返回值类型
   - 修改异常类型

3. **修改行为**
   - 改变方法的默认行为
   - 改变错误处理逻辑
   - 改变数据格式

4. **修改依赖**
   - 升级主要依赖的 MAJOR 版本
   - 删除对某个平台的支持

### 非破坏性变更

以下情况不被视为破坏性变更：

1. **添加新功能**
   - 添加新的类、方法、属性
   - 添加可选参数
   - 添加新的导出

2. **Bug 修复**
   - 修复不符合文档说明的行为
   - 修复安全漏洞

3. **性能优化**
   - 不改变 API 行为的性能优化

4. **文档更新**
   - 改进文档、注释、示例

### 破坏性变更的处理

1. **提前通知**
   - 在至少 2 个 minor 版本前标记为 deprecated
   - 在 CHANGELOG 中详细说明

2. **提供迁移路径**
   - 提供替代 API
   - 提供迁移指南
   - 提供自动化工具（如果可能）

3. **版本发布**
   - 在 CHANGELOG 中突出显示
   - 在 GitHub Release 中详细说明
   - 发布博客文章（重大变更）

---

## 迁移指南

### 当前的迁移

#### v40.x → v41.0.0 (计划中)

**预计发布时间**: 2026-Q4

**破坏性变更**:

1. **移除已弃用的分页方法**
   ```typescript
   // ❌ 将被移除
   getUsers(from?: string, limit?: number)
   getRooms(from?: string, limit?: number, searchTerm?: string)
   
   // ✅ 使用新方法
   getUsersPaginated(options?: { from?: string; limit?: number })
   getRoomsPaginated(options?: { from?: string; limit?: number; searchTerm?: string })
   ```

2. **统一错误类型**
   ```typescript
   // ❌ 旧的错误处理
   catch (error) {
       if (error.errcode === "M_NOT_FOUND") { ... }
   }
   
   // ✅ 新的错误处理
   catch (error) {
       if (error instanceof NotFoundError) { ... }
   }
   ```

**迁移步骤**:

1. 更新所有使用 `getUsers()` 的代码为 `getUsersPaginated()`
2. 更新所有使用 `getRooms()` 的代码为 `getRoomsPaginated()`
3. 更新错误处理代码使用新的错误类型
4. 运行测试确保一切正常

**自动化迁移工具**:

```bash
# 使用 codemod 自动迁移（计划中）
npx @matrix-org/js-sdk-codemod v40-to-v41 src/
```

### 历史迁移

#### v39.x → v40.0.0

**主要变更**:
- 移除 legacy crypto 支持
- 统一 Manager 模式
- 引入 BaseManager 基类

详见: [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)

---

## 版本发布流程

### 发布周期

- **PATCH 版本**: 按需发布（bug 修复）
- **MINOR 版本**: 每 2-4 周发布一次
- **MAJOR 版本**: 每 6-12 个月发布一次

### 发布检查清单

#### PATCH 版本

- [ ] 所有测试通过
- [ ] 更新 CHANGELOG.md
- [ ] 更新版本号
- [ ] 创建 Git tag
- [ ] 发布到 npm

#### MINOR 版本

- [ ] 所有测试通过
- [ ] 更新 CHANGELOG.md
- [ ] 更新文档
- [ ] 更新版本号
- [ ] 创建 Git tag
- [ ] 发布到 npm
- [ ] 发布 GitHub Release

#### MAJOR 版本

- [ ] 所有测试通过
- [ ] 完成迁移指南
- [ ] 更新所有文档
- [ ] 提前 2 周发布 RC 版本
- [ ] 收集社区反馈
- [ ] 更新 CHANGELOG.md
- [ ] 更新版本号
- [ ] 创建 Git tag
- [ ] 发布到 npm
- [ ] 发布 GitHub Release
- [ ] 发布博客文章
- [ ] 通知社区

---

## 兼容性承诺

### 支持的版本

- **当前版本**: 完全支持，持续更新
- **前一个 MAJOR 版本**: 安全更新和关键 bug 修复（6 个月）
- **更早版本**: 不再支持

### 支持的平台

- **Node.js**: 当前 LTS 版本和前一个 LTS 版本
- **浏览器**: 最新的 2 个主要版本
  - Chrome/Edge
  - Firefox
  - Safari

### 依赖策略

- **主要依赖**: 保持在最新的稳定版本
- **安全更新**: 立即应用
- **破坏性更新**: 在下一个 MAJOR 版本中应用

---

## 弃用时间表

### 当前已弃用的 API

| API | 弃用版本 | 移除版本 | 替代方案 |
|-----|---------|---------|---------|
| `getUsers(from, limit)` | v40.2.0 | v41.0.0 | `getUsersPaginated(options)` |
| `getRooms(from, limit, searchTerm)` | v40.2.0 | v41.0.0 | `getRoomsPaginated(options)` |

### 计划弃用的 API

| API | 计划弃用版本 | 计划移除版本 | 原因 |
|-----|------------|------------|------|
| `initLegacyCrypto()` | v40.x | v42.0.0 | 使用 Rust crypto |

---

## 最佳实践

### 对于 SDK 用户

1. **及时更新**
   - 定期更新到最新的 MINOR 版本
   - 在 MAJOR 版本发布后 3 个月内完成迁移

2. **关注弃用警告**
   - 在开发环境中启用警告
   - 及时迁移到新 API

3. **锁定版本**
   - 在 package.json 中使用精确版本号
   - 使用 package-lock.json 或 pnpm-lock.yaml

4. **测试覆盖**
   - 保持良好的测试覆盖率
   - 在升级前运行完整测试

### 对于 SDK 维护者

1. **谨慎引入破坏性变更**
   - 评估影响范围
   - 提供充分的迁移时间

2. **完善文档**
   - 及时更新文档
   - 提供清晰的迁移指南

3. **社区沟通**
   - 提前通知重大变更
   - 收集社区反馈

4. **自动化工具**
   - 提供 codemod 工具
   - 提供类型检查工具

---

## 参考资料

- [语义化版本 2.0.0](https://semver.org/)
- [Node.js 发布计划](https://nodejs.org/en/about/releases/)
- [TypeScript 版本策略](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html)

---

## 变更历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-15 | 初始版本 |

---

**维护者**: SDK 开发团队  
**最后更新**: 2026-04-15
