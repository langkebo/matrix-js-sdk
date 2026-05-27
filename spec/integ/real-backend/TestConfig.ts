/**
 * SDK Real Backend Test Configuration
 *
 * 用于在真实后端服务器上测试SDK模块
 */

declare const process: {
    env: Record<string, string | undefined>;
};

export const TestConfig = {
    // 后端配置，默认指向当前真实后端测试域名
    baseUrl: process.env.MATRIX_REAL_BACKEND_BASE_URL || "https://matrix.test",

    // 测试用户配置
    testUser: {
        userId: process.env.MATRIX_REAL_BACKEND_TEST_USER_ID || "@sdk_testuser:matrix.test",
        password: process.env.MATRIX_REAL_BACKEND_TEST_USER_PASSWORD || "Test@123",
        deviceId: process.env.MATRIX_REAL_BACKEND_TEST_DEVICE_ID || "TEST_DEVICE",
    },

    // 辅助用户
    secondaryUser: {
        userId: process.env.MATRIX_REAL_BACKEND_SECONDARY_USER_ID || "@sdk_testuser2:matrix.test",
        password: process.env.MATRIX_REAL_BACKEND_SECONDARY_USER_PASSWORD || "Test@123",
    },

    // 测试房间配置
    testRoom: {
        name: "SDK Test Room",
        topic: "Test Room for SDK Integration Testing",
    },

    // 测试DM配置
    testDM: {
        name: "SDK Test DM",
    },

    // 超时配置 (毫秒)
    timeout: {
        short: 5000,
        medium: 15000,
        long: 30000,
    },

    // 测试消息
    testMessages: ["Hello, World!", "Test message 1", "Test message 2", "中文测试消息"],
};

export function getRealBackendVersionsUrl(): string {
    return new URL("/_matrix/client/versions", TestConfig.baseUrl).toString();
}

export function isRealBackendReachable(): boolean {
    try {
        new URL(getRealBackendVersionsUrl());
        return true;
    } catch {
        return false;
    }
}

export default TestConfig;
