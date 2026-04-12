/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { IContent } from "./models/event.ts";
import type { MatrixEvent } from "./models/event.ts";

interface ThreadLike {
    lastReply(predicate: (ev: MatrixEvent) => boolean): MatrixEvent | null | undefined;
}

export function applyThreadRelationIfNeeded(
    content: IContent,
    threadId: string | null,
    relationTypeName: string,
    getThread: (threadId: string) => ThreadLike | undefined,
): void {
    if (!threadId || content["m.relates_to"]?.rel_type) {
        return;
    }

    const isReply = !!content["m.relates_to"]?.["m.in_reply_to"];
    content["m.relates_to"] = {
        ...content["m.relates_to"],
        rel_type: relationTypeName,
        event_id: threadId,
        // Set is_falling_back to true unless this is actually intended to be a reply
        is_falling_back: !isReply,
    };

    const thread = getThread(threadId);
    if (thread && !isReply) {
        content["m.relates_to"]["m.in_reply_to"] = {
            event_id:
                thread
                    .lastReply((ev: MatrixEvent) => {
                        return ev.isRelation(relationTypeName) && !ev.status;
                    })
                    ?.getId() ?? threadId,
        };
    }
}
