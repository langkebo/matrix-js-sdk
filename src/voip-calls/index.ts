/*
Copyright 2024 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You May obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * VoIP Calls Manager - VoIP通话管理
 * 
 * 提供VoIP通话相关功能
 */

import { MatrixClient } from "../client";
import { MatrixCall } from "../webrtc/call";

export class VoIPCallsManager {
    constructor(private client: MatrixClient) {}

    public createCall(roomId: string): MatrixCall | null {
        return (this.client as unknown as {
            createCall: (roomId: string) => MatrixCall | null;
        }).createCall(roomId);
    }

    public setSupportsCallTransfer(support: boolean): void {
        (this.client as unknown as {
            setSupportsCallTransfer: (support: boolean) => void;
        }).setSupportsCallTransfer(support);
    }

    public getCall(roomId: string): MatrixCall | null {
        return (this.client as unknown as {
            getCall: (roomId: string) => MatrixCall | null;
        }).getCall(roomId);
    }

    public getAllCalls(): MatrixCall[] {
        return (this.client as unknown as {
            getAllCalls: () => MatrixCall[];
        }).getAllCalls();
    }

    public getCallsForRoom(roomId: string): MatrixCall[] {
        return (this.client as unknown as {
            getCallsForRoom: (roomId: string) => MatrixCall[];
        }).getCallsForRoom(roomId);
    }

    public async terminateAllCalls(): Promise<void> {
        return (this.client as unknown as {
            terminateAllCalls: () => Promise<void>;
        }).terminateAllCalls();
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getVoIPCallsManager(): VoIPCallsManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getVoIPCallsManager = function (): VoIPCallsManager {
        return new VoIPCallsManager(this);
    };
}

export default extendMatrixClient;
