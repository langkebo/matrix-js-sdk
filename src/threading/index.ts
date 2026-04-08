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

import { MatrixClient } from "../client";
import { Thread } from "../models/thread";

export class ThreadingManager {
    constructor(private client: MatrixClient) {}

    public getThread(threadId: string): Thread | null {
        const rooms = this.client.getRooms();
        for (const room of rooms) {
            const thread = room.getThread?.(threadId);
            if (thread) return thread;
        }
        return null;
    }

    public getThreadList(): Thread[] {
        const threads: Thread[] = [];
        const rooms = this.client.getRooms();
        for (const room of rooms) {
            const roomThreads = room.getThreads?.() || [];
            threads.push(...roomThreads);
        }
        return threads;
    }

    public getThreads(): Thread[] {
        return this.getThreadList();
    }

    public hasThread(threadId: string): boolean {
        return this.getThread(threadId) !== null;
    }

    public async createThread(roomId: string, eventId: string): Promise<Thread | null> {
        const room = this.client.getRoom(roomId);
        if (!room) return null;
        
        const event = room.findEventById(eventId);
        if (!event) return null;
        
        return room.createThread?.(eventId, event, [], false) || null;
    }
}

declare module "../client.ts" {
    interface MatrixClient {
        getThreadingManager(): ThreadingManager;
    }
}

export function extendMatrixClient(): void {
    MatrixClient.prototype.getThreadingManager = function (): ThreadingManager {
        return new ThreadingManager(this);
    };
}

export default extendMatrixClient;
