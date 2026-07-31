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
 * DirectMessage 事件定义
 *
 * 提取到独立文件以便 sub-managers 导入而不产生循环依赖。
 */

export enum DMEvent {
    DMCreated = "DMCreated",
    DMLeft = "DMLeft",
    DMUpdated = "DMUpdated",
    ListUpdated = "ListUpdated",
}

export interface DirectMessageManagerEventMap {
    [DMEvent.DMCreated]: (roomId: string, userIds: string[]) => void;
    [DMEvent.DMLeft]: (roomId: string) => void;
    [DMEvent.DMUpdated]: (roomId: string) => void;
    [DMEvent.ListUpdated]: () => void;
}
