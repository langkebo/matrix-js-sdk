# 日志脱敏规范

> 建立日期: 2026-04-11
> 最后更新: 2026-04-11

## 1. 目标

确保日志输出不泄露敏感信息，包括但不限于：

- 访问令牌 (access_token)
- 密码 (password)
- 密钥 (secret, key)
- 授权信息 (authorization, bearer)
- 个人身份信息 (PII)

## 2. 敏感数据类型

| 类型     | 关键词                     | 处理方式                            |
| -------- | -------------------------- | ----------------------------------- |
| 访问令牌 | token, access_token, authz | 禁止记录，或脱敏为 `***REDACTED***` |
| 密码     | password, passwd, pwd      | 禁止记录                            |
| 密钥     | secret, key, private       | 禁止记录值，可记录标识符            |
| 授权头   | authorization, bearer      | 禁止记录                            |
| 会话ID   | session_id, sessionid      | 可记录，但需评估风险                |
| 用户ID   | user_id, userid            | 可记录（非敏感场景）                |

## 3. 日志规范

### 3.1 禁止事项

```typescript
// ❌ 禁止：直接记录敏感值
logger.debug(`Token: ${accessToken}`);
logger.info("Password: " + password);
logger.warn(`Authorization: Bearer ${token}`);

// ❌ 禁止：使用字符串拼接记录敏感数据
logger.debug("Secret value: " + secretValue);
```

### 3.2 推荐做法

```typescript
// ✅ 推荐：记录标识符而非值
logger.debug(`Received secret ${secretName}`); // 只记录名称
logger.info(`User ${userId} logged in`); // 用户ID非敏感

// ✅ 推荐：脱敏处理
logger.debug(`Token: ${token.substring(0, 8)}***`);
logger.info(`Key: ${keyId} (length: ${key.length})`);

// ✅ 推荐：使用结构化日志
logger.debug("Secret received", { name: secretName, length: value.length });
```

### 3.3 白名单机制

对于已评估为安全的日志行，使用 `@log-allow` 注释：

```typescript
// @log-allow: 只记录密钥标识符，不记录值
logger.warn("unknown algorithm for secret storage key " + keyId);
```

## 4. 扫描规则

### 4.1 扫描工具

位置: `scripts/quality/check-log-sensitive.mjs`

运行命令: `pnpm quality:log-sensitive`

### 4.2 检测规则

扫描工具检测以下模式：

1. **敏感关键词**: token, access_token, authorization, authz, password, secret, bearer
2. **日志调用**: `logger.debug/info/warn/error/log`
3. **潜在泄露**: 模板字符串插值或字符串拼接

### 4.3 白名单

在日志行添加 `// @log-allow` 注释可跳过检测：

```typescript
// @log-allow
logger.debug(`Received secret ${name}`); // 只记录名称，安全
```

## 5. CI 集成

### 5.1 警告模式（默认）

扫描发现问题会输出警告，但不会阻断构建：

```bash
pnpm quality:log-sensitive
```

### 5.2 阻断模式

设置环境变量 `LOG_SENSITIVE_BLOCK=true` 可启用阻断模式：

```bash
LOG_SENSITIVE_BLOCK=true pnpm quality:log-sensitive
```

### 5.3 GitHub Actions

在 `systemic_refactor_quality_gate.yml` 中已集成敏感日志扫描：

```yaml
- name: Sensitive log scan
  run: pnpm quality:log-sensitive
```

## 6. 当前白名单项

| 文件                           | 行号 | 原因                                  |
| ------------------------------ | ---- | ------------------------------------- |
| src/rust-crypto/rust-crypto.ts | 2054 | 只记录 secret 名称，不记录值          |
| src/secret-storage.ts          | 547  | 只记录 keyId 和 algorithm，不记录密钥 |

## 7. 处理流程

```
发现潜在敏感日志
    ↓
评估是否泄露敏感值
    ↓
┌─────────────┬─────────────┐
│ 是          │ 否          │
↓             ↓
修复代码      添加 @log-allow
移除敏感数据   注释说明原因
    ↓             ↓
重新扫描      提交代码
```

## 8. 相关文档

- [执行台账](../SYSTEMIC_REFACTOR_EXECUTION_TASKBOARD_2026Q2.md)
- [风险台账](./RISK_REGISTER.md)
- [CI 工作流](../../.github/workflows/systemic_refactor_quality_gate.yml)
