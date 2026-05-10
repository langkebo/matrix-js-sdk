/**
 * Browser Example - Matrix JS SDK D7 Optimization
 *
 * 演示如何使用优化后的 SDK 进行密钥备份与遥测上报。
 */

import * as sdk from "matrix-js-sdk";

async function runExample() {
    const client = sdk.createClient({
        baseUrl: "https://matrix.org",
        accessToken: "YOUR_ACCESS_TOKEN",
        userId: "@alice:example.com",
    });

    // 1. 初始化 Manager 扩展
    await sdk.extendMatrixClientWithManagers();

    // 2. 使用 Key Backup Manager (P0)
    const backupManager = client.getKeyBackupManager();
    try {
        const version = await backupManager.getLatestBackupVersion();
        console.log("Latest backup version:", version.version);

        // 批量获取密钥 (100% 契约对齐)
        const keys = await backupManager.getAllRoomKeys(version.version);
        console.log("Fetched keys for rooms:", Object.keys(keys.rooms).length);
    } catch (error) {
        if (error instanceof sdk.SdkError) {
            console.error("Backup operation failed:", {
                code: error.errorCode,
                traceId: error.traceId,
                tip: error.userTip,
            });
        }
    }

    // 3. 使用 Telemetry Manager (P1)
    const telemetry = client.getTelemetryManager();
    await telemetry.reportEvent("app_start", {
        platform: "browser",
        version: "1.0.0",
    });

    // 4. 使用 Feature Flag Manager (Admin)
    const flags = client.getFeatureFlagManager();
    const allFlags = await flags.listFlags({ status: "enabled" });
    console.log(
        "Active feature flags:",
        allFlags.flags.map((f) => f.key),
    );
}

runExample().catch(console.error);
