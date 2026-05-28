import * as utils from "./utils";
import { Method } from "./http-api/index";
import type { Body, IRequestOpts } from "./http-api/index";
import type { QueryDict } from "./utils";
import type { EmptyObject } from "./@types/common";
import type { IContent } from "./models/event";

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

export function buildRoomUpgradePath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/upgrade", { $roomId: roomId });
}

export function buildRoomEventReportPath(roomId: string, eventId: string): string {
    return utils.encodeUri("/rooms/$roomId/report/$eventId", {
        $roomId: roomId,
        $eventId: eventId,
    });
}

export function buildRoomReportPath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/report", {
        $roomId: roomId,
    });
}

export function upgradeRoomRequest(
    roomId: string,
    newVersion: string,
    additionalCreators: string[] | undefined,
    authedRequest: AuthedRequestFn,
): Promise<{ replacement_room: string }> {
    const body: { new_version: string; additional_creators?: string[] } = {
        new_version: newVersion,
    };
    if (additionalCreators) {
        body.additional_creators = additionalCreators;
    }

    return authedRequest<{ replacement_room: string }>(Method.Post, buildRoomUpgradePath(roomId), undefined, body);
}

export function getStateEventRequest(
    roomId: string,
    eventType: string,
    stateKey: string,
    buildStateEventPath: (roomId: string, eventType: string, stateKey?: string) => string,
    authedRequest: AuthedRequestFn,
): Promise<IContent> {
    return authedRequest<IContent>(Method.Get, buildStateEventPath(roomId, eventType, stateKey));
}

export function reportEventRequest(
    roomId: string,
    eventId: string,
    score: number,
    reason: string,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    return authedRequest<EmptyObject>(Method.Post, buildRoomEventReportPath(roomId, eventId), undefined, {
        score,
        reason,
    });
}

export function reportRoomRequest(
    roomId: string,
    reason: string,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    return authedRequest<EmptyObject>(Method.Post, buildRoomReportPath(roomId), undefined, { reason });
}

export function buildTypingPath(roomId: string, userId: string): string {
    return utils.encodeUri("/rooms/$roomId/typing/$userId", {
        $roomId: roomId,
        $userId: userId,
    });
}

export function sendTypingRequest(
    roomId: string,
    userId: string,
    isTyping: boolean,
    timeoutMs: number,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    const data: QueryDict = {
        typing: isTyping,
    };
    if (isTyping) {
        data.timeout = timeoutMs ? timeoutMs : 20000;
    }
    return authedRequest<EmptyObject>(Method.Put, buildTypingPath(roomId, userId), undefined, data);
}
