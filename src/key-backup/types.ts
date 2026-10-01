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
 * Key Backup Types - Extended types with index signatures
 *
 * This module provides extended versions of key-backup related types
 * that include index signatures for flexible property access.
 */

import type { RoomSessions, RecoverKeysResult, RecoverRoomKeysResult, RecoverSessionKeyResult } from "./index";

/**
 * Key-backup types extended with an index signature (`[key: string]: unknown`).
 *
 * These variants are useful when you need to pass recovery results through
 * generic pipelines (e.g. JSON schema validators, dynamic property access)
 * that require an open-ended index signature on the object.
 */

/**
 * Extended {@link RecoverKeysResult} with an index signature.
 */
export interface RecoverKeysResultWithIndex extends RecoverKeysResult {
    [key: string]: unknown;
}

/**
 * Extended {@link RecoverRoomKeysResult} with an index signature.
 */
export interface RecoverRoomKeysResultWithIndex extends RecoverRoomKeysResult {
    [key: string]: unknown;
}

/**
 * Extended {@link RecoverSessionKeyResult} with an index signature.
 */
export interface RecoverSessionKeyResultWithIndex extends RecoverSessionKeyResult {
    [key: string]: unknown;
}

/**
 * Base recovery result with an index signature.
 */
export interface RecoveryResultBase {
    [key: string]: unknown;
}

/**
 * Extended {@link RoomSessions} with an index signature.
 */
export interface RoomSessionsWithIndex extends RoomSessions {
    [key: string]: unknown;
}

/**
 * Extended {@link SessionData} with an index signature.
 * Note: SessionData must be imported with an alias due to naming conflict.
 */
import type { SessionData as SessionDataType } from "./index";

/**
 * Extended SessionData with an index signature.
 */
export interface SessionDataWithIndex extends SessionDataType {
    [key: string]: unknown;
}
