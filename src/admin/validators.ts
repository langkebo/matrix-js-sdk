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

import { ValidationError } from "../errors";
import { validateUserId, validateRoomId, validateLimit } from "../common/validators";

// Re-export shared validators so existing admin callers don't break
export { validateUserId, validateRoomId, validateLimit };

/**
 * Admin-specific validators.
 *
 * Shared validators ({@link validateUserId}, {@link validateRoomId},
 * {@link validateLimit}) are re-exported from this module for convenience.
 * Non-admin code should import directly from `../common/validators`.
 */
export class AdminValidators {
    private static readonly ROOM_ID_REGEX = /^![a-z0-9._=-]+:[a-z0-9.-]+$/i;

    static validateUserId = validateUserId;
    static validateRoomId = validateRoomId;
    static validateLimit = validateLimit;

    static validateSpaceId(spaceId: string): void {
        if (!spaceId || typeof spaceId !== "string") {
            throw new ValidationError("Space ID must be a non-empty string");
        }
        if (!this.ROOM_ID_REGEX.test(spaceId)) {
            throw new ValidationError(`Invalid space ID format: ${spaceId}. Expected format: !localpart:homeserver`);
        }
    }

    static validateServerName(serverName: string): void {
        if (!serverName || typeof serverName !== "string") {
            throw new ValidationError("Server name must be a non-empty string");
        }
        if (!/^[a-z0-9.-]+$/i.test(serverName)) {
            throw new ValidationError(`Invalid server name format: ${serverName}`);
        }
    }
}
