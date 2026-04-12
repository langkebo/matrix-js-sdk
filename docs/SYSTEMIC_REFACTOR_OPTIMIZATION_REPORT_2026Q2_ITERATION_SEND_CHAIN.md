# matrix-js-sdk 优化执行报告（2026Q2 / Send 链路增量）

## 1. 执行范围

- 对齐文档基线：
    - `SYSTEMIC_AUDIT_AND_REFACTOR_MASTER_PLAN_2026-04-09.md`
    - `SYSTEMIC_REFACTOR_TECHNICAL_BLUEPRINT_2026Q2.md`
    - `SYSTEMIC_REFACTOR_DELIVERABLES_2026Q2.md`
    - `SYSTEMIC_REFACTOR_EXECUTION_TASKBOARD_2026Q2.md`
- 本次聚焦任务：
    - `T-Q4`（`client.ts` 超大文件拆分）增量推进
    - `T-O1`（类型门禁阻塞清理）增量推进

## 2. 代码变更摘要（可验证）

- 新增模块：
    - `src/client-send-lifecycle.ts`：`sendCompleteEvent` 生命周期步骤抽离
    - `src/client-encrypt-send.ts`：`encryptAndSendEvent` 加密/调度/发送流程抽离
    - `src/client-send-args.ts`：`sendEvent/redactEvent/send*` 参数归一化集中处理
    - `src/client-send-http.ts`：发送请求的 txnId/路径/查询参数与 HTTP 调用收敛
    - `src/client-send-redaction.ts`：`redactEvent` 的关系型 redaction 内容组装与兼容校验下沉
    - `src/client-send-state.ts`：普通 state event 与 delayed state event 的路径/查询参数/请求下沉
    - `src/client-send-message.ts`：`sendMessage/sendText/sendNotice/sendEmote/sendHtml*/sendImage/sendSticker` 的 overload 与内容构造收敛
- 接线调整：
    - `src/client.ts`：发送链路改为委托上述 helper，保持外部 API 行为不变
- 测试补强：
    - `spec/unit/client-send-http.spec.ts`：覆盖常规发送与 delayed 发送请求组装
    - `spec/unit/client-send-redaction.spec.ts`：覆盖 unsupported/stable/unstable redaction 内容组装
    - `spec/unit/client-send-state.spec.ts`：覆盖普通 state event 与 delayed state event 的路径、查询参数与请求组装
    - `spec/unit/client-send-message.spec.ts`：覆盖消息发送 overload 与文本/HTML/媒体内容构造
    - `spec/unit/matrix-client.spec.ts`：补齐 `_unstable_sendStickyDelayedEvent` / `_unstable_sendStickyEvent` 的线程关系补齐回归，覆盖“缺失 thread relation”与“已存在 reply”两类关键分支
- 阻塞修复：
    - `src/matrix.ts`：修正 `LoggerManager / SecretStorageManager / SyncAccumulatorManager` 导出路径
    - `src/push/index.ts`：移除与 `BaseManager` 冲突的 `private sleep`（复用基类 `protected sleep`）

## 3. 指标对比（本批可观测）

| 指标                     |              变更前 | 变更后 | 变化 | 说明                                                          |
| ------------------------ | ------------------: | -----: | ---: | ------------------------------------------------------------- |
| `src/client.ts` 行数     | 约 9044（审计基线） |   8802 | -242 | 拆分持续进行中，尚未达到 `-25%` 目标                          |
| 新增发送链路 helper 行数 |                   0 |    701 | +701 | 职责继续下沉到 request/redaction/state/message-format 子域    |
| send 相关单测文件        |                   2 |      7 |   +5 | 增量补齐生命周期、HTTP、redaction、state、message-format 回归 |
| send 相关单测用例        |                   6 |     21 |  +15 | 覆盖新增 helper 关键分支                                      |

> 注：关键路径性能 `>=20%` 改善目标需在 `spec/perf` 基线与对照数据齐备后评估，本批未宣称达成。

## 4. 验证证据

- `pnpm lint:types`：通过
- `pnpm vitest run spec/unit/client-send-*.spec.ts`：4 文件、14 用例通过
- `pnpm vitest run spec/unit/client-send-http.spec.ts spec/unit/client-send-request.spec.ts spec/unit/client-send-paths.spec.ts spec/unit/client-send-lifecycle.spec.ts`：4 文件、10 用例通过
- `pnpm vitest run spec/unit/client-send-redaction.spec.ts spec/unit/client-send-state.spec.ts spec/unit/client-send-http.spec.ts spec/unit/client-send-request.spec.ts spec/unit/client-send-paths.spec.ts spec/unit/client-send-lifecycle.spec.ts`：6 文件、16 用例通过
- `pnpm vitest run spec/unit/client-send-message.spec.ts spec/unit/client-send-redaction.spec.ts spec/unit/client-send-state.spec.ts spec/unit/client-send-http.spec.ts spec/unit/client-send-request.spec.ts spec/unit/client-send-paths.spec.ts spec/unit/client-send-lifecycle.spec.ts`：7 文件、23 用例通过
- `pnpm vitest run spec/unit/matrix-client.spec.ts -t "with_rel_types|can send a delayed state event|overload without threadId works|does not get wrongly encrypted"`：受影响主链路定向回归通过
- `pnpm vitest run spec/unit/matrix-client.spec.ts -t "_unstable_sendSticky"`：4 条 sticky 线程补齐回归通过
- `pnpm vitest run spec/unit/matrix-client.spec.ts -t "should add thread relation if threadId is passed and the relation is missing"`：send/delayed/sticky 共 8 条线程补齐主路径回归通过

## 5. 风险与阻塞清单

- R1（P0）：`client.ts` 体量仍远超目标，拆分深度不足
    - 根因：历史兼容重载与发送链路耦合点多
    - 方案：下一批按功能域继续下沉（`send-state/send-redaction/send-message-format`）
- R2（P1）：性能指标尚未形成“重构前/后”可对比结论
    - 根因：当前性能门禁主要是守护，不是成体系基线看板
    - 方案：补 `spec/perf` 基线采样脚本，固化报告模板并入 CI artifacts
- R3（P1）：deprecated API 与迁移映射未系统化完成
    - 根因：当前优先处理架构拆分与门禁可用性
    - 方案：下一批集中补 `@deprecated` 与 `docs/MIGRATION_GUIDE.md` 旧新映射
- R4（P1）：send 子域仍以定向回归为主，尚未形成完整性能对照
    - 根因：本批重点在行为收敛与线程补齐一致性，不涉及基准基线重采样
    - 方案：在 `spec/perf` 增补 send/sticky 路径基线采集，纳入 `T-P2` 报表

## 6. 回滚策略

- 策略：
    - 所有发送路径仍保留在 `MatrixClient` 公开方法层，helper 仅做内部委托
    - 可通过单次提交回滚 helper 接线恢复为原内联逻辑
- 最小回滚单元：
    - `src/client.ts` 接线改动
    - 新增 `src/client-send-lifecycle.ts`、`src/client-encrypt-send.ts`、`src/client-send-args.ts`
    - 新增 `src/client-send-http.ts`、`src/client-send-redaction.ts`、`src/client-send-state.ts`、`src/client-send-message.ts`

## 7. 下一迭代建议（按优先级）

1. `T-Q4`：继续拆 `client.ts` 的 state/send/redact 子域，目标再降 `>750` 行。
2. `T-U2`：已完成错误语义文档与迁移映射，后续保持新增接口同步更新错误码章节。
3. `T-P2`：已进入执行收口阶段，下一步将 P95/初始化/内存三类结果统一进入 PR 结论与阻断阈值。
4. `T-Q1`：对 `push/dm/room-summary/space` 做错误分类一致性回归测试。
