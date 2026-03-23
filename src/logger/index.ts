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
 * Logger Manager - 日志管理
 * 
 * 提供日志相关功能
 */

import { MatrixClient } from "../client";

export class LoggerManager {
    constructor(private client: MatrixClient) {}

    /**
     * Get logger
     */
    public getLogger(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.client as any).logger;
    }

    /**
     * Set logger
     */
    public setLogger(logger: any): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).logger = logger;
    }

    /**
     * Log
     */
    public log(...args: any[]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).logger?.log(...args);
    }

    /**
     * Error
     */
    public error(...args: any[]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).logger?.error(...args);
    }

    /**
     * Warn
     */
    public warn(...args: any[]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).logger?.warn(...args);
    }

    /**
     * Info
     */
    public info(...args: any[]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).logger?.info(...args);
    }

    /**
     * Debug
     */
    public debug(...args: any[]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).logger?.debug(...args);
    }

    /**
     * Trace
     */
    public trace(...args: any[]): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).logger?.trace(...args);
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
