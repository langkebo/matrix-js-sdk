# 下一步行动计划

> 更新日期: 2026-04-27  
> Phase 1 状态: ✅ 已完成  
> 当前阶段: Phase 2 / Phase 3 并行推进

---

## 🎯 立即行动（本周）

### 1. 修正文档与实现脱节的高优先级模块

**当前已确认的偏差**:

- `typing.md` 仍写 33%，但 `MatrixClient` 已有 `sendTyping()`、`getRoomTyping()`、`getBatchTyping()`
- `relations.md` 已修正一处发送关系事件路径错误，但覆盖率描述仍需结合当前 SDK 能力继续复核
- `moderation.md` 仍写 25%，但 `MatrixClient` 已有 `scoreReport()`、`getScannerInfo()`、`reportRoom()`
- `external-service.md`、`burn-after-read.md`、`ai-connection.md` 仍写 0%，但仓库中已存在对应 Manager 与 HTTP 封装

**本周目标**:

- 逐个复核上述模块的 `SDK 对齐状态`
- 更新覆盖率、已知差异和示例路径
- 对已存在实现补充必要的测试说明，避免继续把“文档缺口”误判成“代码缺口”

### 2. 扩大契约自动校验覆盖范围

**当前已完成**:

- `pnpm quality:sdk-contracts` 已接入质量门禁
- 已支持 `SDK 对齐表 -> SDK 实际请求路径 -> synapse-rust 路由文件` 三方交叉校验
- 已覆盖 18 份带 `SDK 对齐状态` 且带 `> 后端代码:` 的契约文档

**下一步目标**:

- 让更多契约文档进入自动校验链，而不只依赖 `SDK 对齐状态` 表
- 继续增强对 `nest()` / 局部 router 复用模式的解析鲁棒性
- 把“文档端点存在但 SDK 未封装”与“文档写错但代码已存在”明确区分

### 3. 补强真实缺口对应的测试

**已确认的测试薄弱点**:

- `getRoomTyping()` / `getBatchTyping()` 暂未检索到直接单测
- `getAggregations()` 暂未检索到直接单测
- `scoreReport()` / `getScannerInfo()` 暂未检索到直接单测
- `KeyRotationManager` 仍建议补充真实后端集成验证，确认返回体字段与 synapse-rust 保持一致

**本周目标**:

- 为上述高频 HTTP 封装补充针对性的单测
- 优先选择能降低回归风险的用例，而不是重复实现细节的低价值测试

---

## 📅 两周计划

### Week 1: 文档纠偏优先

**Day 1-2**

- 复核 `typing.md`
- 复核 `relations.md`
- 复核 `moderation.md`

**Day 3-4**

- 复核 `external-service.md`
- 复核 `burn-after-read.md`
- 复核 `ai-connection.md`

**Day 5**

- 更新 `PROJECT_STATUS_FINAL.md` / `PROJECT_HANDOVER.md` / `PROGRESS_REPORT.md` 中的相关口径
- 运行 `pnpm quality:contracts`

### Week 2: 自动化与测试扩面

**Day 1-2**

- 扩大 `check-sdk-contract-alignment.mjs` 的文档纳入范围
- 评估是否增加“未带 SDK 对齐表的文档”校验入口

**Day 3-4**

- 为 `typing` / `relations` / `moderation` 新增直接单测
- 复核真实后端测试是否需要补 Key Rotation 响应体验证

**Day 5**

- 汇总剩余真实代码缺口
- 重新排序 Phase 2 实施优先级

---

## 🔄 当前真实优先级

### P0

- 修正契约文档中把“已实现能力”写成“未实现”的偏差
- 保持自动化校验持续可运行，避免后续再引入路径级错误
- 补齐高频客户端 HTTP 包装方法的直接测试

### P1

- 收敛 `Event Report`、`Telemetry`、`Module` 等仍需进一步核实的真实 SDK 缺口
- 把更多契约文档纳入自动化校验
- 统一各文档对“直接实现 / 间接实现 / 本地能力”的状态标注

### P2

- 继续推进契约版本管理与结构化变更追踪
- 评估从后端路由自动生成契约 inventory 的可行性

---

## 📊 现状快照

### 已完成

- 契约文档体系已建立
- `KeyRotationManager` 已实现并补充单测
- `quality:sdk-contracts` 已落地并接入总质量门禁
- `relations.md` 已依据自动校验结果修正一处端点路径错误

### 已确认仍需处理

- 多份契约文档覆盖率口径落后于当前仓库实现
- 部分新增客户端方法缺少直连单测
- 自动校验范围仍主要聚焦于带 `SDK 对齐状态` 的文档

### 暂不再作为最高优先级

- `Key Backup` 从零实现
- 自动化验证工具原型搭建

---

## 🚨 风险与依赖

### 主要风险

1. **文档口径继续滞后**
    - 风险: 团队依据错误覆盖率做排期，造成重复实现
    - 缓解: 先做高优先级文档纠偏，再推进新增封装

2. **测试表象通过但真实契约偏移**
    - 风险: SDK 方法存在，但路径或响应结构已偏离后端
    - 缓解: 持续依赖 `pnpm quality:contracts` 和真实后端集成测试

3. **计划文档与当前仓库状态脱节**
    - 风险: 后续交接继续沿用旧优先级
    - 缓解: 优先维护 `NEXT_STEPS.md`、`PROJECT_HANDOVER.md`、`PROJECT_STATUS_FINAL.md`

### 依赖项

- ✅ 契约文档目录已建立
- ✅ 自动化校验首版已可运行
- ✅ 后端路由文件可访问并可用于交叉验证
- ⏳ 需要继续补充真实后端集成验证覆盖

---

## ✅ 检查清单

### 每次修改契约文档后

- [ ] 重新运行 `pnpm quality:sdk-contracts`
- [ ] 必要时运行 `pnpm quality:contracts`
- [ ] 复核 `> 后端代码:` 是否仍指向正确 route 文件
- [ ] 复核 `SDK 对齐状态` 是否与源码和测试现状一致

### 每次新增 SDK HTTP 方法后

- [ ] 补充最小但有效的单测
- [ ] 更新对应契约文档
- [ ] 重新跑契约自动校验

---

## 📚 参考资料

### 相关文档

1. `docs/SDK_CONTRACT_OPTIMIZATION_PLAN_2026-04-27.md` - 原始优化方案
2. `docs/PROJECT_HANDOVER.md` - 当前交接状态
3. `docs/PROJECT_STATUS_FINAL.md` - 当前最终状态口径
4. `docs/api-contract/CONTRACT_INDEX.md` - 模块索引
5. `docs/api-contract/PROGRESS_REPORT.md` - 进度追踪

### 质量入口

- `pnpm quality:sdk-contracts`
- `pnpm quality:contracts`

---

**负责人**: SDK Core Team  
**更新频率**: 按阶段更新  
**下次审查**: 完成本轮文档纠偏后
