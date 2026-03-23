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
 * Search Manager - 搜索管理
 * 
 * 提供消息、用户搜索功能
 */

import { MatrixClient } from "../client";

export class SearchManager {
    constructor(private client: MatrixClient) {}

    /**
     * Search message text
     */
    public async searchMessageText(opts: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).searchMessageText(opts);
    }

    /**
     * Search room events
     */
    public async searchRoomEvents(opts: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).searchRoomEvents(opts);
    }

    /**
     * Search user directory
     */
    public async searchUserDirectory(opts: { term: string; limit?: number }): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).searchUserDirectory(opts);
    }

    /**
     * General search
     */
    public async search(opts: any): Promise<any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).search(opts);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getSearchManager(): SearchManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getSearchManager = function (): SearchManager {
        return new SearchManager(this);
    };
}

export default extendMatrixClient;
