import { EventType, RelationType } from "./@types/event.ts";
import type { MatrixEvent } from "./models/event.ts";

export interface ProcessRelationEventsParams {
    events: MatrixEvent[];
    originalEvent?: MatrixEvent;
    fetchedEventType: EventType | string | null | undefined;
    requestedEventType?: EventType | string | null;
    relationType: RelationType | string | null;
    decryptEventIfNeeded: (event: MatrixEvent) => Promise<void>;
}

export async function processRelationEvents({
    events,
    originalEvent,
    fetchedEventType,
    requestedEventType,
    relationType,
    decryptEventIfNeeded,
}: ProcessRelationEventsParams): Promise<MatrixEvent[]> {
    let processedEvents = events;
    if (fetchedEventType === EventType.RoomMessageEncrypted) {
        const allEvents = originalEvent ? processedEvents.concat(originalEvent) : processedEvents;
        await Promise.all(allEvents.map((event) => decryptEventIfNeeded(event)));
        if (requestedEventType !== null && requestedEventType !== undefined) {
            processedEvents = processedEvents.filter((event) => event.getType() === requestedEventType);
        }
    }
    if (originalEvent && relationType === RelationType.Replace) {
        processedEvents = processedEvents.filter((event) => event.getSender() === originalEvent.getSender());
    }
    return processedEvents;
}
