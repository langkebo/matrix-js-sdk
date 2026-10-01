/*
Copyright 2025 The Matrix.org Foundation C.I.C.

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

import type { Method } from "./method";
import type { Body, IRequestOpts } from "./index";
import type { QueryDict } from "../utils";

/**
 * Minimal transport interface for SyncApi HTTP access.
 * ISSUE-12: SyncApi should not directly access client.http — it should
 * depend on this narrow interface instead, making the network layer
 * replaceable for testing and future transport implementations.
 */
export interface ISyncTransport {
    authedRequest<T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: Body,
        requestOpts?: IRequestOpts,
    ): Promise<T>;
    request<T>(
        method: Method,
        path: string,
        queryParams?: QueryDict,
        body?: Body,
        requestOpts?: IRequestOpts,
    ): Promise<T>;
}
