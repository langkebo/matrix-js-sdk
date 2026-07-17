# D.2 Manager 架构审查报告

**审查时间**: 2026-07-17
**审查范围**: `src/client-infra/manager-registry.ts` 中全部 122 个 ManagerName
**审查方法**: 三级判定（frontend 引用 / SDK 内部引用 / 测试覆盖）
**审查结论**: ✅ 0 僵尸 manager；38 个 manager 缺测试覆盖（移交阶段 E 处理）

---

## 1. 审查方法

### 三级判定标准

| 级别 | 检查内容       | 命令                                                                                      |
| ---- | -------------- | ----------------------------------------------------------------------------------------- |
| 一级 | 前端 hula 引用 | `grep -rqF "\"$m\"" hula/src/ --include="*.ts" --include="*.vue"`                         |
| 二级 | SDK 内部引用   | `grep -rlF "\"$m\"" matrix-js-sdk/src/ --include="*.ts"`（排除 manager-registry.ts 自身） |
| 三级 | 测试覆盖       | `grep -rqF "$m" matrix-js-sdk/spec/ --include="*.ts"`                                     |

### 分类规则

| 类别             | 判定                                           | 处理建议                  |
| ---------------- | ---------------------------------------------- | ------------------------- |
| `active`         | frontend=yes OR sdk_internal=yes，且有测试     | ✅ 保留                   |
| `active_no_test` | frontend=yes OR sdk_internal=yes，但无测试     | ⚠️ 移交阶段 E 补测试      |
| `test_only`      | 无生产引用，但有测试                           | 🔍 评估是否为公共 API     |
| `zombie`         | 无 frontend 引用、无 sdk_internal 引用、无测试 | ❌ 标记 deprecated 或删除 |

## 2. 总体结果

| 类别             | 数量    | 占比  |
| ---------------- | ------- | ----- |
| `active`         | 84      | 68.9% |
| `active_no_test` | 38      | 31.1% |
| `test_only`      | 0       | 0%    |
| `zombie`         | 0       | 0%    |
| **合计**         | **122** | 100%  |

**关键结论**：

- ✅ **0 僵尸 manager** — 所有 122 个 manager 均有活跃引用，无过度开发
- ✅ **0 仅测试 manager** — 无纯测试遗留
- ⚠️ **38 个活跃 manager 缺测试** — 31.1% 的 manager 无单元测试覆盖，移交阶段 E 处理

## 3. 38 个缺测试 manager 详情

> 这些 manager 在 SDK 内部或前端被使用，但 `spec/` 目录中无对应测试。

### 3.1 前端使用但缺测试（1 个，高优先级）

| Manager             | Frontend | SDK Internal | 建议优先级                 |
| ------------------- | -------- | ------------ | -------------------------- |
| `pushNotifications` | ✅       | ✅           | P0（前端依赖，必须补测试） |

### 3.2 仅 SDK 内部使用且缺测试（37 个）

#### Crypto 相关（6 个）

| Manager            | 功能域   |
| ------------------ | -------- |
| `cryptoBackup`     | 密钥备份 |
| `cryptoEncryption` | 加密     |
| `cryptoKeys`       | 密钥管理 |
| `secureBackup`     | 安全备份 |
| `keyForwarding`    | 密钥转发 |
| `keyVerification`  | 密钥验证 |

#### Room 相关（8 个）

| Manager               | 功能域       |
| --------------------- | ------------ |
| `roomAccountData`     | 房间账户数据 |
| `roomCreation`        | 房间创建     |
| `roomJoining`         | 房间加入     |
| `roomKeySharing`      | 房间密钥共享 |
| `roomSettings`        | 房间设置     |
| `roomStateManagement` | 房间状态管理 |
| `roomUpgrades`        | 房间升级     |
| `stateSend`           | 状态发送     |

#### Sync/Event 相关（5 个）

| Manager           | 功能域     |
| ----------------- | ---------- |
| `syncAccumulator` | 同步累积器 |
| `syncManagement`  | 同步管理   |
| `eventProcessing` | 事件处理   |
| `eventStatus`     | 事件状态   |
| `scheduledEvents` | 定时事件   |

#### Auth/Identity 相关（5 个）

| Manager            | 功能域     |
| ------------------ | ---------- |
| `authGlobalLogout` | 全局登出   |
| `saml-auth`        | SAML 认证  |
| `tokenManagement`  | Token 管理 |
| `userDirectory`    | 用户目录   |
| `userReport`       | 用户举报   |

#### Other（13 个）

| Manager            | 功能域       |
| ------------------ | ------------ |
| `backgroundUpdate` | 后台更新     |
| `eventReport`      | 事件举报     |
| `inviteBlocklist`  | 邀请黑名单   |
| `mediaQuota`       | 媒体配额     |
| `pinnedMessages`   | 置顶消息     |
| `qrLogin`          | 二维码登录   |
| `readReceipts`     | 已读回执     |
| `serverTime`       | 服务器时间   |
| `tagsManagement`   | 标签管理     |
| `userPresence`     | 用户在线状态 |
| `voipCalls`        | VoIP 通话    |
| `workerAdmin`      | Worker 管理  |
| `workerBody`       | Worker 主体  |

## 4. 与原方案预期的差异

原方案（三项目协同优化方案.md §D.2）预期 122 个 manager 中可能存在僵尸，需二级判定避免误删。

**实际结果**：0 僵尸。原因分析：

1. SDK 已经过 2026-04 系列优化（SDK*OPTIMIZATION*\* 系列 12 份报告记录），僵尸 manager 已被清理
2. 当前 122 个 manager 全部为活跃状态，证明前序优化有效

## 5. 移交阶段 E 的事项

阶段 E（测试套件审查）需优先处理 38 个缺测试 manager：

1. **P0**：`pushNotifications`（前端依赖，必须补测试）
2. **P1**：6 个 crypto 相关 manager（安全敏感）
3. **P2**：8 个 room 相关 manager（核心功能）
4. **P3**：5 个 sync/event 相关 manager（同步核心）
5. **P4**：剩余 18 个 manager

## 6. 成功标准 D 验证

| 标准                          | 状态 | 说明                                                    |
| ----------------------------- | ---- | ------------------------------------------------------- |
| docs/ 下优化总结文件 ≤ 3 份   | ✅   | D.1 已完成，根级仅 1 份 SDK_OPTIMIZATION_FINAL_COMPLETE |
| `pnpm lint:knip` 零未使用导出 | ⏳   | D.3 待执行                                              |
| 僵尸 manager 已标记并归档     | ✅   | 0 僵尸，无需归档                                        |
| `pnpm lint` 零警告            | ⏳   | D.3 待执行                                              |

## 7. 附录

### 完整审查数据

完整 TSV 数据保存在 `/tmp/sdk-d2-manager-audit.tsv`，字段：

- `manager`: manager 名
- `frontend`: 前端引用 (yes/no)
- `sdk_internal`: SDK 内部引用 (yes/no)
- `has_test`: 测试覆盖 (yes/no)
- `category`: 分类 (active/active_no_test/test_only/zombie)

### 审查脚本

`/tmp/sdk-d2-manager-audit.sh` — 可重复执行的审查脚本，未来添加新 manager 后可重新运行以检测僵尸。
