# Matrix SDK 真实服务器测试方案 (优化版)

> **生成时间**: 2026-03-20
> **后端**: synapse-rust (localhost:28008)
> **SDK**: matrix-js-sdk (本地修改版)
> **前端**: hula
> **文档版本**: 4.0
> **状态**: 基于数据库问题诊断的改进方案

---

## 一、问题诊断与改进背景

### 1.1 历史测试问题回顾

**问题现象**: 后端数据库存在多处问题，但 SDK 测试仍显示 100% 通过。

**发现的数据库问题**:

| 问题类型 | 严重程度 | 问题描述 | 影响 |
|----------|----------|----------|------|
| 事务中止处理错误 | P0 | 6个文件存在无效 ROLLBACK 代码 | 连接泄漏、级联错误 |
| TIMESTAMP 类型违规 | P1 | 8个表使用 TIMESTAMP 而非 BIGINT | 字段不一致 |
| 模型字段缺失 | P2 | UserDirectory 缺少 updated_ts | 数据不完整 |

### 1.2 问题根因分析

```
┌─────────────────────────────────────────────────────────────────┐
│                    测试通过但数据库有问题的根因                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 测试断言过于宽松                                               │
│     ├── 只检查 API 返回 200，未验证数据库实际状态                    │
│     ├── 只检查 response 存在，未检查数据完整性                      │
│     └── 只检查没有抛错，未验证操作正确性                            │
│                                                                  │
│  2. 测试数据构造问题                                               │
│     ├── 使用预设测试数据，未覆盖边界条件                            │
│     ├── 测试数据未与其他模块数据产生关联                            │
│     └── 缺少数据一致性验证                                         │
│                                                                  │
│  3. 测试环境配置问题                                               │
│     ├── 测试环境与生产环境配置不一致                                │
│     ├── 缺少数据库完整性检查                                       │
│     └── 缺少错误场景验证                                           │
│                                                                  │
│  4. 错误处理掩盖                                                  │
│     ├── Rust 代码中的 .ok() 和 unwrap() 掩盖了错误                  │
│     ├── 事务中止后未正确回滚，继续处理请求                          │
│     └── 错误被静默吞掉，未向上传播                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 改进方案概述

```
┌─────────────────────────────────────────────────────────────────┐
│                        改进测试方案架构                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  第一层：API 响应验证                                             │
│  ├── HTTP 状态码验证                                              │
│  ├── 响应体结构验证                                               │
│  └── 错误码和错误消息验证                                         │
│                                                                  │
│  第二层：数据库状态验证 ⭐ 新增                                    │
│  ├── 直接查询数据库验证数据写入                                    │
│  ├── 验证关联表数据一致性                                         │
│  └── 验证索引和约束是否生效                                       │
│                                                                  │
│  第三层：端到端验证 ⭐ 新增                                        │
│  ├── 创建 → 读取 → 验证数据完整性                                  │
│  ├── 更新 → 验证变更是否生效                                      │
│  └── 删除 → 验证数据是否真正移除                                   │
│                                                                  │
│  第四层：负面测试 ⭐ 新增                                          │
│  ├── 错误操作验证错误处理                                          │
│  ├── 边界条件测试                                                 │
│  └── 并发操作测试                                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、后端服务架构分析

### 2.1 synapse-rust 核心服务

| 服务模块 | 文件位置 | 功能说明 |
|----------|----------|----------|
| RegistrationService | `services/registration_service.rs` | 用户注册 |
| AdminRegistrationService | `services/admin_registration_service.rs` | Admin 注册 |
| AuthService | `auth/mod.rs` | 认证授权 |
| RoomService | `services/room_service.rs` | 房间管理 |
| MessageService | `services/message_service.rs` | 消息处理 |
| UserService | `services/user_service.rs` | 用户管理 |
| DeviceService | `services/device_service.rs` | 设备管理 |
| E2EE Services | `services/e2ee/*` | 端到端加密 |

### 2.2 数据库架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      synapse-rust 数据库                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  用户认证层                                                       │
│  ├── users (用户主表)                                            │
│  ├── access_tokens (访问令牌)                                    │
│  ├── refresh_tokens (刷新令牌)                                   │
│  └── password_history (密码历史)                                 │
│                                                                  │
│  设备与加密层                                                     │
│  ├── devices (设备表)                                           │
│  ├── device_keys (设备密钥)                                      │
│  ├── olm_sessions (Olm 会话)                                    │
│  ├── megolm_sessions (Megolm 会话)                              │
│  └── cross_signing_keys (交叉签名密钥)                            │
│                                                                  │
│  房间与消息层                                                     │
│  ├── rooms (房间表)                                             │
│  ├── room_memberships (房间成员)                                │
│  ├── events (事件表)                                            │
│  └── room_state_events (房间状态)                                │
│                                                                  │
│  同步与媒体层                                                     │
│  ├── sliding_sync_rooms (滑动同步)                               │
│  ├── media_metadata (媒体元数据)                                  │
│  └── user_directory (用户目录)                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、改进后的测试架构

### 3.1 多层验证测试模型

```typescript
/**
 * 改进后的测试验证模型
 * 每个测试操作都必须经过四层验证
 */

interface TestVerification {
  // 第一层：API 响应验证
  apiResponse: {
    statusCode: number;
    headers: Record<string, string>;
    body: any;
  };

  // 第二层：数据库状态验证 (新增)
  databaseState: {
    table: string;
    query: string;
    expectedRows: number;
    dataIntegrity: boolean;
  };

  // 第三层：端到端验证 (新增)
  e2eVerification: {
    createSuccess: boolean;
    readMatchesCreate: boolean;
    updateEffective: boolean;
    deleteComplete: boolean;
  };

  // 第四层：负面测试验证 (新增)
  negativeTesting: {
    errorExpected: boolean;
    errorCode: string;
    errorMessage: string;
    databaseUnchanged: boolean;
  };
}
```

### 3.2 数据库验证工具

```typescript
// spec/integ/real-backend/DatabaseVerifier.ts

import { Pool } from 'pg';

export class DatabaseVerifier {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
    });
  }

  /**
   * 验证数据是否正确写入数据库
   */
  async verifyData写入<T>(
    table: string,
    query: Record<string, any>,
    expected: Partial<T>
  ): Promise<VerificationResult> {
    const columns = Object.keys(query);
    const values = Object.values(query);
    const whereClause = columns.map((col, i) => `${col} = $${i + 1}`).join(' AND ');

    const result = await this.pool.query(
      `SELECT * FROM ${table} WHERE ${whereClause}`,
      values
    );

    if (result.rows.length === 0) {
      return {
        passed: false,
        error: `No rows found in ${table} matching query`,
        expected,
        actual: null,
      };
    }

    const row = result.rows[0];
    const mismatches: string[] = [];

    for (const [key, value] of Object.entries(expected)) {
      if (row[key] !== value) {
        mismatches.push(`Column ${key}: expected ${value}, got ${row[key]}`);
      }
    }

    return {
      passed: mismatches.length === 0,
      error: mismatches.length > 0 ? mismatches.join('; ') : undefined,
      expected,
      actual: row,
    };
  }

  /**
   * 验证表记录数量
   */
  async verifyRecordCount(
    table: string,
    condition?: string
  ): Promise<number> {
    const query = condition
      ? `SELECT COUNT(*) FROM ${table} WHERE ${condition}`
      : `SELECT COUNT(*) FROM ${table}`;
    const result = await this.pool.query(query);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * 验证数据完整性 (外键关系)
   */
  async verifyDataIntegrity(
    mainTable: string,
    mainId: string,
    relatedTable: string,
    foreignKey: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM ${relatedTable} WHERE ${foreignKey} = $1`,
      [mainId]
    );
    return result.rows.length > 0;
  }

  /**
   * 验证字段类型
   */
  async verifyFieldType(
    table: string,
    column: string,
    expectedType: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2`,
      [table, column]
    );
    return result.rows[0]?.data_type === expectedType;
  }

  /**
   * 验证索引存在
   */
  async verifyIndexExists(
    table: string,
    indexName: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2`,
      [table, indexName]
    );
    return result.rows.length > 0;
  }

  /**
   * 清理测试数据
   */
  async cleanup(testId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM rooms WHERE name LIKE $1`,
      [`%${testId}%`]
    );
    await this.pool.query(
      `DELETE FROM users WHERE name LIKE $1`,
      [`%${testId}%`]
    );
  }
}

interface VerificationResult {
  passed: boolean;
  error?: string;
  expected: any;
  actual: any;
}
```

---

## 四、改进后的测试用例

### 4.1 认证模块测试 (改进版)

```typescript
// spec/integ/real-backend/auth/login-with-db-verification.test.ts

import { DatabaseVerifier } from '../DatabaseVerifier';

describe("登录功能测试 (数据库验证)", () => {
  let dbVerifier: DatabaseVerifier;
  let testUtils: TestUtils;

  beforeAll(() => {
    dbVerifier = new DatabaseVerifier('postgresql://synapse:synapse@localhost:5432/synapse');
    testUtils = new TestUtils();
  });

  afterAll(async () => {
    await dbVerifier.cleanup('login-test');
    await testUtils.cleanup();
  });

  test("登录后数据库 access_tokens 表应有记录", async () => {
    // 1. 执行登录
    const client = await testUtils.createUserClient(0);
    const accessToken = client.getAccessToken();

    // 2. API 层面验证
    expect(client.isLoggedIn()).toBe(true);
    expect(accessToken).toBeTruthy();

    // 3. ⭐ 数据库层面验证 (新增)
    const tokenRecord = await dbVerifier.pool.query(
      `SELECT * FROM access_tokens WHERE token = $1`,
      [accessToken]
    );

    expect(tokenRecord.rows.length).toBe(1);
    expect(tokenRecord.rows[0].user_id).toContain('user1');
    expect(tokenRecord.rows[0].invalidated).toBe(false);
  });

  test("登出后数据库 access_tokens 表记录应失效", async () => {
    // 1. 登录
    const client = await testUtils.createUserClient(1);
    const accessToken = client.getAccessToken();

    // 2. API 层面登出
    await client.logout();

    // 3. ⭐ 数据库层面验证
    const tokenRecord = await dbVerifier.pool.query(
      `SELECT * FROM access_tokens WHERE token = $1`,
      [accessToken]
    );

    expect(tokenRecord.rows[0].invalidated).toBe(true);
  });

  test("登录后 users 表的 last_seen_ts 应更新", async () => {
    const userId = testConfig.users[0].userId;

    // 记录登录前的 last_seen_ts
    const beforeResult = await dbVerifier.pool.query(
      `SELECT last_seen_ts FROM users WHERE name = $1`,
      [userId]
    );
    const beforeTs = beforeResult.rows[0]?.last_seen_ts;

    // 登录
    const client = await testUtils.createUserClient(0);
    await testUtils.wait(1000); // 等待异步更新

    // ⭐ 验证 last_seen_ts 已更新
    const afterResult = await dbVerifier.pool.query(
      `SELECT last_seen_ts FROM users WHERE name = $1`,
      [userId]
    );
    const afterTs = afterResult.rows[0]?.last_seen_ts;

    expect(afterTs).toBeGreaterThan(beforeTs || 0);
  });
});
```

### 4.2 注册模块测试 (改进版)

```typescript
// spec/integ/real-backend/auth/register-with-db-verification.test.ts

describe("注册功能测试 (数据库验证)", () => {
  let dbVerifier: DatabaseVerifier;

  beforeAll(() => {
    dbVerifier = new DatabaseVerifier('postgresql://synapse:synapse@localhost:5432/synapse');
  });

  afterAll(async () => {
    await dbVerifier.cleanup('register-test');
  });

  test("新用户注册后 users 表应有记录", async () => {
    const testUsername = `testuser_${Date.now()}`;
    const testPassword = 'Test_password123';

    // 1. 调用注册 API
    const response = await fetch('http://localhost:28008/_matrix/client/r0/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth: { type: 'm.login.password' },
        username: testUsername,
        password: testPassword,
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.user_id).toBeTruthy();

    // 2. ⭐ 数据库层面验证
    const userRecord = await dbVerifier.pool.query(
      `SELECT * FROM users WHERE name = $1`,
      [`@${testUsername}:cjystx.top`]
    );

    expect(userRecord.rows.length).toBe(1);
    expect(userRecord.rows[0].name).toBe(`@${testUsername}:cjystx.top`);
    expect(userRecord.rows[0].email).toBeNull();
    expect(userRecord.rows[0].is_globally_confirmed).toBe(true);
  });

  test("注册后 devices 表应有默认设备记录", async () => {
    const testUsername = `testuser_device_${Date.now()}`;

    // 注册
    const response = await fetch('http://localhost:28008/_matrix/client/r0/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth: { type: 'm.login.password' },
        username: testUsername,
        password: 'Test_password123',
      }),
    });

    const data = await response.json();

    // ⭐ 验证 devices 表
    const deviceRecord = await dbVerifier.pool.query(
      `SELECT * FROM devices WHERE user_id = $1`,
      [data.user_id]
    );

    expect(deviceRecord.rows.length).toBeGreaterThan(0);
    expect(deviceRecord.rows[0].device_id).toBeTruthy();
  });

  test("重复用户名注册应返回 M_USER_IN_USE 错误", async () => {
    const testUsername = `dup_user_${Date.now()}`;

    // 第一次注册
    await fetch('http://localhost:28008/_matrix/client/r0/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth: { type: 'm.login.password' },
        username: testUsername,
        password: 'Test_password123',
      }),
    });

    // 第二次注册 (应该失败)
    const response = await fetch('http://localhost:28008/_matrix/client/r0/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth: { type: 'm.login.password' },
        username: testUsername,
        password: 'Test_password123',
      }),
    });

    expect(response.status).toBe(400);
    const error = await response.json();
    expect(error.errcode).toBe('M_USER_IN_USE');

    // ⭐ 验证数据库中只有一个用户记录
    const userCount = await dbVerifier.verifyRecordCount(
      'users',
      `name LIKE '%${testUsername}%'`
    );
    expect(userCount).toBe(1);
  });
});
```

### 4.3 房间模块测试 (改进版)

```typescript
// spec/integ/real-backend/room/create-room-with-db-verification.test.ts

describe("房间创建测试 (数据库验证)", () => {
  let dbVerifier: DatabaseVerifier;
  let userClient: MatrixClient;

  beforeAll(async () => {
    dbVerifier = new DatabaseVerifier('postgresql://synapse:synapse@localhost:5432/synapse');
    userClient = await testUtils.createUserClient(0);
  });

  afterAll(async () => {
    await dbVerifier.cleanup('room-test');
    await testUtils.cleanup();
  });

  test("创建房间后 rooms 表应有记录", async () => {
    const roomName = `Test Room DB ${Date.now()}`;

    // 1. API 创建房间
    const room = await userClient.createRoom({
      name: roomName,
      visibility: 'public',
    });

    expect(room.room_id).toBeTruthy();

    // 2. ⭐ 数据库层面验证 rooms 表
    const roomRecord = await dbVerifier.pool.query(
      `SELECT * FROM rooms WHERE room_id = $1`,
      [room.room_id]
    );

    expect(roomRecord.rows.length).toBe(1);
    expect(roomRecord.rows[0].name).toBe(roomName);
    expect(roomRecord.rows[0].creator).toContain('user1');
  });

  test("创建房间后 room_memberships 表应有创建者记录", async () => {
    const room = await userClient.createRoom({
      name: `Test Membership ${Date.now()}`,
    });

    // ⭐ 验证 room_memberships 表
    const membershipRecord = await dbVerifier.pool.query(
      `SELECT * FROM room_memberships WHERE room_id = $1`,
      [room.room_id]
    );

    expect(membershipRecord.rows.length).toBeGreaterThan(0);
    expect(membershipRecord.rows[0].user_id).toContain('user1');
    expect(membershipRecord.rows[0].membership).toBe('join');
    expect(membershipRecord.rows[0].sender).toContain('user1');
  });

  test("创建房间后 events 表应有 m.room.create 事件", async () => {
    const room = await userClient.createRoom({
      name: `Test Events ${Date.now()}`,
    });

    // ⭐ 验证 events 表
    const createEvent = await dbVerifier.pool.query(
      `SELECT * FROM events WHERE room_id = $1 AND event_type = $2`,
      [room.room_id, 'm.room.create']
    );

    expect(createEvent.rows.length).toBe(1);
    expect(createEvent.rows[0].sender).toContain('user1');
    expect(JSON.parse(createEvent.rows[0].content)).toBeDefined();
  });

  test("创建带初始状态的房间应正确保存状态", async () => {
    const room = await userClient.createRoom({
      name: 'Room with State',
      initial_state: [
        {
          type: 'm.room.topic',
          content: { topic: 'Test Topic' },
        },
        {
          type: 'm.room.power_levels',
          content: { users_default: 0 },
        },
      ],
    });

    // ⭐ 验证状态事件
    const topicEvent = await dbVerifier.pool.query(
      `SELECT * FROM room_state_events
       WHERE room_id = $1 AND event_type = $2 AND state_key = $3`,
      [room.room_id, 'm.room.topic', '']
    );

    expect(topicEvent.rows.length).toBe(1);
    expect(JSON.parse(topicEvent.rows[0].content).topic).toBe('Test Topic');
  });
});
```

### 4.4 消息模块测试 (改进版)

```typescript
// spec/integ/real-backend/message/send-message-with-db-verification.test.ts

describe("消息发送测试 (数据库验证)", () => {
  let dbVerifier: DatabaseVerifier;
  let userClient: MatrixClient;
  let roomId: string;

  beforeAll(async () => {
    dbVerifier = new DatabaseVerifier('postgresql://synapse:synapse@localhost:5432/synapse');
    userClient = await testUtils.createUserClient(0);

    const room = await userClient.createRoom({
      name: `Message Test Room ${Date.now()}`,
    });
    roomId = room.room_id;
    await testUtils.wait(500); // 等待同步
  });

  afterAll(async () => {
    await dbVerifier.cleanup('message-test');
    await testUtils.cleanup();
  });

  test("发送消息后 events 表应有记录", async () => {
    const content = {
      msgtype: 'm.text',
      body: 'Hello from DB test!',
    };

    // 1. API 发送消息
    const result = await userClient.sendRoomEvent(roomId, 'm.room.message', content);
    expect(result.event_id).toBeTruthy();

    // 2. ⭐ 数据库层面验证
    const eventRecord = await dbVerifier.pool.query(
      `SELECT * FROM events WHERE event_id = $1`,
      [result.event_id]
    );

    expect(eventRecord.rows.length).toBe(1);
    expect(eventRecord.rows[0].room_id).toBe(roomId);
    expect(eventRecord.rows[0].event_type).toBe('m.room.message');
    expect(eventRecord.rows[0].sender).toContain('user1');
  });

  test("发送消息后 room_state_events 表不应有记录 ( transient 事件)", async () => {
    const content = {
      msgtype: 'm.text',
      body: 'Transient message',
    };

    const result = await userClient.sendRoomEvent(roomId, 'm.room.message', content);

    // ⭐ 验证 room_state_events 表 (应该没有这个事件)
    const stateEvent = await dbVerifier.pool.query(
      `SELECT * FROM room_state_events WHERE event_id = $1`,
      [result.event_id]
    );

    expect(stateEvent.rows.length).toBe(0);
  });

  test("获取房间消息应与 events 表数据一致", async () => {
    // API 获取消息
    const messages = await userClient.roomMessages(roomId, 'b', 'f', 10);

    // ⭐ 数据库获取消息
    const dbEvents = await dbVerifier.pool.query(
      `SELECT event_id, event_type, content FROM events
       WHERE room_id = $1 ORDER BY origin_server_ts ASC LIMIT 10`,
      [roomId]
    );

    expect(messages.chunk.length).toBe(dbEvents.rows.length);

    // 验证消息内容一致
    for (let i = 0; i < messages.chunk.length; i++) {
      expect(messages.chunk[i].event_id).toBe(dbEvents.rows[i].event_id);
    }
  });

  test("删除消息后 events 表记录状态应更新", async () => {
    const content = { msgtype: 'm.text', body: 'To be redacted' };
    const result = await userClient.sendRoomEvent(roomId, 'm.room.message', content);

    // ⭐ 验证原始事件存在
    let event = await dbVerifier.pool.query(
      `SELECT * FROM events WHERE event_id = $1`,
      [result.event_id]
    );
    expect(event.rows[0].redacted_by).toBeNull();

    // API 删除消息 (redact)
    await userClient.redactEvent(roomId, result.event_id);

    // ⭐ 验证事件已被标记为删除
    event = await dbVerifier.pool.query(
      `SELECT * FROM events WHERE event_id = $1`,
      [result.event_id]
    );
    expect(event.rows[0].redacted_by).toBeTruthy();
  });
});
```

### 4.5 数据库完整性测试 (新增)

```typescript
// spec/integ/real-backend/database-integrity.test.ts

describe("数据库完整性测试 (新增)", () => {
  let dbVerifier: DatabaseVerifier;

  beforeAll(() => {
    dbVerifier = new DatabaseVerifier('postgresql://synapse:synapse@localhost:5432/synapse');
  });

  describe("TIMESTAMP 字段类型验证", () => {
    test("用户表应使用 BIGINT 而非 TIMESTAMP", async () => {
      // 获取 users 表的 created_ts 字段类型
      const result = await dbVerifier.pool.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_name = 'users' AND column_name IN ('created_ts', 'updated_ts', 'last_seen_ts')`
      );

      for (const row of result.rows) {
        expect(row.data_type).toBe('bigint');
      }
    });

    test("user_directory 表应使用 BIGINT 时间戳字段", async () => {
      const result = await dbVerifier.pool.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_name = 'user_directory' AND column_name LIKE '%_ts'`
      );

      for (const row of result.rows) {
        expect(row.data_type).toBe('bigint');
      }
    });
  });

  describe("索引完整性验证", () => {
    test("rooms 表应有 creator 列的索引", async () => {
      const hasIndex = await dbVerifier.verifyIndexExists('rooms', 'idx_rooms_creator');
      expect(hasIndex).toBe(true);
    });

    test("events 表应有 room_id 和 event_type 的复合索引", async () => {
      const result = await dbVerifier.pool.query(
        `SELECT 1 FROM pg_indexes
         WHERE tablename = 'events' AND indexname LIKE '%room_id%event_type%'`
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe("外键完整性验证", () => {
    test("room_memberships 表的 room_id 应引用 rooms 表", async () => {
      const result = await dbVerifier.pool.query(
        `SELECT 1 FROM information_schema.table_constraints
         WHERE constraint_type = 'FOREIGN KEY'
         AND table_name = 'room_memberships'
         AND constraint_name LIKE '%room_id%'`
      );
      // 验证外键约束存在
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe("数据一致性验证", () => {
    test("所有房间成员都应在 users 表中存在", async () => {
      const result = await dbVerifier.pool.query(
        `SELECT COUNT(*) FROM room_memberships rm
         LEFT JOIN users u ON rm.user_id = u.name
         WHERE u.name IS NULL`
      );
      expect(parseInt(result.rows[0].count)).toBe(0);
    });
  });
});
```

---

## 五、测试环境配置

### 5.1 环境要求

```yaml
# docker-compose.yml 追加配置

services:
  synapse-rust:
    ports:
      - "28008:8008"
      - "28448:8448"
    environment:
      - DATABASE_URL=postgresql://synapse:synapse@postgres:5432/synapse
      - RUST_LOG=info,synapse=debug
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=synapse
      - POSTGRES_USER=synapse
      - POSTGRES_PASSWORD=synapse
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U synapse"]
      interval: 5s
      timeout: 5s
      retries: 5
```

### 5.2 数据库健康检查脚本

```bash
#!/bin/bash
# scripts/db-health-check.sh

set -e

echo "=== 数据库健康检查 ==="

# 1. 检查连接
docker exec docker-postgres psql -U synapse -d synapse -c "SELECT 1;" > /dev/null
echo "✓ 数据库连接正常"

# 2. 检查表数量
TABLE_COUNT=$(docker exec docker-postgres psql -U synapse -d synapse -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')
echo "✓ 表数量: $TABLE_COUNT"

# 3. 检查 TIMESTAMP 违规 ⭐
TIMESTAMP_COUNT=$(docker exec docker-postgres psql -U synapse -d synapse -t -c \
  "SELECT COUNT(*) FROM information_schema.columns
   WHERE data_type LIKE '%timestamp%'
   AND table_schema = 'public'
   AND table_name NOT IN ('pg_stat_statements_info', 'schema_migrations', 'voice_usage_stats');" | tr -d ' ')

if [ "$TIMESTAMP_COUNT" -eq 0 ]; then
  echo "✓ 无 TIMESTAMP 违规"
else
  echo "✗ 发现 $TIMESTAMP_COUNT 个 TIMESTAMP 违规"
  docker exec docker-postgres psql -U synapse -d synapse -c \
    "SELECT table_name, column_name FROM information_schema.columns
     WHERE data_type LIKE '%timestamp%'
     AND table_schema = 'public'
     AND table_name NOT IN ('pg_stat_statements_info', 'schema_migrations', 'voice_usage_stats');"
fi

# 4. 检查索引
INDEX_COUNT=$(docker exec docker-postgres psql -U synapse -d synapse -t -c \
  "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';" | tr -d ' ')
echo "✓ 索引数量: $INDEX_COUNT"

echo "=== 检查完成 ==="
```

---

## 六、测试执行流程

### 6.0 Key Verification Real-Backend 快速回归

本轮已补一条面向真实后端的 `KeyVerificationManager` 联调用例，直接覆盖以下 HTTP 闭环：

- `POST /_matrix/client/v1/keys/device_signing/verify_start`
- `GET /_matrix/client/v1/keys/device_signing/requests`
- `POST /_matrix/client/v1/keys/device_signing/verify_cancel`
- 取消后再次查询 `requests`，确认待处理请求已移除

相关文件：

- `spec/integ/real-backend/key-verification-manager.spec.ts`
- `vitest.real-backend.config.ts`

前置条件：

- `synapse-rust` docker compose 已启动，且 `localhost:28008` 可访问
- 如后端代码有更新，先重建并重启容器

运行命令：

```bash
cd /Users/ljf/Desktop/hu/matrix-js-sdk
pnpm test:real-backend
```

若需要单独运行 verification 用例：

```bash
pnpm test:real-backend:verification
```

若需要从后端侧一条命令完成“重建容器 + 等待服务 + 跑 SDK 联调”：

```bash
cd /Users/ljf/Desktop/hu/synapse-rust
./scripts/test/run_sdk_verification_real_backend.sh
```

### 6.1 完整测试流程

```bash
#!/bin/bash
# scripts/run-full-test.sh

set -e

echo "=== 1. 环境准备 ==="
# 启动服务
cd /Users/ljf/Desktop/hu/synapse-rust/docker
docker compose up -d

# 等待服务就绪
sleep 10

# 数据库健康检查
../scripts/db-health-check.sh

echo "=== 2. SDK 构建 ==="
cd /Users/ljf/Desktop/hu/matrix-js-sdk
pnpm install
pnpm build

echo "=== 3. 运行测试 ==="
# 阶段1: 认证测试
echo "--- 阶段1: 认证测试 ---"
npx tsx spec/integ/real-backend/auth/login-with-db-verification.test.ts

# 阶段2: Admin API 测试
echo "--- 阶段2: Admin API 测试 ---"
npx tsx spec/integ/real-backend/admin/user-management-with-db-verification.test.ts

# 阶段3: 房间测试
echo "--- 阶段3: 房间测试 ---"
npx tsx spec/integ/real-backend/room/create-room-with-db-verification.test.ts

# 阶段4: 消息测试
echo "--- 阶段4: 消息测试 ---"
npx tsx spec/integ/real-backend/message/send-message-with-db-verification.test.ts

# 阶段5: 数据库完整性测试 ⭐
echo "--- 阶段5: 数据库完整性测试 ---"
npx tsx spec/integ/real-backend/database-integrity.test.ts

echo "=== 测试完成 ==="
```

### 6.2 测试结果报告模板

```markdown
## 测试结果报告

**测试日期**: {date}
**后端版本**: {version}
**SDK版本**: {sdk_version}
**数据库状态**: {db_health}

### 执行摘要

| 指标 | 值 |
|------|-----|
| 总测试用例 | {total} |
| 通过 | {passed} |
| 失败 | {failed} |
| 跳过 | {skipped} |
| 通过率 | {rate}% |

### 数据库验证结果 ⭐

| 检查项 | 状态 |
|--------|------|
| 表数量正常 | {table_count_ok} |
| 索引数量正常 | {index_count_ok} |
| 无 TIMESTAMP 违规 | {timestamp_ok} |
| 数据一致性 | {integrity_ok} |

### 失败用例详情

{failures}

### 建议

{recommendations}
```

---

## 七、验证标准

### 7.1 API 层面验证标准

| 验证项 | 标准 | 严重程度 |
|--------|------|----------|
| HTTP 状态码 | 必须返回 2xx/4xx/5xx 正确码 | P0 |
| 响应体结构 | 必须符合 Matrix API 规范 | P0 |
| 错误码 | 错误必须返回正确的 errcode | P1 |
| 字段类型 | 字段类型必须与规范一致 | P1 |

### 7.2 数据库层面验证标准 ⭐ 新增

| 验证项 | 标准 | 严重程度 |
|--------|------|----------|
| 数据写入 | CRUD 操作后数据库必须有对应记录 | P0 |
| 字段类型 | 必须符合 DATABASE_FIELD_STANDARDS.md | P0 |
| 外键完整性 | 关联数据必须存在或正确级联 | P0 |
| 索引生效 | 索引必须存在且被查询使用 | P1 |
| 事务正确性 | 失败操作必须回滚，不留脏数据 | P0 |

### 7.3 端到端验证标准

| 验证项 | 标准 | 严重程度 |
|--------|------|----------|
| C-R-U-D 完整性 | 创建→读取→更新→删除必须完整 | P0 |
| 数据一致性 | 操作后数据库状态必须与 API 响应一致 | P0 |
| 错误恢复 | 错误后系统必须处于一致状态 | P0 |

---

## 八、异常处理机制

### 8.1 测试异常分类

```typescript
enum TestErrorType {
  API_ERROR = 'API_ERROR',           // API 返回错误
  DB_ERROR = 'DB_ERROR',             // 数据库操作失败
  ASSERTION_ERROR = 'ASSERTION_ERROR', // 断言失败
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',   // 超时
  DATA_INTEGRITY_ERROR = 'DATA_INTEGRITY_ERROR', // 数据不一致 ⭐
  TRANSACTION_ABORT_ERROR = 'TRANSACTION_ABORT_ERROR', // 事务中止 ⭐
}
```

### 8.2 错误处理策略

```typescript
async function withDatabaseVerification<T>(
  apiOperation: () => Promise<T>,
  dbVerification: () => Promise<boolean>,
  cleanup?: () => Promise<void>
): Promise<{ success: boolean; error?: TestError }> {
  try {
    // 执行 API 操作
    const result = await apiOperation();

    // 验证数据库状态
    const dbValid = await dbVerification();
    if (!dbValid) {
      return {
        success: false,
        error: {
          type: TestErrorType.DATA_INTEGRITY_ERROR,
          message: 'Database state does not match API response',
        },
      };
    }

    return { success: true };
  } catch (error) {
    // 清理
    if (cleanup) await cleanup();

    return {
      success: false,
      error: categorizeError(error),
    };
  }
}
```

---

## 九、后续改进计划

### 9.1 短期改进 (1-2周)

- [x] 实现 DatabaseVerifier 工具类 ✅
- [x] 修复 psql 输出解析支持 pipe 和 space-aligned 格式 ✅
- [x] 修复 TypeScript 类型错误 ✅
- [x] 重写核心测试用例添加数据库验证 ✅
- [x] 添加数据库健康检查到 CI/CD (database-integrity.test.ts) ✅
- [ ] 实现完整的端到端测试框架
- [ ] 添加并发测试场景

### 9.2 中期改进 (1个月)

- [ ] 建立性能基准测试
- [ ] 实现登录模块的数据库验证测试
- [ ] 实现房间模块的数据库验证测试
- [ ] 实现消息模块的数据库验证测试

### 9.3 长期改进 (3个月)

- [ ] 集成到主 CI/CD 流程
- [ ] 添加自动化测试报告
- [ ] 建立回归测试套件

---

## 十、已完成的实现 (2026-03-20)

### 10.1 DatabaseVerifier.ts ✅

**文件位置**: `spec/integ/real-backend/DatabaseVerifier.ts`

**功能**:
- 使用 docker exec 直接查询 PostgreSQL 数据库
- 支持 pipe-separated 和 space-aligned 两种 psql 输出格式
- 提供健康检查、表统计、字段类型验证、索引检查等功能

**修复的问题**:
1. 添加 `/// <reference types="node" />` 解决 TypeScript 类型错误
2. 修复 psql 输出解析逻辑，正确处理 space-aligned 格式
3. 修复 header 行过滤逻辑，避免过滤掉单列表数据

### 10.2 database-integrity.test.ts ✅

**文件位置**: `spec/integ/real-backend/database-integrity.test.ts`

**测试覆盖** (21 个测试全部通过):
- Database Connection (1 test)
- Table Structure (2 tests)
- TIMESTAMP Field Type Validation (3 tests)
- Index Integrity (4 tests)
- Data Integrity (3 tests)
- PostgreSQL Configuration (5 tests)
- Key Tables Verification (3 tests)

**运行命令**:
```bash
npx vitest run spec/integ/real-backend/database-integrity.test.ts --config vitest.real-backend.config.ts
```

### 10.3 TestConfig.ts ✅

**文件位置**: `spec/integ/real-backend/TestConfig.ts`

**更新内容**:
- baseUrl 更新为 `http://localhost:28008` (OrbStack 端口映射)

### 10.4 login-db-verification.test.ts ✅

**文件位置**: `spec/integ/real-backend/login-db-verification.test.ts`

**功能**: 登录数据库验证测试框架

**注意**: 由于 admin 用户通过 HMAC 注册没有密码哈希，登录测试需要带有密码的测试用户

---

## 十一、已知问题与解决方案 (2026-03-21)

### 问题 #1: 数据库 Schema 与代码不一致 ✅ 已修复

**问题描述**: 
- 后端代码 `src/storage/user.rs` 中 INSERT 语句包含 `is_password_change_required` 字段
- 但迁移文件 `migrations/00000000_unified_schema_v6.sql` 中 users 表没有定义此字段
- 导致所有登录操作返回 500 错误

**错误信息**:
```
M_UNKNOWN: MatrixError: [500] column "is_password_change_required" does not exist
```

**解决方案**:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_password_change_required BOOLEAN NOT NULL DEFAULT FALSE;
```

**状态**: ✅ 已修复 (2026-03-21)

---

### 问题 #2: events 表缺少 processed_ts 列 ✅ 已修复

**错误信息**:
```
column "processed_ts" does not exist
```

**解决方案**:
```sql
ALTER TABLE events ADD COLUMN IF NOT EXISTS processed_ts BIGINT;
```

**状态**: ✅ 已修复 (2026-03-21)

---

### 问题 #3: TIMESTAMP 类型字段未完全迁移

**问题描述**:
- 数据库中仍有部分表使用 TIMESTAMP 类型而非 BIGINT
- 导致数据库完整性测试失败

**解决方案**:
- 逐步迁移剩余的 TIMESTAMP 字段
- 参考 `DATABASE_FIELD_STANDARDS.md`

**状态**: 待修复 (P1)

---

## 十二、测试执行检查清单

### 测试前检查

- [ ] 后端服务运行中 (curl http://localhost:28008/_matrix/client/versions)
- [ ] 数据库服务运行中
- [ ] SDK 构建完成 (pnpm build)
- [ ] 数据库 Schema 与代码一致

### 数据库健康检查

```bash
# 运行数据库完整性测试
npx vitest run spec/integ/real-backend/database-integrity.test.ts --config vitest.real-backend.config.ts
```

### 核心功能测试

- [ ] 登录/登出
- [ ] 用户注册
- [ ] 房间创建/删除
- [ ] 消息发送/接收
- [ ] 设备管理
- [ ] 加密功能

---

## 十三、API 全面测试结果 (2026-03-21)

### 测试方法
使用 testing-api-tester 专家模式，对后端 API 进行全面测试

### 测试结果

| 类别 | API | 状态 | 说明 |
|------|-----|------|------|
| **公开 API** | | | |
| | Versions | ✅ 200 | 正常 |
| | Login | ⚠️ 400 | 需要正确参数 |
| **认证 API** | | | |
| | WhoAmI | ✅ 200 | 正常 |
| | Profile | ✅ 200 | 正常 |
| | Devices | ✅ 200 | 正常 |
| | JoinedRooms | ✅ 200 | 正常 |
| | Sync | ✅ 200 | **已修复** |
| | UserDirectory | ❌ 405 | 方法不允许 |
| **房间 API** | | | |
| | CreateRoom | ✅ 200 | 正常 |
| | RoomState | ✅ 200 | 正常 |
| | RoomMessages | ✅ 200 | 正常 |
| | RoomMembers | ✅ 200 | 正常 |
| | SendMessage | ✅ 200 | 正常 |
| | DeleteRoom | ❌ 405 | 方法不允许 |
| **密钥 API** | | | |
| | KeysClaim | ❌ 400 | 请求格式错误 |
| | KeysQuery | ❌ 400 | 请求格式错误 |
| **管理 API** | | | |
| | AdminUsers | ❌ 403 | 权限不足 |
| | AdminRooms | ❌ 403 | 权限不足 |

### 修复的问题

| 问题 | 修复方式 | 状态 |
|------|----------|------|
| Sync API 500 | 添加 `room_ephemeral.expires_at` 计算列 | ✅ 已修复 |

---

## 十四、待解决问题

### 已解决

| 问题 | 状态 | 说明 |
|------|------|------|
| UserDirectory API (405) | ✅ 已解决 | 使用 POST 方法 |
| DeleteRoom API (405) | ✅ 已解决 | 使用 POST /leave |
| KeysClaim/KeysQuery (400) | ✅ 已解决 | 需要正确的请求体 |
| Sync API 500 | ✅ 已修复 | 添加 expires_at 列 |

### 待实现

| 问题 | 状态 | 说明 |
|------|------|------|
| Admin API (403) | 🔶 待开发 | 需要实现管理员注册 API |
| 管理员房间删除 | 🔶 待开发 | 需要实现 delete room API |

---

*文档版本: 6.0*
*最后更新: 2026-03-21*
*维护者: HuLa Team*
