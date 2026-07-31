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
 * Space 事件定义
 *
 * 提取到独立文件以便 sub-managers 导入而不产生循环依赖。
 */

import type { Space } from "./types";

export enum SpaceEvent {
    SpaceCreated = "SpaceCreated",
    SpaceUpdated = "SpaceUpdated",
    SpaceDeleted = "SpaceDeleted",
    ChildAdded = "ChildAdded",
    ChildRemoved = "ChildRemoved",
    MemberJoined = "MemberJoined",
    MemberLeft = "MemberLeft",
    SpaceError = "SpaceError",
}

export interface SpaceManagerEventMap {
    [SpaceEvent.SpaceCreated]: (space: Space) => void;
    [SpaceEvent.SpaceUpdated]: (space: Space) => void;
    [SpaceEvent.SpaceDeleted]: (spaceId: string) => void;
    [SpaceEvent.ChildAdded]: (spaceId: string, roomId: string) => void;
    [SpaceEvent.ChildRemoved]: (spaceId: string, roomId: string) => void;
    [SpaceEvent.MemberJoined]: (spaceId: string, userId: string) => void;
    [SpaceEvent.MemberLeft]: (spaceId: string, userId: string) => void;
    [SpaceEvent.SpaceError]: (error: Error) => void;
}
