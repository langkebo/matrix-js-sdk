import type { IContextResponse, INotificationsResponse } from "./@types/requests";
import type { IMessagesResponse } from "./client-internal-types";
import { Direction } from "./models/event-timeline";
import type { IEvent, MatrixEvent } from "./models/event";

export type NormalizedContextResponse = IContextResponse & Omit<Required<IContextResponse>, "start" | "end">;

export interface PaginationRequestHolder {
    paginationRequests: Record<Direction, Promise<boolean> | null>;
}

export interface TimelineUnknownStateTarget {
    setUnknownStateEvents(events: MatrixEvent[]): void;
}

export interface TimelineStateHolder {
    getState(dir: Direction): TimelineUnknownStateTarget | null | undefined;
}

export interface PaginationTokenHolder {
    setPaginationToken(token: string | null, dir: Direction): void;
}

export interface PaginateWithRequestParams {
    eventTimeline: PaginationRequestHolder & TimelineStateHolder & PaginationTokenHolder;
    dir: Direction;
    request: Promise<IMessagesResponse>;
    mapper: (e: Partial<IEvent>) => MatrixEvent;
    isSafe: (e: Partial<IEvent>) => boolean;
    onSuccess: (res: IMessagesResponse, matrixEvents: MatrixEvent[]) => void;
}

export function normalizeEventContextResponse(res: IContextResponse): NormalizedContextResponse {
    if (!res.event) {
        throw new Error("'event' not in '/context' result - homeserver too old?");
    }

    return {
        start: res.start,
        end: res.end,
        event: res.event,
        events_after: res.events_after ?? [],
        events_before: res.events_before ?? [],
        state: res.state ?? [],
    };
}

export function trackPaginationRequest(
    holder: PaginationRequestHolder,
    dir: Direction,
    request: Promise<boolean>,
): Promise<boolean> {
    const wrapped = request.finally(() => {
        holder.paginationRequests[dir] = null;
    });
    holder.paginationRequests[dir] = wrapped;
    return wrapped;
}

export function mapSafeEvents<TIn, TOut>(events: TIn[], isSafe: (e: TIn) => boolean, mapper: (e: TIn) => TOut): TOut[] {
    return events.filter(isSafe).map(mapper);
}

export function applyUnknownStateEvents<TStateEvent>(
    holder: TimelineStateHolder,
    dir: Direction,
    stateEvents: TStateEvent[] | undefined,
    isSafe: (e: TStateEvent) => boolean,
    mapper: (e: TStateEvent) => MatrixEvent,
): void {
    if (!stateEvents) return;
    const state = holder.getState(dir);
    if (!state) return;
    state.setUnknownStateEvents(mapSafeEvents(stateEvents, isSafe, mapper));
}

export function stopBackPaginationIfNeeded(
    holder: PaginationTokenHolder,
    dir: Direction,
    backwards: boolean,
    atEnd: boolean,
): void {
    if (backwards && atEnd) {
        holder.setPaginationToken(null, dir);
    }
}

export function paginateTimelineWithRequest({
    eventTimeline,
    dir,
    request,
    mapper,
    isSafe,
    onSuccess,
}: PaginateWithRequestParams): Promise<boolean> {
    const backwards = dir === Direction.Backward;

    return trackPaginationRequest(
        eventTimeline,
        dir,
        request.then((res) => {
            applyUnknownStateEvents(eventTimeline, dir, res.state, isSafe, mapper);

            const matrixEvents = mapSafeEvents(res.chunk, isSafe, mapper);

            onSuccess(res, matrixEvents);

            const atEnd = backwards
                ? deriveBackPaginationTokenFromMessages(res) === null
                : res.end === undefined || res.end === res.start;
            stopBackPaginationIfNeeded(eventTimeline, dir, backwards, atEnd);
            return !atEnd;
        }),
    );
}

export interface PaginateNotificationsParams {
    eventTimeline: PaginationRequestHolder & PaginationTokenHolder;
    dir: Direction;
    backwards: boolean;
    request: Promise<INotificationsResponse>;
    onSuccess: (res: INotificationsResponse) => string | null | undefined;
}

export function paginateNotificationsWithRequest({
    eventTimeline,
    dir,
    backwards,
    request,
    onSuccess,
}: PaginateNotificationsParams): Promise<boolean> {
    return trackPaginationRequest(
        eventTimeline,
        dir,
        request.then((res) => {
            const nextToken = onSuccess(res) ?? null;
            stopBackPaginationIfNeeded(eventTimeline, dir, backwards, !nextToken);
            return Boolean(nextToken);
        }),
    );
}

export function mapStateAndChunkFromMessages<TEvent>(
    res: { chunk: TEvent[]; state?: TEvent[] },
    isSafe: (e: TEvent) => boolean,
    mapper: (e: TEvent) => MatrixEvent,
): { matrixEvents: MatrixEvent[]; stateEvents: MatrixEvent[] } {
    const stateEvents = res.state ? mapSafeEvents(res.state, isSafe, mapper) : [];
    const matrixEvents = mapSafeEvents(res.chunk, isSafe, mapper);
    return { matrixEvents, stateEvents };
}

export function deriveBackPaginationTokenFromMessages(
    res: Pick<IMessagesResponse, "start" | "end" | "chunk">,
): string | null {
    if (res.end === undefined || res.end === res.start || res.chunk.length === 0) {
        return null;
    }
    return res.end ?? null;
}
