/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * User Report Manager - 用户举报管理
 *
 * 提供用户举报功能
 * 对应后端 API:
 * - POST /users/{user_id}/report
 */

import { MatrixClient } from "../client";
import { Method } from "../http-api/index";
import { BaseManager, type ManagerOpts } from "../managers/base-manager";
import type { AuthPathPattern } from "../auth/__generated__/route-table";
import { registerManagerClass, getOrCreateManager } from "../client-infra/manager-registry";

type StripAuthPrefix<P extends string> =
    P extends `/_matrix/client/v3${infer Rest}` ? Rest :
    P extends `/_matrix/client/r0${infer Rest}` ? Rest :
    P extends `/_matrix/client/v1${infer Rest}` ? Rest :
    P;

function ap<P extends StripAuthPrefix<AuthPathPattern>>(path: P): P {
    return path;
}

export interface ReportUserRequest {
    reason: string;
    room_id?: string;
}

export class UserReportManager extends BaseManager {
    constructor(client: MatrixClient, opts?: ManagerOpts) {
        super(client, opts);
    }

    public async reportUser(userId: string, reason: string, roomId?: string): Promise<void> {
        const path = ap(`/users/${encodeURIComponent(userId)}/report` as StripAuthPrefix<AuthPathPattern>);
        const body: ReportUserRequest = { reason };
        if (roomId) {
            body.room_id = roomId;
        }
        await this.withRetry(async () => {
            await this.client.http.authedRequest(Method.Post, path, undefined, body);
        }, "reportUser");
    }
}


export function extendMatrixClient(): void {
    MatrixClient.prototype.getUserReportManager = function (): UserReportManager {
        registerManagerClass("userReport", UserReportManager);
    return getOrCreateManager(this, "userReport", () => new UserReportManager(this));
    };
}

export default extendMatrixClient;
