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
 * Logger Manager - 日志管理
 * 
 * 提供日志相关功能
 */

import { MatrixClient } from "../client";

export interface ILogger {
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    info(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    trace(...args: unknown[]): void;
}

export class LoggerManager {
    constructor(private client: MatrixClient) {}

    public getLogger(): ILogger | undefined {
        return (this.client as unknown as { logger?: ILogger }).logger;
    }

    public setLogger(logger: ILogger): void {
        (this.client as unknown as { logger?: ILogger }).logger = logger;
    }

    public log(...args: unknown[]): void {
        (this.client as unknown as { logger?: ILogger }).logger?.log(...args);
    }

    public error(...args: unknown[]): void {
        (this.client as unknown as { logger?: ILogger }).logger?.error(...args);
    }

    public warn(...args: unknown[]): void {
        (this.client as unknown as { logger?: ILogger }).logger?.warn(...args);
    }

    public info(...args: unknown[]): void {
        (this.client as unknown as { logger?: ILogger }).logger?.info(...args);
    }

    public debug(...args: unknown[]): void {
        (this.client as unknown as { logger?: ILogger }).logger?.debug(...args);
    }

    public trace(...args: unknown[]): void {
        (this.client as unknown as { logger?: ILogger }).logger?.trace(...args);
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        getLoggerManager(): LoggerManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getLoggerManager = function (): LoggerManager {
        return new LoggerManager(this);
    };
}

export default extendMatrixClient;
