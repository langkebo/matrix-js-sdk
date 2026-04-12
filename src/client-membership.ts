import * as utils from "./utils.ts";
import { MatrixError } from "./http-api/index.ts";
import { Method } from "./http-api/index.ts";
import type { Body, IRequestOpts } from "./http-api/index.ts";
import type { InviteOpts } from "./@types/requests.ts";
import type { Membership } from "./@types/membership.ts";
import type { EmptyObject } from "./@types/common.ts";
import type { Room } from "./models/room.ts";
import type { QueryDict } from "./utils.ts";

export function normalizeInviteOptions(opts: InviteOpts | string): InviteOpts {
    if (typeof opts === "object") {
        return opts;
    }
    return { reason: opts };
}

export function createMissingIdentityServerError(): MatrixError {
    return new MatrixError({
        error: "No supplied identity server URL",
        errcode: "ORG.MATRIX.JSSDK_MISSING_PARAM",
    });
}

export function buildInviteByThreePidParams(
    identityServerUrl: string,
    medium: string,
    address: string,
    identityAccessToken?: string,
): Record<string, string> {
    const params: Record<string, string> = {
        id_server: identityServerUrl,
        medium,
        address,
    };
    if (identityAccessToken) {
        params["id_access_token"] = identityAccessToken;
    }
    return params;
}

export function buildRoomInvitePath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/invite", { $roomId: roomId });
}

export function buildMembershipChangePath(roomId: string, membership: Membership): string {
    return utils.encodeUri("/rooms/$room_id/$membership", {
        $room_id: roomId,
        $membership: membership,
    });
}

export function buildRoomForgetPath(roomId: string): string {
    return utils.encodeUri("/rooms/$room_id/forget", { $room_id: roomId });
}

export function buildRoomUnbanPath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/unban", { $roomId: roomId });
}

export function buildRoomKickPath(roomId: string): string {
    return utils.encodeUri("/rooms/$roomId/kick", { $roomId: roomId });
}

export function buildMembershipChangeBody(
    userId: string | undefined,
    reason?: string,
): { user_id: string | undefined; reason?: string } {
    return {
        user_id: userId,
        reason,
    };
}

export function buildSingleUserBody(userId: string, reason?: string): { user_id: string; reason?: string } {
    return {
        user_id: userId,
        reason,
    };
}

export function selectLeaveRoomChainTargets(upgradeHistory: Room[], roomId: string, includeFuture: boolean): Room[] {
    if (includeFuture) {
        return upgradeHistory;
    }

    const eligibleToLeave: Room[] = [];
    for (const room of upgradeHistory) {
        eligibleToLeave.push(room);
        if (room.roomId === roomId) {
            break;
        }
    }
    return eligibleToLeave;
}

type AuthedRequestFn = <T>(
    method: Method,
    path: string,
    queryParams?: QueryDict,
    body?: Body,
    requestOpts?: IRequestOpts,
) => Promise<T>;

export interface InviteRequestContext {
    roomId: string;
    userId: string;
    opts?: InviteOpts | string;
    shareRoomHistoryWithUser?: (roomId: string, userId: string) => Promise<void>;
    membershipChange: (
        roomId: string,
        userId: string | undefined,
        membership: Membership,
        reason?: string,
    ) => Promise<EmptyObject>;
}

export async function inviteToRoomRequest({
    roomId,
    userId,
    opts = {},
    shareRoomHistoryWithUser,
    membershipChange,
}: InviteRequestContext): Promise<EmptyObject> {
    const normalizedOpts = normalizeInviteOptions(opts);
    if (normalizedOpts.shareEncryptedHistory) {
        await shareRoomHistoryWithUser?.(roomId, userId);
    }
    return await membershipChange(roomId, userId, "invite" as Membership, normalizedOpts.reason);
}

export interface InviteByThreePidRequestContext {
    roomId: string;
    medium: string;
    address: string;
    getIdentityServerUrl: (stripProto?: boolean) => string | undefined;
    getIdentityAccessToken?: () => Promise<string | null | undefined>;
    authedRequest: AuthedRequestFn;
}

export async function inviteByThreePidRequest({
    roomId,
    medium,
    address,
    getIdentityServerUrl,
    getIdentityAccessToken,
    authedRequest,
}: InviteByThreePidRequestContext): Promise<EmptyObject> {
    const path = buildRoomInvitePath(roomId);
    const identityServerUrl = getIdentityServerUrl(true);
    if (!identityServerUrl) {
        throw createMissingIdentityServerError();
    }
    const identityAccessToken = (await getIdentityAccessToken?.()) ?? undefined;
    const params = buildInviteByThreePidParams(identityServerUrl, medium, address, identityAccessToken);
    return authedRequest<EmptyObject>(Method.Post, path, undefined, params);
}

export async function forgetRoomRequest(
    roomId: string,
    deleteRoom: boolean,
    authedRequest: AuthedRequestFn,
    removeRoom: (roomId: string) => void,
    emitDeleteRoom: (roomId: string) => void,
): Promise<EmptyObject> {
    const path = buildRoomForgetPath(roomId);
    const response = await authedRequest<EmptyObject>(Method.Post, path);
    if (deleteRoom) {
        removeRoom(roomId);
        emitDeleteRoom(roomId);
    }
    return response;
}

export function unbanRoomUserRequest(
    roomId: string,
    userId: string,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    const path = buildRoomUnbanPath(roomId);
    const data = buildSingleUserBody(userId);
    return authedRequest<EmptyObject>(Method.Post, path, undefined, data);
}

export function kickRoomUserRequest(
    roomId: string,
    userId: string,
    reason: string | undefined,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    const path = buildRoomKickPath(roomId);
    const data = buildSingleUserBody(userId, reason);
    return authedRequest<EmptyObject>(Method.Post, path, undefined, data);
}

export function membershipChangeRequest(
    roomId: string,
    userId: string | undefined,
    membership: Membership,
    reason: string | undefined,
    authedRequest: AuthedRequestFn,
): Promise<EmptyObject> {
    const path = buildMembershipChangePath(roomId, membership);
    return authedRequest<EmptyObject>(Method.Post, path, undefined, buildMembershipChangeBody(userId, reason));
}

export function leaveRoomChainRequest(
    roomId: string,
    includeFuture: boolean,
    getRoomUpgradeHistory: (roomId: string, verifyLinks: boolean) => Room[],
    leave: (roomId: string) => Promise<EmptyObject>,
): Promise<{ [roomId: string]: Error | MatrixError | null }> {
    const upgradeHistory = getRoomUpgradeHistory(roomId, true);
    const eligibleToLeave = selectLeaveRoomChainTargets(upgradeHistory, roomId, includeFuture);

    const populationResults: { [roomId: string]: Error } = {};
    const promises: Promise<unknown>[] = [];

    const doLeave = (targetRoomId: string): Promise<void> => {
        return leave(targetRoomId)
            .then(() => {
                delete populationResults[targetRoomId];
            })
            .catch((err) => {
                // suppress error
                populationResults[targetRoomId] = err;
            });
    };

    for (const room of eligibleToLeave) {
        promises.push(doLeave(room.roomId));
    }

    return Promise.all(promises).then(() => populationResults);
}
