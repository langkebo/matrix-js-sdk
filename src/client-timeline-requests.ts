import { Filter } from "./filter";
import type { IRoomEventFilter } from "./filter";
import { Direction } from "./models/event-timeline";
import * as utils from "./utils";

export function buildMessagesRequestPath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/messages", { $roomId: roomId });
}

export function buildThreadListRequestPath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/threads", { $roomId: roomId });
}

export function buildEventContextPath(roomId: string, eventId: string): string {
    return utils.encodeUri("/rooms/$roomId/context/$eventId", {
        $roomId: roomId,
        $eventId: eventId,
    });
}

export function buildEventContextParams(lazyLoadMembers: boolean): Record<string, string | string[]> {
    const params: Record<string, string | string[]> = {
        limit: "0",
    };
    if (lazyLoadMembers) {
        params.filter = JSON.stringify(Filter.LAZY_LOADING_MESSAGES_FILTER);
    }
    return params;
}

/**
 * Default number of events requested for `/messages` pagination when the caller
 * does not specify a limit.
 *
 * Note this applies to the `/messages` endpoint only - the `/notifications`
 * pagination path keeps its own default (see `paginateEventTimelineRequest`), as
 * the two endpoints are independent and should be free to diverge.
 */
export const DEFAULT_MESSAGES_LIMIT = 30;

export function buildMessagesRequestParams({
    fromToken,
    limit,
    dir,
    lazyLoadMembers,
    timelineFilter,
}: {
    fromToken: string | null;
    limit?: number | undefined;
    dir: Direction;
    lazyLoadMembers: boolean;
    timelineFilter?: IRoomEventFilter;
}): Record<string, string> {
    const params: Record<string, string> = { dir };

    // `limit` is optional on purpose: omitting it lets the homeserver apply its own
    // default. Callers with no limit preference must not be forced to send one.
    if (limit !== undefined) {
        params.limit = limit.toString();
    }

    if (fromToken) {
        params.from = fromToken;
    }

    let filter: IRoomEventFilter | null = null;
    if (lazyLoadMembers) {
        // create a shallow copy of LAZY_LOADING_MESSAGES_FILTER
        filter = Object.assign({}, Filter.LAZY_LOADING_MESSAGES_FILTER);
    }

    if (timelineFilter) {
        filter = filter || {};
        Object.assign(filter, timelineFilter);
    }

    if (filter) {
        params.filter = JSON.stringify(filter);
    }

    return params;
}

export function buildThreadListRequestParams({
    fromToken,
    limit,
    dir,
    include,
    lazyLoadMembers,
    timelineFilter,
}: {
    fromToken: string | null;
    limit: number;
    dir: Direction;
    include: string;
    lazyLoadMembers: boolean;
    timelineFilter?: IRoomEventFilter;
}): Record<string, string> {
    const params: Record<string, string> = {
        limit: limit.toString(),
        dir,
        include,
    };

    if (fromToken) {
        params.from = fromToken;
    }

    let filter: IRoomEventFilter = {};
    if (lazyLoadMembers) {
        filter = {
            ...Filter.LAZY_LOADING_MESSAGES_FILTER,
        };
    }
    if (timelineFilter) {
        filter = {
            ...filter,
            ...timelineFilter,
        };
    }
    if (Object.keys(filter).length) {
        params.filter = JSON.stringify(filter);
    }

    return params;
}
