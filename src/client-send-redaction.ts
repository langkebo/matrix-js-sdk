/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { IRedactOpts } from "./@types/requests";
import { ServerSupport } from "./feature";
import type { IContent } from "./models/event";

interface RelationPropertyNames {
    stable?: string | null;
    unstable?: string | null;
}

export interface BuildRedactEventContentArgs {
    opts?: IRedactOpts;
    relationBasedRedactionsSupport?: ServerSupport;
    relationPropertyNames: RelationPropertyNames;
    roomId: string;
    eventId: string;
    txnId?: string;
    threadId: string | null;
}

export function buildRedactEventContent({
    opts,
    relationBasedRedactionsSupport,
    relationPropertyNames,
    roomId,
    eventId,
    txnId,
    threadId,
}: BuildRedactEventContentArgs): IContent {
    const reason = opts?.reason;
    const content: IContent = { reason };
    const resolvedSupport = relationBasedRedactionsSupport ?? ServerSupport.Unsupported;

    if (opts?.with_rel_types === undefined) {
        return content;
    }

    if (resolvedSupport === ServerSupport.Unsupported) {
        throw new Error(
            "Server does not support relation based redactions " +
                `roomId ${roomId} eventId ${eventId} txnId: ${txnId as string} threadId ${threadId}`,
        );
    }

    const withRelTypesPropName =
        resolvedSupport === ServerSupport.Stable ? relationPropertyNames.stable! : relationPropertyNames.unstable!;

    content[withRelTypesPropName] = opts.with_rel_types;
    return content;
}
