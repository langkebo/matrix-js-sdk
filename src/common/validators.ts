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
import { InvalidParamError } from "./errors";

const USER_ID_REGEX = /^@[a-z0-9._=-]+:[a-z0-9.-]+$/i;
const ROOM_ID_REGEX = /^![a-z0-9._=-]+:[a-z0-9.-]+$/i;

export function validateUserId(userId: string): void {
    if (!userId || typeof userId !== "string") {
        throw new InvalidParamError("User ID must be a non-empty string");
    }
    if (!USER_ID_REGEX.test(userId)) {
        throw new ValidationError(`Invalid user ID format: ${userId}. Expected format: @localpart:homeserver`);
    }
}

export function validateRoomId(roomId: string): void {
    if (!roomId || typeof roomId !== "string") {
        throw new ValidationError("Room ID must be a non-empty string");
    }
    if (!ROOM_ID_REGEX.test(roomId)) {
        throw new ValidationError(`Invalid room ID format: ${roomId}. Expected format: !localpart:homeserver`);
    }
}

export function validateLimit(limit: number): void {
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
