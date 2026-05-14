import { MAIN_ROOM_TIMELINE } from "./@types/read_receipts";
import { THREAD_RELATION_TYPE } from "./models/thread";
import { MatrixEvent } from "./models/event";
import { logger } from "./logger";
import { NotificationCountType } from "./models/room";
import type { MatrixClient } from "./client";

/**
 * recalculates an accurate notifications count on event decryption.
 * Servers do not have enough knowledge about encrypted events to calculate an
 * accurate notification_count
 */
export function fixNotificationCountOnDecryption(cli: MatrixClient, event: MatrixEvent): void {
    const ourUserId = cli.getUserId();
    const eventId = event.getId();

    const room = cli.getRoom(event.getRoomId());
    if (!room || !ourUserId || !eventId) return;

    // Due to threads, we can get relation events (eg. edits & reactions) that never get
    // added to a timeline and so cannot be found in their own room (their edit / reaction
    // still applies to the event it needs to, so it doesn't matter too much). However, if
    // we try to process notification about this event, we'll get very confused because we
    // won't be able to find the event in the room, so will assume it must be unread, even
    // if it's actually read. We therefore skip anything that isn't in the room. This isn't
    // *great*, so if we can fix the homeless events (eg. with MSC4023) then we should probably
    // remove this workaround.
    if (!room.findEventById(eventId)) {
        logger.info(`Decrypted event ${event.getId()} is not in room ${room.roomId}: ignoring`);
        return;
    }

    const isThreadEvent = !!event.threadRootId && !event.isThreadRoot;

    let hasReadEvent;
    if (isThreadEvent) {
        const thread = room.getThread(event.threadRootId);
        hasReadEvent = thread
            ? thread.hasUserReadEvent(ourUserId, eventId)
            : // If the thread object does not exist in the room yet, we don't
              // want to calculate notification for this event yet. We have not
              // restored the read receipts yet and can't accurately calculate
              // notifications at this stage.
              //
              // This issue can likely go away when MSC3874 is implemented
              true;
    } else {
        hasReadEvent = room.hasUserReadEvent(ourUserId, eventId);
    }

    if (hasReadEvent) {
        // If the event has been read, ignore it.
        return;
    }

    const actions = cli.getPushActionsForEvent(event, true);

    // Ensure the unread counts are kept up to date if the event is encrypted
    // We also want to make sure that the notification count goes up if we already
    // have encrypted events to avoid other code from resetting 'highlight' to zero.
    const newHighlight = !!actions?.tweaks?.highlight;

    if (newHighlight) {
        // Known limitation: mentions received while the client is offline are not yet reconciled.
        // See also https://github.com/vector-im/element-web/issues/9069
        const newCount = room.getUnreadCountForEventContext(NotificationCountType.Highlight, event) + 1;
        if (isThreadEvent) {
            room.setThreadUnreadNotificationCount(event.threadRootId, NotificationCountType.Highlight, newCount);
        } else {
            room.setUnreadNotificationCount(NotificationCountType.Highlight, newCount);
        }
    }

    // `notify` is used in practice for incrementing the total count
    const newNotify = !!actions?.notify;

    // The room total count is NEVER incremented by the server for encrypted rooms. We basically ignore
    // the server here as it's always going to tell us to increment for encrypted events.
    if (newNotify) {
        // Total count is used to typically increment a room notification counter, but not loudly highlight it.
        const newCount = room.getUnreadCountForEventContext(NotificationCountType.Total, event) + 1;
        if (isThreadEvent) {
            room.setThreadUnreadNotificationCount(event.threadRootId, NotificationCountType.Total, newCount);
        } else {
            room.setUnreadNotificationCount(NotificationCountType.Total, newCount);
        }
    }
}

/**
 * Given an event, figure out the thread ID we should use for it in a receipt.
 *
 * This will either be "main", or event.threadRootId. For the thread root, or
 * e.g. reactions to the thread root, this will be main. For events inside the
 * thread, or e.g. reactions to them, this will be event.threadRootId.
 *
 * (Exported for test.)
 */
export function threadIdForReceipt(event: MatrixEvent): string {
    return inMainTimelineForReceipt(event) ? MAIN_ROOM_TIMELINE : event.threadRootId!;
}

/**
 * a) True for non-threaded messages, thread roots and non-thread relations to thread roots.
 * b) False for messages with thread relations to the thread root.
 * c) False for messages with any kind of relation to a message from case b.
 *
 * Note: true for redactions of messages that are in threads. Redacted messages
 * are not really in threads (because their relations are gone), so if they look
 * like they are in threads, that is a sign of a bug elsewhere. (At time of
 * writing, this bug definitely exists - messages are not moved to another
 * thread when they are redacted.)
 *
 * @returns true if this event is considered to be in the main timeline as far
 *               as receipts are concerned.
 */
export function inMainTimelineForReceipt(event: MatrixEvent): boolean {
    if (!event.threadRootId) {
        // Not in a thread: then it is in the main timeline
        return true;
    }

    if (event.isThreadRoot) {
        // Thread roots are in the main timeline. Note: the spec is ambiguous (or
        // wrong) on this - see
        // https://github.com/matrix-org/matrix-spec-proposals/pull/4037
        return true;
    }

    if (!event.isRelation()) {
        // If it's not related to anything, it can't be related via a chain of
        // relations to a thread root.
        //
        // Note: this is a bug, because how does it have a threadRootId if it is
        // neither a thread root, nor related to one?
        logger.warn(`Event is not a relation or a thread root, but still has a threadRootId! id=${event.getId()}`);
        return true;
    }

    if (event.isRelation(THREAD_RELATION_TYPE.name)) {
        // It's a message in a thread - definitely not in the main timeline.
        return false;
    }

    const isRelatedToRoot = event.relationEventId === event.threadRootId;

    // If it's related to the thread root (and we already know it's not a thread
    // relation) then it's in the main timeline. If it's related to something
    // else, then it's in the thread (because it has a thread ID).
    return isRelatedToRoot;
}
