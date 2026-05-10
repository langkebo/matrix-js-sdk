# SDK 错误处理与重试指南

本指南介绍了如何有效地利用 `matrix-js-sdk` 的错误处理机制和重试策略。

## SdkError 体系

SDK 所有的错误都继承自 `SdkError`。这个类及其子类不仅包含错误消息，还包含了丰富的元数据，用于排障和用户提示。

### 核心属性

| 属性          | 类型      | 说明                                           |
| :------------ | :-------- | :--------------------------------------------- |
| `message`     | `string`  | 开发者友好的错误描述                           |
| `errorCode`   | `string`  | Matrix 规范定义的错误码（如 `M_FORBIDDEN`）    |
| `statusCode`  | `number`  | HTTP 状态码（如 `403`）                        |
| `traceId`     | `string?` | 后端透传的请求追踪 ID，用于日志对齐            |
| `userTip`     | `string?` | 后端透传的用户友好提示语，可直接展示给终端用户 |
| `retryAfter`  | `number?` | 建议的重试延迟时间（毫秒）                     |
| `isRetryable` | `boolean` | 统一归一化后的重试建议，可直接驱动客户端策略   |

### 错误类型

- `ApiError`: 通用的 API 调用错误。
- `AuthError`: 身份验证失败或 Token 失效（401）。
- `NotFoundError`: 资源不存在（404）。
- `RetryableError`: 建议进行重试的暂时性错误（如 429 或 5xx）。
- `ValidationError`: 客户端参数校验错误。

### 统一归一化规则

当前 SDK 会在共享入口中对常见错误做一致归类：

- `401` 或 `M_UNKNOWN_TOKEN` -> `AuthError`
- `404` 或 `M_NOT_FOUND` -> `NotFoundError`
- `429`、`M_LIMIT_EXCEEDED`、限流响应 -> `RetryableError`
- `5xx` -> `RetryableError`
- 其他 `4xx` / 业务失败 -> `ApiError`
- 连接重置、超时、DNS 失败等网络异常 -> `RetryableError`

## 如何使用元数据

### 1. 自动追踪 (Trace ID)

当 API 报错时，`traceId` 是联系后端排障的关键。建议在日志系统中记录此字段。

```typescript
try {
    await client.getAdminManager().getUser("@alice:example.com");
} catch (error) {
    if (error instanceof SdkError) {
        console.error(`请求失败，追踪 ID: ${error.traceId}`);
        // 上报到监控系统
        Sentry.captureException(error, { extra: { traceId: error.traceId } });
    }
}
```

### 2. 用户友好提示 (User Tip)

后端可能会根据具体业务场景返回特定的提示语。

```typescript
try {
    await client.getAdminManager().deactivateUser(userId);
} catch (error) {
    if (error instanceof SdkError && error.userTip) {
        // 直接展示给用户，比通用的 "Internal Server Error" 更有意义
        showToast(error.userTip);
    } else {
        showToast("操作失败，请稍后重试");
    }
}
```

### 3. 基于重试元数据做统一策略

如果你的应用层需要自行决定是否继续重试，不要再单独判断 HTTP 状态码，直接读取 `SdkError` 上已经归一化过的元数据即可。

```typescript
try {
    await client.getCryptoKeysManager().uploadKeys({});
} catch (error) {
    if (error instanceof SdkError && error.isRetryable) {
        const delay = error.retryAfter ?? 1000;
        scheduleRetry(delay);
        return;
    }

    throw error;
}
```

## 重试机制

SDK 内部实现了基于**带 Jitter 的指数退避 (Exponential Backoff with Jitter)** 的重试策略。

### 默认行为

- **重试次数**: 默认 3 次。
- **重试间隔**: 1s -> 2s -> 4s (带 ±20% 抖动)。
- **幂等性检查**: 是否允许自动重试由 manager 的幂等配置决定；标记为非幂等的请求默认不重试，除非显式开启 `retryNonIdempotent`。
- **429 优先级**: 如果服务端返回 `retry_after_ms`，会优先采用服务端建议值，而不是本地计算的退避时间。

### 自定义重试配置

你可以通过公开的配置入口调整某个 manager 实例的重试行为：

```typescript
const roomKeysManager = client.getRoomKeysManager();

roomKeysManager.setRetryOptions({
    maxRetries: 5,
    retryDelay: 500,
    backoffMultiplier: 1.5,
    maxDelay: 10_000,
    jitterRatio: 0.1,
    idempotent: true,
    retryNonIdempotent: false,
});
```

### 频率限制 (429) 处理

如果服务器返回了 `retry_after_ms`，SDK 会自动识别并优先使用该延迟时间，而不是使用指数退避计算出的值。

### 迁移说明

如果你之前依赖局部 manager 私有错误转换逻辑，当前版本已经统一收口到共享归一化入口。应用层建议：

1. 优先捕获 `SdkError` 及其子类，而不是依赖具体 manager 的私有错误包装实现。
2. 使用 `errorCode`、`traceId`、`retryAfter`、`isRetryable` 读取错误上下文，而不是重复解析原始 HTTP 响应。
3. 对需要精细控制的场景，使用 manager 的公共重试配置接口，而不是修改私有字段。

## 最佳实践

1. **统一捕获 `SdkError`**: 尽量捕获基类 `SdkError` 以处理所有可能的 API 异常。
2. **区分 `AuthError`**: 在应用层拦截 `AuthError` 以触发重新登录流程。
3. **利用 `withRetry`**: 如果你在自定义 Manager 中需要发起多个 API 调用，建议使用 `BaseManager.withRetry` 来包裹整个逻辑。
