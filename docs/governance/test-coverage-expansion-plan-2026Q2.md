# 测试用例扩展计划 2026Q2

> 生成日期: 2026-04-11
> 目标覆盖率: Lines 75%, Functions 75%, Branches 65%, Statements 75%
> 当前阈值: Lines 70%, Functions 70%, Branches 60%, Statements 70%

## 一、测试现状分析

### 1.1 测试框架配置

- **测试框架**: Vitest
- **覆盖率工具**: v8
- **测试环境**: Node.js
- **测试目录**:
    - `spec/unit/` - 单元测试
    - `spec/integ/` - 集成测试
    - `spec/perf/` - 性能测试

### 1.2 当前覆盖率阈值

| 指标       | 当前阈值 | 目标阈值 | 提升 |
| ---------- | -------- | -------- | ---- |
| Lines      | 70%      | 75%      | +5%  |
| Functions  | 70%      | 75%      | +5%  |
| Branches   | 60%      | 65%      | +5%  |
| Statements | 70%      | 75%      | +5%  |

### 1.3 测试缺口分析

#### P0 级 - 核心功能模块（缺少测试）

| 模块                  | 源文件数 | 测试文件数 | 缺口 | 影响 |
| --------------------- | -------- | ---------- | ---- | ---- |
| client-\*.ts 拆分模块 | 25+      | 8          | 高   | 核心 |
| store/                | 8        | 3          | 中   | 高   |
| http/                 | 1        | 0          | 高   | 核心 |
| sync-accumulator/     | 1        | 1          | 低   | 中   |

#### P1 级 - 重要功能模块（测试不足）

| 模块         | 源文件数 | 测试文件数 | 缺口 | 影响 |
| ------------ | -------- | ---------- | ---- | ---- |
| matrixrtc/   | 15       | 10         | 中   | 高   |
| rust-crypto/ | 15       | 11         | 中   | 高   |
| webrtc/      | 20       | 12         | 中   | 中   |
| models/      | 25       | 7          | 高   | 高   |

#### P2 级 - 辅助功能模块（部分缺失）

| 模块        | 源文件数 | 测试文件数 | 缺口 | 影响 |
| ----------- | -------- | ---------- | ---- | ---- |
| rendezvous/ | 12       | 3          | 中   | 中   |
| oidc/       | 8        | 5          | 低   | 中   |
| crypto-api/ | 8        | 1          | 高   | 中   |

## 二、测试用例扩展策略

### 2.1 单元测试扩展

#### 2.1.1 边界值分析

每个函数应测试以下边界情况：

- 空输入 (null, undefined, empty string, empty array)
- 最小值/最大值边界
- 类型边界 (数字溢出、字符串长度限制)
- 并发边界 (竞态条件、死锁)

#### 2.1.2 异常路径测试

- 网络错误处理
- 数据格式错误
- 权限错误
- 超时处理
- 资源不可用

#### 2.1.3 状态转换测试

- 初始化状态
- 正常运行状态
- 错误恢复状态
- 清理/销毁状态

### 2.2 集成测试扩展

#### 2.2.1 模块间交互

- Client ↔ Store 交互
- Crypto ↔ Network 交互
- Sync ↔ Event Processing 交互
- WebRTC ↔ Media 交互

#### 2.2.2 端到端场景

- 完整登录流程
- 消息发送/接收流程
- 加密消息处理流程
- 群组通话流程

### 2.3 性能测试扩展

- 大量消息处理
- 大型房间同步
- 内存使用监控
- 启动时间测试

## 三、分阶段实施计划

### 3.1 第一阶段: P0 核心模块测试 (2026-04-11 ~ 2026-04-25)

**目标**: 覆盖核心 API 模块

#### 任务清单

| ID      | 任务                           | 优先级 | 预计测试数 |
| ------- | ------------------------------ | ------ | ---------- |
| T-P0-01 | client-send-\*.ts 系列模块测试 | P0     | 50+        |
| T-P0-02 | client-timeline-\*.ts 模块测试 | P0     | 30+        |
| T-P0-03 | client-receipt-\*.ts 模块测试  | P0     | 20+        |
| T-P0-04 | http/ 模块测试                 | P0     | 25+        |
| T-P0-05 | store/indexeddb-\*.ts 模块测试 | P0     | 30+        |

#### 测试用例模板

```typescript
describe("ModuleName", () => {
    describe("functionName", () => {
        describe("positive scenarios", () => {
            it("should handle normal input correctly", () => {});
            it("should handle edge case: empty input", () => {});
            it("should handle edge case: maximum input", () => {});
        });

        describe("negative scenarios", () => {
            it("should throw on invalid input", () => {});
            it("should handle network errors gracefully", () => {});
            it("should handle timeout correctly", () => {});
        });

        describe("state transitions", () => {
            it("should initialize correctly", () => {});
            it("should clean up resources on destroy", () => {});
        });
    });
});
```

### 3.2 第二阶段: P1 重要模块测试 (2026-04-26 ~ 2026-05-15)

**目标**: 覆盖加密和实时通信模块

#### 任务清单

| ID      | 任务                             | 优先级 | 预计测试数 |
| ------- | -------------------------------- | ------ | ---------- |
| T-P1-01 | matrixrtc/EncryptionManager 测试 | P1     | 20+        |
| T-P1-02 | matrixrtc/MembershipManager 测试 | P1     | 25+        |
| T-P1-03 | rust-crypto/backup.ts 测试       | P1     | 20+        |
| T-P1-04 | rust-crypto/verification.ts 测试 | P1     | 25+        |
| T-P1-05 | models/room.ts 边界测试          | P1     | 30+        |
| T-P1-06 | models/event.ts 边界测试         | P1     | 25+        |

### 3.3 第三阶段: P2 辅助模块测试 (2026-05-16 ~ 2026-05-31)

**目标**: 覆盖辅助功能模块

#### 任务清单

| ID      | 任务                            | 优先级 | 预计测试数 |
| ------- | ------------------------------- | ------ | ---------- |
| T-P2-01 | rendezvous/MSC4108SignInWithQR  | P2     | 15+        |
| T-P2-02 | rendezvous/channels/\* 测试     | P2     | 20+        |
| T-P2-03 | crypto-api/recovery-key.ts 测试 | P2     | 15+        |
| T-P2-04 | oidc/manager.ts 测试            | P2     | 20+        |

## 四、测试用例规范

### 4.1 命名规范

```
测试文件: <module-name>.spec.ts
测试套件: describe('<ModuleName>', () => {})
测试用例: it('should <expected behavior> when <condition>', () => {})
```

### 4.2 测试隔离原则

1. **独立性**: 每个测试用例独立运行，不依赖其他测试
2. **可重复性**: 相同输入产生相同结果
3. **自包含**: 测试内部创建所需的所有数据
4. **清理**: 测试后清理所有副作用

### 4.3 Mock 使用规范

```typescript
// 使用 vi.fn() 创建 mock 函数
const mockCallback = vi.fn();

// 使用 vi.mock() mock 模块
vi.mock("../module", () => ({
    function: vi.fn(),
}));

// 使用 vi.spyOn() 监视方法
const spy = vi.spyOn(object, "method");
```

### 4.4 异步测试规范

```typescript
// 使用 async/await
it("should handle async operation", async () => {
    const result = await asyncFunction();
    expect(result).toBeDefined();
});

// 使用 vi.useFakeTimers 处理定时器
beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});
```

## 五、测试覆盖率监控

### 5.1 CI 集成

```yaml
# .github/workflows/test.yml
- name: Run tests with coverage
  run: npm run coverage

- name: Check coverage thresholds
  run: npm run quality:coverage:critical
```

### 5.2 覆盖率报告

```bash
# 生成覆盖率报告
npm run coverage

# 检查关键模块覆盖率
npm run quality:coverage:critical

# 查看详细报告
open coverage/lcov-report/index.html
```

### 5.3 覆盖率趋势追踪

| 日期       | Lines | Functions | Branches | Statements |
| ---------- | ----- | --------- | -------- | ---------- |
| 2026-04-11 | TBD   | TBD       | TBD      | TBD        |
| 2026-04-25 | 72%   | 72%       | 62%      | 72%        |
| 2026-05-15 | 74%   | 74%       | 64%      | 74%        |
| 2026-05-31 | 75%   | 75%       | 65%      | 75%        |

## 六、回归测试验证

### 6.1 故意引入 Bug 验证

在完成测试用例后，通过以下方式验证测试有效性：

1. **修改返回值**: 预期测试失败
2. **跳过关键步骤**: 预期测试失败
3. **引入边界错误**: 预期测试失败
4. **模拟网络错误**: 预期测试失败

### 6.2 回归测试清单

| 场景            | 验证方法      | 预期结果 |
| --------------- | ------------- | -------- |
| 消息发送失败    | mock 网络错误 | 测试失败 |
| 加密密钥无效    | 提供无效密钥  | 测试失败 |
| 房间状态不一致  | 跳过状态更新  | 测试失败 |
| WebRTC 连接失败 | mock 连接错误 | 测试失败 |

## 七、文档与维护

### 7.1 测试文档

每个测试文件应包含：

- 模块描述
- 测试范围说明
- 特殊测试场景说明
- Mock 策略说明

### 7.2 测试维护

1. **定期审查**: 每月审查测试用例有效性
2. **更新策略**: 新功能必须包含测试
3. **重构支持**: 代码重构时更新测试
4. **性能监控**: 监控测试执行时间

---

_本文档由自动化工具生成，每周一自动更新_
