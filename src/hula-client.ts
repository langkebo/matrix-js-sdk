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

import { createClient } from "./matrix";
import { type ICreateClientOpts, type MatrixClient } from "./client";
import { makeTextMessage } from "./content-helpers";
import { type MatrixEvent } from "./models/event";
import { RoomEvent } from "./models/room";

/**
 * Simplified HuLa client for 3-line integration.
 *
 * ISSUE-14: A 30-minute quickstart requires a dead-simple API that hides the
 * full {@link MatrixClient} surface behind the handful of methods most
 * applications need: log in, receive messages, send text, and manage the
 * sync lifecycle.
 *
 * @example
 * ```typescript
 * const hula = new HuLaClient("https://matrix.example.com");
 * await hula.login("alice", "password123");
 * hula.onMessage((roomId, event) => {
 *     console.log(`New message in ${roomId}: ${event.getContent().body}`);
 * });
 * await hula.start();
 * await hula.sendText("!room:example.com", "Hello world!");
 * ```
 */
export class HuLaClient {
    private client: MatrixClient;

    /**
     * @param homeserverUrl - Base URL of the Matrix homeserver.
     * @param opts - Additional {@link ICreateClientOpts} passed through to the
     *   underlying {@link MatrixClient} (e.g. `accessToken`, `deviceId`).
     */
    public constructor(homeserverUrl: string, opts?: Partial<ICreateClientOpts>) {
        this.client = createClient({
            baseUrl: homeserverUrl,
            ...opts,
        });
    }

    /**
     * Login with a username and password.
     *
     * On success the underlying client's access token and user id are populated,
     * so {@link HuLaClient.start} / {@link HuLaClient.sendText} can be used
     * immediately afterwards.
     *
     * @param username - The localpart or full user id to log in as.
     * @param password - The account password.
     */
    public async login(username: string, password: string): Promise<void> {
        await this.client.getAccountManager().login("m.login.password", {
            user: username,
            password,
        });
    }

    /**
     * Register a callback for incoming timeline messages.
     *
     * The callback is invoked for each non-removed event emitted on
     * {@link RoomEvent.Timeline}. Removals (e.g. redactions of local echo) are
     * filtered out so the callback only fires for newly arrived events.
     *
     * @param callback - Invoked with the room id and the received event.
     */
    public onMessage(callback: (roomId: string, event: MatrixEvent) => void): void {
        this.client.on(RoomEvent.Timeline, (event, room, _toStartOfTimeline, removed) => {
            if (removed) {
                return;
            }
            const roomId = room?.roomId ?? event.getRoomId() ?? "";
            callback(roomId, event);
        });
    }

    /**
     * Send a text message to a room.
     *
     * @param roomId - The id of the target room.
     * @param text - The plaintext body to send.
     * @returns The id of the newly created event.
     */
    public async sendText(roomId: string, text: string): Promise<string> {
        const response = await this.client.sendMessage(roomId, makeTextMessage(text));
        return response.event_id;
    }

    /**
     * Start syncing with the homeserver.
     *
     * Resolves once the client has begun syncing. Incoming messages registered
     * via {@link HuLaClient.onMessage} will be delivered after this resolves.
     */
    public async start(): Promise<void> {
        await this.client.startClient();
    }

    /**
     * Stop syncing and clean up the underlying client.
     */
    public stop(): void {
        this.client.stopClient();
    }
}
