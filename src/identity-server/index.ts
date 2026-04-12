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
 * Identity Server Manager - 身份服务器管理
 *
 * 提供身份服务器相关功能
 */

import { MatrixClient } from "../client.ts";
import { BaseManager } from "../managers/base-manager.ts";
import * as utils from "../utils.ts";

export type IdentityServerManagerEvents = Record<"identity_server_url_changed", (url: string | undefined) => void>;

export class IdentityServerManager extends BaseManager<keyof IdentityServerManagerEvents, IdentityServerManagerEvents> {
    constructor(client: MatrixClient) {
        super(client);
    }

    public getIdentityServerUrl(stripProto = false): string | undefined {
        const idBaseUrl = (this.client as unknown as { idBaseUrl?: string }).idBaseUrl;
        if (stripProto && (idBaseUrl?.startsWith("http://") || idBaseUrl?.startsWith("https://"))) {
            return idBaseUrl.split("://")[1];
        }
        return idBaseUrl;
    }

    public setIdentityServerUrl(url?: string): void {
        const clientInternals = this.client as unknown as {
            idBaseUrl?: string;
            http: { setIdBaseUrl: (url: string | undefined) => void };
        };
        clientInternals.idBaseUrl = utils.ensureNoTrailingSlash(url);
        clientInternals.http.setIdBaseUrl(clientInternals.idBaseUrl);
        this.emit("identity_server_url_changed", url);
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getIdentityServerManager(): IdentityServerManager;
    }
}

export function extendMatrixClient(): void {
    if (MatrixClient.prototype.hasOwnProperty("getIdentityServerManager")) return;

    MatrixClient.prototype.getIdentityServerManager = function (this: MatrixClient): IdentityServerManager {
        return new IdentityServerManager(this);
    };
}

export default extendMatrixClient;
