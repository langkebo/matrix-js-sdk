/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

/**
 * Friend Request Manager - 好友请求管理
 *
 * 管理好友请求的发送、接受、拒绝、取消等操作。
 */

import { Method } from "../../http-api/method";
import { VendorPrefix } from "../../http-api/prefix";
import { InvalidParamError } from "../../common/errors";

import { BaseManager } from "../../managers/base-manager";
import { validateUserId } from "../../common/validators";
import type { Friend, FriendRequest } from "../index";
import type { FriendSharedState } from "./shared-state";

const FRIEND_REQUEST_STATUSES = new Set<string>(["pending", "accepted", "rejected", "cancelled"]);

function normalizeFriendRequest(request: FriendRequest): FriendRequest {
    return {
        ...request,
        reason: request.reason ?? request.message,
        display_name: request.display_name ?? request.displayname,
        status: FRIEND_REQUEST_STATUSES.has(request.status) ? request.status : "pending",
    };
}

export enum FriendRequestManagerEvent {
    Invited = "Invited",
    Accepted = "Accepted",
    Rejected = "Rejected",
    Cancelled = "Cancelled",
    RequestSent = "RequestSent",
    RequestAccepted = "RequestAccepted",
    RequestRejected = "RequestRejected",
    RequestCancelled = "RequestCancelled",
    RequestReceived = "RequestReceived",
    FriendAdded = "FriendAdded",
    ListUpdated = "ListUpdated",
}

interface FriendRequestManagerEventMap {
    [FriendRequestManagerEvent.Invited]: (userId: string, request: FriendRequest) => void;
    [FriendRequestManagerEvent.Accepted]: (userId: string) => void;
    [FriendRequestManagerEvent.Rejected]: (userId: string) => void;
    [FriendRequestManagerEvent.Cancelled]: (userId: string) => void;
    [FriendRequestManagerEvent.RequestSent]: (userId: string) => void;
    [FriendRequestManagerEvent.RequestAccepted]: (userId: string) => void;
    [FriendRequestManagerEvent.RequestRejected]: (userId: string) => void;
    [FriendRequestManagerEvent.RequestCancelled]: (userId: string) => void;
    [FriendRequestManagerEvent.RequestReceived]: (request: FriendRequest) => void;
    [FriendRequestManagerEvent.FriendAdded]: (friend: Friend) => void;
    [FriendRequestManagerEvent.ListUpdated]: () => void;
}

interface IFriendRequestsResponse {
    requests?: FriendRequest[];
}

export class FriendRequestManager extends BaseManager<FriendRequestManagerEvent, FriendRequestManagerEventMap> {
    constructor(private readonly sharedState: FriendSharedState) {
        super(sharedState.client);
    }

    /**
     * 发送好友请求
     *
     * @param userId - 目标用户 ID（格式：@localpart:homeserver）
     * @param reason - 请求理由（可选）
     *
     * @example
     * ```typescript
     * // 发送好友请求
     * await friendManager.requests.sendFriendRequest("@alice:example.com", "Hi, let's be friends!");
     * ```
     *
     * @throws {ValidationError} 如果用户 ID 格式无效
     * @throws {InvalidParamError} 如果尝试添加自己为好友
     * @throws {ApiError} 如果 API 调用失败
     */
    async sendFriendRequest(userId: string, reason?: string): Promise<{ request_id?: string; status?: string }> {
        validateUserId(userId);

        if (userId === this.client.getUserId()) {
            throw new InvalidParamError("Cannot send friend request to yourself");
        }

        if (reason !== undefined && reason.length > 500) {
            throw new InvalidParamError("Friend request message too long (max 500 characters)");
        }

        const response = await this.request<{
            request_id?: string;
            status?: string;
        }>({
            method: Method.Post,
            path: "/friends/request",
            body: { user_id: userId, message: reason },
            prefix: VendorPrefix,
        });

        const request: FriendRequest = {
            user_id: userId,
            reason,
            status: "pending",
            timestamp: Date.now(),
            request_id: response?.request_id,
        };

        this.sharedState.outgoingRequests.set(userId, request);
        this.emit(FriendRequestManagerEvent.Invited, userId, request);
        this.emit(FriendRequestManagerEvent.RequestSent, userId);
        return { request_id: response?.request_id, status: response?.status };
    }

    /**
     * 直接添加好友（不经过请求流程）
     */
    async addFriend(userId: string, opts?: { reason?: string }): Promise<{ user_id?: string; status?: string }> {
        if (!userId) {
            throw new InvalidParamError("User ID is required");
        }
        validateUserId(userId);

        if (userId === this.client.getUserId()) {
            throw new InvalidParamError("Cannot add yourself as a friend");
        }

        const response = await this.withRetry(async () => {
            return await this.request<{ user_id?: string; status?: string }>({
                method: Method.Post,
                path: "/friends",
                body: { user_id: userId, reason: opts?.reason },
                prefix: VendorPrefix,
            });
        }, "addFriend");

        const friendObj: Friend = {
            user_id: userId,
            reason: opts?.reason,
            since: Date.now(),
            status: "normal",
        };
        this.sharedState.friends.set(userId, friendObj);
        this.emit(FriendRequestManagerEvent.FriendAdded, friendObj);
        this.emit(FriendRequestManagerEvent.ListUpdated);

        return { user_id: response?.user_id, status: response?.status };
    }

    /**
     * 接受好友请求
     */
    async acceptFriendRequest(userId: string): Promise<{ room_id?: string }> {
        validateUserId(userId);

        const response = await this.request<{ room_id?: string }>({
            method: Method.Post,
            path: `/friends/request/${encodeURIComponent(userId)}/accept`,
            prefix: VendorPrefix,
        });

        const request = this.sharedState.incomingRequests.get(userId);
        if (request) {
            request.status = "accepted";
            this.sharedState.incomingRequests.delete(userId);
        }

        const friendObj: Friend = {
            user_id: userId,
            since: Date.now(),
            status: "normal",
        };
        this.sharedState.friends.set(userId, friendObj);

        this.emit(FriendRequestManagerEvent.Accepted, userId);
        this.emit(FriendRequestManagerEvent.RequestAccepted, userId);
        this.emit(FriendRequestManagerEvent.FriendAdded, friendObj);
        this.emit(FriendRequestManagerEvent.ListUpdated);
        return { room_id: response?.room_id };
    }

    /**
     * 拒绝好友请求
     */
    async rejectFriendRequest(userId: string): Promise<void> {
        validateUserId(userId);

        await this.request({
            method: Method.Post,
            path: `/friends/request/${encodeURIComponent(userId)}/reject`,
            prefix: VendorPrefix,
        });

        this.sharedState.incomingRequests.delete(userId);
        this.emit(FriendRequestManagerEvent.Rejected, userId);
        this.emit(FriendRequestManagerEvent.RequestRejected, userId);
    }

    /**
     * 取消已发送的好友请求
     */
    async cancelFriendRequest(userId: string): Promise<void> {
        validateUserId(userId);

        await this.request({
            method: Method.Post,
            path: `/friends/request/${encodeURIComponent(userId)}/cancel`,
            prefix: VendorPrefix,
        });

        this.sharedState.outgoingRequests.delete(userId);
        this.emit(FriendRequestManagerEvent.Cancelled, userId);
        this.emit(FriendRequestManagerEvent.RequestCancelled, userId);
    }

    /**
     * 获取收到的好友请求
     *
     * FT-094: 此前主路径为 /friends/request/received（单数），fallback 为
     * /friends/requests/incoming（复数）。但后端两个路径都返回 200，fallback
     * 永不触发。现统一使用 route_ledger 规范路径 /friends/requests/incoming，
     * 与 getOutgoingRequests 的 /friends/requests/outgoing 保持一致。
     */
    async getIncomingRequests(): Promise<FriendRequest[]> {
        try {
            const response = await this.request<IFriendRequestsResponse>({
                method: Method.Get,
                path: "/friends/requests/incoming",
                prefix: VendorPrefix,
            });

            const requests = (response.requests || []).map(normalizeFriendRequest);

            this.sharedState.incomingRequests.clear();
            requests.forEach((r) => {
                this.sharedState.incomingRequests.set(r.user_id, r);
                this.emit(FriendRequestManagerEvent.RequestReceived, r);
            });

            return requests;
        } catch (e) {
            throw this.normalizeError(e, "getIncomingRequests");
        }
    }

    /**
     * 获取发出的好友请求
     */
    async getOutgoingRequests(): Promise<FriendRequest[]> {
        try {
            const response = await this.request<IFriendRequestsResponse>({
                method: Method.Get,
                path: "/friends/requests/outgoing",
                prefix: VendorPrefix,
            });

            const requests = (response.requests || []).map(normalizeFriendRequest);

            this.sharedState.outgoingRequests.clear();
            requests.forEach((r) => this.sharedState.outgoingRequests.set(r.user_id, r));

            return requests;
        } catch (e) {
            throw this.normalizeError(e, "getOutgoingRequests");
        }
    }

    /**
     * 获取缓存的收到的请求
     */
    getCachedIncomingRequests(): FriendRequest[] {
        return Array.from(this.sharedState.incomingRequests.values());
    }

    /**
     * 获取缓存的发出的请求
     */
    getCachedOutgoingRequests(): FriendRequest[] {
        return Array.from(this.sharedState.outgoingRequests.values());
    }

    /**
     * 清除请求缓存
     */
    clearCache(): void {
        this.sharedState.incomingRequests.clear();
        this.sharedState.outgoingRequests.clear();
    }
}
