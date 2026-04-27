/**
 * Matrix JS SDK 连接本地后端测试
 *
 * 使用方法:
 *   node test-local-backend.js
 *
 * 或使用环境变量指定:
 *   HOMESERVER=http://localhost:28008 USER_ID=@testuser:cjystx.top ACCESS_TOKEN=your_token node test-local-backend.js
 */

import sdk from "./lib/index.js";

const HOMESERVER = process.env.HOMESERVER || "http://localhost:28008";
const USER_ID = process.env.USER_ID || "@testuser:cjystx.top";
let ACTUAL_USER_ID = USER_ID;

// 先获取 token
async function getAccessToken() {
    const response = await fetch(`${HOMESERVER}/_matrix/client/r0/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            type: "m.login.password",
            user: "testuser",
            password: "TestPass123!",
        }),
    });
    const data = await response.json();
    console.log("Login response:", JSON.stringify(data).substring(0, 200));
    return data;
}

async function runTests() {
    console.log("=".repeat(50));
    console.log("Matrix SDK - 本地后端测试");
    console.log("=".repeat(50));
    console.log(`Homeserver: ${HOMESERVER}`);
    console.log(`User ID: ${USER_ID}`);
    console.log();

    let accessToken = process.env.ACCESS_TOKEN;

    if (!accessToken) {
        console.log("正在获取 access token...");
        const loginData = await getAccessToken();
        accessToken = loginData.access_token;
        ACTUAL_USER_ID = loginData.user_id;
        console.log(`Token: ${accessToken?.substring(0, 50)}...`);
        console.log(`User ID: ${ACTUAL_USER_ID}`);
    }

    // 创建客户端
    console.log("\n创建 Matrix 客户端...");
    const client = sdk.createClient({
        baseUrl: HOMESERVER,
        accessToken: accessToken,
        userId: ACTUAL_USER_ID,
    });

    // 启动客户端进行初始同步
    console.log("启动客户端同步...");
    await new Promise((resolve) => {
        client.on("sync", async (state) => {
            console.log(`  Sync state: ${state}`);
            if (state === "PREPARED") {
                // 等待一下确保房间数据加载完成
                setTimeout(resolve, 2000);
            }
        });
        client.startClient({ initialSyncLimit: 50 });
        // 超时保护
        setTimeout(resolve, 15000);
    });

    // 手动再同步一次确保获取最新房间
    console.log("进行额外同步...");
    try {
        await client.sync({ timeout: 3000 });
    } catch (e) {
        console.log("  额外同步完成");
    }

    // 测试 1: 获取用户信息
    console.log("\n--- 测试 1: 获取用户信息 (getProfileInfo) ---");
    try {
        const profile = await client.getProfileInfo(ACTUAL_USER_ID);
        console.log("✓ 获取用户信息成功");
        console.log(`  Display Name: ${profile.displayname || "(未设置)"}`);
        console.log(`  Avatar URL: ${profile.avatar_url || "(未设置)"}`);
    } catch (err) {
        console.log("✗ 获取用户信息失败:", err.message);
    }

    // 测试 2: 获取房间列表
    console.log("\n--- 测试 2: 获取房间列表 (getRooms) ---");
    try {
        const rooms = client.getRooms();
        console.log(`✓ 获取房间列表成功: ${rooms.length} 个房间`);
        rooms.forEach((room) => {
            console.log(`  - ${room.name || room.roomId}`);
        });
    } catch (err) {
        console.log("✗ 获取房间列表失败:", err.message);
    }

    // 测试 3: 创建房间
    console.log("\n--- 测试 3: 创建房间 (createRoom) ---");
    try {
        const room = await client.createRoom({
            name: "SDK Test Room",
            topic: "测试房间 - " + new Date().toISOString(),
            room_alias_name: "sdk-test-" + Date.now(),
        });
        console.log(`✓ 创建房间成功: ${room.room_id}`);
    } catch (err) {
        console.log("✗ 创建房间失败:", err.message);
    }

    // 测试 4: Sliding Sync (新 API)
    console.log("\n--- 测试 4: Sliding Sync ---");
    try {
        if (typeof client.slidingSync === "function") {
            const result = await client.slidingSync({
                timeout: 3000,
            });
            console.log("✓ Sliding Sync 成功");
        } else {
            console.log("⚠ Sliding Sync 不可用");
        }
    } catch (err) {
        console.log("✗ Sliding Sync 失败:", err.message);
    }

    // 测试 5: 加入房间
    console.log("\n--- 测试 5: 加入房间 (joinRoom) ---");
    try {
        // 创建一个公开房间
        const room = await client.createRoom({
            name: "Public Test Room",
            visibility: "public",
            room_alias_name: "public-test-" + Date.now(),
        });
        console.log(`✓ 创建公开房间: ${room.room_id}`);

        // 尝试加入
        const joinedRoom = await client.joinRoom(room.room_id);
        console.log(`✓ 加入房间成功`);
    } catch (err) {
        console.log("✗ 加入房间失败:", err.message);
    }

    // 测试 6: 获取房间成员
    console.log("\n--- 测试 6: 获取房间成员 ---");
    try {
        const rooms = client.getRooms();
        if (rooms.length > 0) {
            const room = rooms[0];
            const members = room.getMembers();
            console.log(`✓ 获取房间成员成功: ${members.length} 个成员`);
            members.slice(0, 3).forEach((m) => {
                console.log(`  - ${m.name || m.userId}`);
            });
        } else {
            console.log("跳过: 没有房间");
        }
    } catch (err) {
        console.log("✗ 获取房间成员失败:", err.message);
    }

    // 测试 7: 发送消息
    console.log("\n--- 测试 7: 发送消息 (sendTextMessage) ---");
    try {
        const rooms = client.getRooms();
        if (rooms.length > 0) {
            const room = rooms[0];
            const result = await client.sendTextMessage(
                room.roomId,
                "Hello from SDK Test! " + new Date().toISOString(),
            );
            console.log(`✓ 发送消息成功: ${result.event_id}`);
        } else {
            console.log("跳过: 没有房间");
        }
    } catch (err) {
        console.log("✗ 发送消息失败:", err.message);
    }

    // 测试 8: 获取房间信息
    console.log("\n--- 测试 8: 获取房间信息 (getRoom) ---");
    try {
        const rooms = client.getRooms();
        if (rooms.length > 0) {
            const room = rooms[0];
            console.log(`✓ 获取房间信息成功`);
            console.log(`  Room ID: ${room.roomId}`);
            console.log(`  Name: ${room.name || "(未设置)"}`);
            console.log(
                `  Topic: ${room.currentState.getStateEvents("m.room.topic")[0]?.getContent().topic || "(未设置)"}`,
            );
        } else {
            console.log("跳过: 没有房间");
        }
    } catch (err) {
        console.log("✗ 获取房间信息失败:", err.message);
    }

    // 测试 9: 设置房间名称
    console.log("\n--- 测试 9: 设置房间名称 (setRoomName) ---");
    try {
        const rooms = client.getRooms();
        if (rooms.length > 0) {
            const room = rooms[0];
            await client.setRoomName(room.roomId, "Updated Room Name - " + Date.now());
            console.log(`✓ 设置房间名称成功`);
        } else {
            console.log("跳过: 没有房间");
        }
    } catch (err) {
        console.log("✗ 设置房间名称失败:", err.message);
    }

    // 测试 10: 获取用户
    console.log("\n--- 测试 10: 获取用户 (getUser) ---");
    try {
        const user = client.getUser(USER_ID);
        console.log("✓ 获取用户成功");
        console.log(`  User ID: ${user.userId}`);
        console.log(`  Display Name: ${user.displayName || "(未设置)"}`);
    } catch (err) {
        console.log("✗ 获取用户失败:", err.message);
    }

    console.log("\n" + "=".repeat(50));
    console.log("测试完成");
    console.log("=".repeat(50));

    // 关闭客户端
    client.stopClient();
    process.exit(0);
}

runTests().catch((err) => {
    console.error("测试失败:", err);
    process.exit(1);
});
