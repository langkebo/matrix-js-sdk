/**
 * SDK Real Backend Test Configuration
 * 
 * 用于在真实后端服务器上测试SDK模块
 */

export const TestConfig = {
    // 后端配置 (OrbStack 端口映射: 28008 -> 8008)
    baseUrl: "http://localhost:28008",

    // 测试用户配置
    testUser: {
        userId: "@testuser4:cjystx.top",
        password: "Test@123",
        deviceId: "TEST_DEVICE"
    },

    // 辅助用户
    secondaryUser: {
        userId: "@testuser5:cjystx.top",
        password: "Test@123"
    },
    
    // 测试房间配置
    testRoom: {
        name: "SDK Test Room",
        topic: "Test Room for SDK Integration Testing"
    },
    
    // 测试DM配置
    testDM: {
        name: "SDK Test DM"
    },
    
    // 超时配置 (毫秒)
    timeout: {
        short: 5000,
        medium: 15000,
        long: 30000
    },
    
    // 测试消息
    testMessages: [
        "Hello, World!",
        "Test message 1",
        "Test message 2",
        "中文测试消息"
    ]
};

export default TestConfig;
