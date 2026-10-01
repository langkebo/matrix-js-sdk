/*
 * key-backup 请求路径构建（P3-5 从 client.ts 拆出）。
 *
 * 三种形态（无 roomId / 有 roomId / 有 roomId+sessionId）加可选 `version` 查询参数，
 * 原先内联在 `MatrixClient.makeKeyBackupPath()` 里，只能通过删除备份键的整体流程间接覆盖。
 */

import * as utils from "./utils.ts";
import type { IKeyBackupPath } from "./client-internal-types.ts";

/**
 * 构建 `/room_keys/keys` 系列路径。
 *
 * @param roomId - 房间 ID；给定则按房间取键
 * @param sessionId - 会话 ID；给定（需同时给 roomId）则按会话取键
 * @param version - 备份版本；给定则作为 `version` 查询参数
 */
export function makeKeyBackupPath(roomId?: string, sessionId?: string, version?: string): IKeyBackupPath {
    let path: string;
    if (sessionId !== undefined) {
        path = utils.encodeUri("/room_keys/keys/$roomId/$sessionId", {
            $roomId: roomId!,
            $sessionId: sessionId,
        });
    } else if (roomId !== undefined) {
        path = utils.encodeUri("/room_keys/keys/$roomId", {
            $roomId: roomId,
        });
    } else {
        path = "/room_keys/keys";
    }
    const queryData = version === undefined ? undefined : { version };
    return { path, queryData };
}
