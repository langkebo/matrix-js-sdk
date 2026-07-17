# MatrixClient 模块化拆分与 API 契约审计报告 (2026-04-10)

## 1. API 契约审计结果

通过对 `docs/api-contract` 目录下核心契约（Auth, Room, DM, Admin, Exports）的审查，得出以下结论：

### 1.1 实现完整性

- **认证 (Auth)**: `AuthManager` 已封装大部分端点，但 `MatrixClient` 仍保留了部分 3PID 验证和 Token 请求逻辑。
- **房间 (Room)**: 核心 Room 操作在 `MatrixClient` 中极其臃肿，虽然有 `client-request-delegates` 等辅助文件，但 `MatrixClient` 依然是这些 API 的唯一导出点。
- **直聊 (DM)**: `DirectMessageManager` 封装质量较好，契约对应关系明确。
- **管理 (Admin)**: `AdminManager` 已建立，但与 `MatrixClient` 现有的 `isSynapseAdministrator` 等方法存在职责重叠。

### 1.2 封装质量评估

- **优点**: 采用了 Manager 扩展模式（Manager Extensions），为解耦提供了基础设施。
- **不足**: 核心类 `MatrixClient` 依然扮演“上帝对象”角色，导致公开 API 表面积过大，内部耦合严重。

---

## 2. MatrixClient 冗余与耦合清单

### 2.1 冗余清单 (Redundancy Inventory)

| 类别                  | 描述                                                                               | 影响                                   |
| :-------------------- | :--------------------------------------------------------------------------------- | :------------------------------------- |
| **功能重叠**          | `MatrixClient` 与各个 `Manager` 之间存在相同功能的重复实现或重复导出。             | 调用方困惑，维护成本加倍。             |
| **过度重载**          | `sendEvent`, `sendMessage` 等方法存在大量重载和可选参数。                          | 逻辑复杂，难以进行静态分析和单元测试。 |
| **死代码/不稳定 API** | 大量以 `_unstable_` 开头的方法长期存在，部分可能已过时。                           | 增加包体积，污染代码库。               |
| **手动代理**          | `MatrixClient` 中有大量方法只是简单调用了 `client-request-delegates.ts` 中的函数。 | 增加了不必要的代码层级和类体积。       |

### 2.2 影响评估 (Impact Assessment)

- **可维护性**: 7400+ 行的 `client.ts` 使得任何修改都面临极高的回归风险。
- **测试性**: `MatrixClient` 的依赖过多，Mock 极其困难，导致单元测试往往变成集成测试。
- **性能**: 无论使用何种功能，都必须加载完整的 `MatrixClient` 逻辑，不利于 Tree Shaking。

---

## 3. 模块化拆分方案设计

### 3.1 核心理念：从“上帝对象”转向“聚合器”

将 `MatrixClient` 重构为一个轻量级的协调器，将具体业务逻辑下沉到独立的 Sub-Managers 中。

### 3.2 拆分边界定义

我们将 `MatrixClient` 的功能划分为以下独立模块：

1.  **AccountDataManager**: 处理 `account_data`、用户属性、隐藏用户等。
2.  **RoomManager (Core)**: 维护房间状态、加入/离开、权限等级、标签。
3.  **EventManager**: 负责所有类型的事件发送、重发、取消、红利。
4.  **TimelineManager**: 处理滚动分页、时间线窗口、上下文请求。
5.  **VoipManager**: 整合 WebRTC 通话逻辑。
6.  **SecurityManager**: 处理 Crypto 初始化、备份管理、安全存储。
7.  **DiscoveryManager**: 处理服务器版本、能力探测、Well-known。

### 3.3 依赖重构策略

- **组合优于继承**: `MatrixClient` 内部持有这些 Manager 的实例。
- **事件驱动**: 模块间通过 `ReEmitter` 或内部事件总线通信，减少直接硬编码依赖。
- **接口抽象**: 为每个 Manager 定义清晰的 Interface，便于单元测试 Mock。

---

## 4. 实施计划与质量保障

### 4.1 阶段性任务

- **阶段 1 (准备期)**: 完善各子模块 Interface 定义，建立单元测试基准。
- **阶段 2 (迁移期)**: 按优先级（Room -> Event -> Account -> Others）逐步将逻辑从 `client.ts` 物理迁移至新文件。
- **阶段 3 (兼容期)**: 在 `MatrixClient` 中保留旧 API 接口，通过代理方式调用新模块，并标记 `@deprecated`。
- **阶段 4 (清理期)**: 移除过期 API，优化 Tree Shaking。

### 4.2 质量保障机制

- **双重校验**: 每次拆分后，必须通过现有的 Unit Tests 和 Real-Backend Integration Tests。
- **覆盖率监控**: 确保拆分后的新模块测试覆盖率不低于 80%。
- **架构守门**: 在 CI 中引入 `size-limit` 和 `dependency-cruiser`，防止新的循环依赖产生。

---

## 5. 后续动作建议

1. 立即启动 `RoomManager` 的独立化，这是收益最高（减少代码量最多）的任务。
2. 废弃 `client-request-delegates.ts` 这种中间层，直接将逻辑内聚在对应的 Manager 中。
