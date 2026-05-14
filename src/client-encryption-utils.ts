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
 * Encryption Utils - 加密相关工具函数
 *
 * 从 client.ts 提取的加密相关私有方法
 */

import type { MatrixClient } from "./client";
import type { Room } from "./models/room";
import type { MatrixEvent } from "./models/event";
import type { CryptoBackend } from "./common-crypto/CryptoBackend";
import { EventType } from "./@types/event";
import { EventStatus } from "./models/event-status";

const STATE_EVENT_TYPES_EXCLUDED_FROM_ENCRYPTION = [
    "m.room.create",
    "m.room.member",
    "m.room.join_rules",
    "m.room.power_levels",
    "m.room.third_party_invite",
    "m.room.history_visibility",
    "m.room.guest_access",
    "m.room.encryption",
];

export interface EncryptionUtils {
    encryptEventIfNeeded(event: MatrixEvent, room?: Room): Promise<void>;
    encryptStateEventIfNeeded(event: MatrixEvent, room?: Room): Promise<void>;
    shouldEncryptEventForRoom(event: MatrixEvent, room: Room): Promise<boolean>;
    getEncryptedIfNeededEventType(
        roomId: string,
        eventType?: EventType | string | null,
    ): EventType | string | null | undefined;
    updatePendingEventStatus(room: Room | null, event: MatrixEvent, newStatus: EventStatus): void;
}

interface ClientInternals {
    cryptoBackend?: CryptoBackend;
    usingExternalCrypto: boolean;
    enableEncryptedStateEvents?: boolean;
}

export function createEncryptionUtils(client: MatrixClient): EncryptionUtils {
    const clientInternals = client as unknown as ClientInternals;

    return {
        async encryptEventIfNeeded(event: MatrixEvent, room?: Room): Promise<void> {
            if (!room) return;

            if (!(await this.shouldEncryptEventForRoom(event, room))) return;

            const cryptoBackend = clientInternals.cryptoBackend;
            const usingExternalCrypto = clientInternals.usingExternalCrypto;

            if (!cryptoBackend && usingExternalCrypto) {
                return;
            }

            if (!cryptoBackend) {
                throw new Error(
                    "This room is configured to use encryption, but your client does not support encryption.",
                );
            }

            this.updatePendingEventStatus(room, event, EventStatus.ENCRYPTING);
            await cryptoBackend.encryptEvent(event, room);
        },

        async encryptStateEventIfNeeded(event: MatrixEvent, room?: Room): Promise<void> {
            if (!clientInternals.enableEncryptedStateEvents) {
                return;
            }

            if (!room) return;

            const cryptoBackend = clientInternals.cryptoBackend;
            const usingExternalCrypto = clientInternals.usingExternalCrypto;

            if (!cryptoBackend && usingExternalCrypto) {
                return;
            }

            if (!cryptoBackend) {
                throw new Error(
                    "This room is configured to use encryption, but your client does not support encryption.",
                );
            }

            if (!(await this.shouldEncryptEventForRoom(event, room))) {
                return;
            }

            if (!(await cryptoBackend.isStateEncryptionEnabledInRoom(room.roomId))) {
                return;
            }

            if (STATE_EVENT_TYPES_EXCLUDED_FROM_ENCRYPTION.includes(event.getType())) {
                return;
            }

            await cryptoBackend.encryptEvent(event, room);
        },

        async shouldEncryptEventForRoom(event: MatrixEvent, room: Room): Promise<boolean> {
            if (event.isEncrypted()) {
                return false;
            }

            if (event.getType() === EventType.Reaction) {
                return false;
            }

            if (event.isRedaction()) {
                return false;
            }

            if (room.hasEncryptionStateEvent()) return true;

            const cryptoBackend = clientInternals.cryptoBackend;
            if (await cryptoBackend?.isEncryptionEnabledInRoom(room.roomId)) return true;

            return false;
        },

        getEncryptedIfNeededEventType(
            roomId: string,
            eventType?: EventType | string | null,
        ): EventType | string | null | undefined {
            if (eventType === EventType.Reaction) return eventType;
            const room = client.getRoom(roomId);
            return room?.hasEncryptionStateEvent() ? EventType.RoomMessageEncrypted : eventType;
        },

        updatePendingEventStatus(room: Room | null, event: MatrixEvent, newStatus: EventStatus): void {
            if (room) {
                room.updatePendingEvent(event, newStatus);
            } else {
                event.setStatus(newStatus);
            }
        },
    };
}
