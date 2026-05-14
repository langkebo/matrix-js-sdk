import type { INotificationsResponse, IPaginateOpts, IRelationsResponse } from "./@types/requests";
import type { IMessagesResponse } from "./client-internal-types";
import { noUnsafeEventProps } from "./utils";
import { Direction, EventTimeline } from "./models/event-timeline";
import type { EventTimelineSet } from "./models/event-timeline-set";
import type { IEvent, MatrixEvent } from "./models/event";
import { type EventMapper } from "./event-mapper";
import type { Room } from "./models/room";
import { type Filter } from "./filter";
import { getRelationsThreadFilter } from "./thread-utils";
import { Thread } from "./models/thread";
import { type ThreadFilterType } from "./models/thread";
import { ReceiptType } from "./@types/read_receipts";
import {
    paginateNotificationsWithRequest,
    paginateTimelineWithRequest,
    stopBackPaginationIfNeeded,
    trackPaginationRequest,
} from "./client-timeline-core";

interface PaginationDeps {
    notifTimelineSet: EventTimelineSet | null;
    getRoom: (roomId: string) => Room | null;
    createMessagesRequest: (
        roomId: string,
        fromToken: string | null,
        limit: number | undefined,
        dir: Direction,
        timelineFilter?: Filter,
    ) => Promise<IMessagesResponse>;
    createThreadListMessagesRequest: (
        roomId: string,
        fromToken: string | null,
        limit: number | undefined,
        dir: Direction,
        threadListType: ThreadFilterType,
        timelineFilter?: Filter,
    ) => Promise<IMessagesResponse>;
    fetchRelations: (
        roomId: string,
        eventId: string,
        relationType: string | null,
        eventType: string | null,
        opts: { dir: Direction; limit?: number; from?: string; recurse?: boolean },
    ) => Promise<IRelationsResponse>;
    fetchRoomEvent: (roomId: string, eventId: string) => Promise<Partial<IEvent>>;
    getEventMapper: () => EventMapper;
    getPushDetailsForEvent: (event: MatrixEvent, forceRecalculate: boolean) => void;
    processPaginationEvents: (
        eventTimeline: EventTimeline,
        events: MatrixEvent[],
        backwards: boolean,
        token: string | null,
        room: Room | undefined,
        options?: { partitionThreads?: boolean; processThreadRoots?: boolean },
    ) => void;
    requestNotifications: (params: Record<string, string>) => Promise<INotificationsResponse>;
    canSupportRelationsRecursion: boolean;
}

export function paginateEventTimelineRequest(
    eventTimeline: EventTimeline,
    opts: IPaginateOpts,
    deps: PaginationDeps,
): Promise<boolean> {
    const isNotifTimeline = eventTimeline.getTimelineSet() === deps.notifTimelineSet;
    const room = deps.getRoom(eventTimeline.getRoomId()!);
    const threadListType = eventTimeline.getTimelineSet().threadListType;
    const thread = eventTimeline.getTimelineSet().thread;

    const backwards = opts?.backwards || false;

    if (isNotifTimeline && !backwards) {
        throw new Error("paginateNotifTimeline can only paginate backwards");
    }

    const dir = backwards ? EventTimeline.BACKWARDS : EventTimeline.FORWARDS;
    const token = eventTimeline.getPaginationToken(dir);
    const pendingRequest = eventTimeline.paginationRequests[dir];

    if (pendingRequest) {
        return pendingRequest;
    }

    if (isNotifTimeline) {
        const params: Record<string, string> = {
            limit: (opts.limit ?? 30).toString(),
            only: "highlight",
        };

        if (token && token !== "end") {
            params.from = token;
        }

        return paginateNotificationsWithRequest({
            eventTimeline,
            dir,
            backwards,
            request: deps.requestNotifications(params),
            onSuccess: (res) => {
                const nextToken = res.next_token ?? null;
                const matrixEvents: MatrixEvent[] = [];
                res.notifications = res.notifications.filter(noUnsafeEventProps);
                for (let i = 0; i < res.notifications.length; i++) {
                    const notification = res.notifications[i];
                    const event = deps.getEventMapper()(notification.event);
                    deps.getPushDetailsForEvent(event, true);
                    event.event.room_id = notification.room_id;
                    matrixEvents[i] = event;
                }
                deps.processPaginationEvents(eventTimeline, matrixEvents, backwards, nextToken, room ?? undefined);
                return nextToken;
            },
        });
    }

    if (threadListType !== null) {
        if (!room) {
            throw new Error("Unknown room " + eventTimeline.getRoomId());
        }

        if (!Thread.hasServerSideFwdPaginationSupport && dir === Direction.Forward) {
            throw new Error("Cannot paginate threads forwards without server-side support for MSC 3715");
        }

        return paginateTimelineWithRequest({
            eventTimeline,
            dir,
            request: deps.createThreadListMessagesRequest(
                eventTimeline.getRoomId()!,
                token,
                opts.limit,
                dir,
                threadListType,
                eventTimeline.getFilter(),
            ),
            mapper: deps.getEventMapper(),
            isSafe: noUnsafeEventProps,
            onSuccess: (res, matrixEvents) => {
                deps.processPaginationEvents(eventTimeline, matrixEvents, backwards, res.end ?? null, room, {
                    processThreadRoots: true,
                });
            },
        });
    }

    if (thread) {
        if (!room) {
            throw new Error("Unknown room " + eventTimeline.getRoomId());
        }

        return trackPaginationRequest(
            eventTimeline,
            dir,
            deps
                .fetchRelations(eventTimeline.getRoomId() ?? "", thread.id, null, null, {
                    dir,
                    limit: opts.limit,
                    from: token ?? undefined,
                    recurse: deps.canSupportRelationsRecursion || undefined,
                })
                .then(async (res) => {
                    const mapper = deps.getEventMapper();
                    const matrixEvents = res.chunk
                        .filter(noUnsafeEventProps)
                        .filter(getRelationsThreadFilter(thread.id))
                        .map(mapper);

                    for (const event of matrixEvents.slice().reverse()) {
                        await thread.processEvent(event);
                        const sender = event.getSender()!;
                        if (!backwards || thread.getEventReadUpTo(sender) === null) {
                            room.addLocalEchoReceipt(sender, event, ReceiptType.Read);
                        }
                    }

                    const nextToken = res.next_batch ?? null;
                    deps.processPaginationEvents(eventTimeline, matrixEvents, backwards, nextToken, room);

                    if (!nextToken && backwards) {
                        const originalEvent =
                            thread.rootEvent ??
                            mapper(await deps.fetchRoomEvent(eventTimeline.getRoomId() ?? "", thread.id));
                        eventTimeline
                            .getTimelineSet()
                            .addEventsToTimeline([originalEvent], true, false, eventTimeline, null);
                    }

                    stopBackPaginationIfNeeded(eventTimeline, dir, backwards, !nextToken);
                    return Boolean(nextToken);
                }),
        );
    }

    if (!room) {
        throw new Error("Unknown room " + eventTimeline.getRoomId());
    }

    return paginateTimelineWithRequest({
        eventTimeline,
        dir,
        request: deps.createMessagesRequest(
            eventTimeline.getRoomId()!,
            token,
            opts.limit,
            dir,
            eventTimeline.getFilter(),
        ),
        mapper: deps.getEventMapper(),
        isSafe: noUnsafeEventProps,
        onSuccess: (res, matrixEvents) => {
            deps.processPaginationEvents(eventTimeline, matrixEvents, backwards, res.end ?? null, room, {
                partitionThreads: true,
                processThreadRoots: true,
            });
        },
    });
}
