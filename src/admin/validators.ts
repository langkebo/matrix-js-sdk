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
import { InvalidParamError } from "../common/errors";

/**
 * Validators for Admin API inputs
 *
 * Provides format validation for user IDs, room IDs, and other identifiers
 * to prevent injection attacks and ensure data integrity.
 */
export class AdminValidators {
    /**
     * Matrix User ID format: @localpart:homeserver
     * - localpart: lowercase letters, digits, dots, underscores, equals, hyphens
     * - homeserver: domain name format
     */
    private static readonly USER_ID_REGEX = /^@[a-z0-9._=-]+:[a-z0-9.-]+$/i;

    /**
     * Matrix Room ID format: !localpart:homeserver
     * - localpart: alphanumeric and special characters
     * - homeserver: domain name format
     */
    private static readonly ROOM_ID_REGEX = /^![a-z0-9._=-]+:[a-z0-9.-]+$/i;

    /**
     * Validate Matrix user ID format
     *
     * @param userId - User ID to validate
     * @throws {ValidationError} If user ID is invalid
     *
     * @example
     * ```typescript
     * AdminValidators.validateUserId("@alice:example.com"); // OK
     * AdminValidators.validateUserId("invalid"); // throws ValidationError
     * ```
     */
    static validateUserId(userId: string): void {
        if (!userId || typeof userId !== "string") {
            throw new InvalidParamError("User ID must be a non-empty string");
        }

        if (!this.USER_ID_REGEX.test(userId)) {
            throw new ValidationError(`Invalid user ID format: ${userId}. Expected format: @localpart:homeserver`);
        }
    }

    /**
     * Validate Matrix room ID format
     *
     * @param roomId - Room ID to validate
     * @throws {ValidationError} If room ID is invalid
     *
     * @example
     * ```typescript
     * AdminValidators.validateRoomId("!abc123:example.com"); // OK
     * AdminValidators.validateRoomId("invalid"); // throws ValidationError
     * ```
     */
    static validateRoomId(roomId: string): void {
        if (!roomId || typeof roomId !== "string") {
            throw new ValidationError("Room ID must be a non-empty string");
        }

        if (!this.ROOM_ID_REGEX.test(roomId)) {
            throw new ValidationError(`Invalid room ID format: ${roomId}. Expected format: !localpart:homeserver`);
        }
    }

    /**
     * Validate space ID format (same as room ID)
     *
     * @param spaceId - Space ID to validate
     * @throws {ValidationError} If space ID is invalid
     */
    static validateSpaceId(spaceId: string): void {
        if (!spaceId || typeof spaceId !== "string") {
            throw new ValidationError("Space ID must be a non-empty string");
        }

        if (!this.ROOM_ID_REGEX.test(spaceId)) {
            throw new ValidationError(`Invalid space ID format: ${spaceId}. Expected format: !localpart:homeserver`);
        }
    }

    /**
     * Validate server name format
     *
     * @param serverName - Server name to validate
     * @throws {ValidationError} If server name is invalid
     */
    static validateServerName(serverName: string): void {
        if (!serverName || typeof serverName !== "string") {
            throw new ValidationError("Server name must be a non-empty string");
        }

        // Basic domain name validation
        if (!/^[a-z0-9.-]+$/i.test(serverName)) {
            throw new ValidationError(`Invalid server name format: ${serverName}`);
        }
    }

    /**
     * Validate pagination limit
     *
     * @param limit - Limit value to validate
     * @throws {ValidationError} If limit is invalid
     */
    static validateLimit(limit: number): void {
        if (typeof limit !== "number" || !Number.isInteger(limit)) {
            throw new ValidationError("Limit must be an integer");
        }

        if (limit < 1) {
            throw new ValidationError("Limit must be greater than 0");
        }

        if (limit > 10000) {
            throw new ValidationError("Limit must not exceed 10000");
        }
    }
}
