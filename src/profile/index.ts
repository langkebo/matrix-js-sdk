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
 * Profile Manager - 用户资料管理
 * 
 * 提供用户资料相关的功能：获取、设置显示名、头像等
 */

import { MatrixClient } from "../client";
import { UserEvent } from "../models/user";
import { Method } from "../http-api/index";
import { type EmptyObject } from "../@types/common";
import { getHttpUriForMxc } from "../content-repo";
import * as utils from "../utils";
import { ClientPrefix } from "../http-api/prefix";

const STABLE_MSC4133_EXTENDED_PROFILES = "org.matrix.msc4133.extended_profiles";
const UNSTABLE_MSC4133_EXTENDED_PROFILES = "org.matrix.msc4133.extended_profiles";

export class ProfileManager {
    constructor(private client: MatrixClient) {}

    /**
     * Set profile information
     */
    public setProfileInfo(info: "avatar_url", data: { avatar_url: string }): Promise<EmptyObject>;
    public setProfileInfo(info: "displayname", data: { displayname: string }): Promise<EmptyObject>;
    public setProfileInfo(info: "avatar_url" | "displayname", data: object): Promise<EmptyObject> {
        const path = utils.encodeUri("/profile/$userId/$info", {
            $userId: this.client.credentials.userId!,
            $info: info,
        });
        return this.client.http.authedRequest(Method.Put, path, undefined, data);
    }

    /**
     * Set display name
     */
    public async setDisplayName(name: string): Promise<EmptyObject> {
        const prom = await this.setProfileInfo("displayname", { displayname: name });
        const user = this.client.getUser(this.client.getUserId()!);
        if (user) {
            user.displayName = name;
            user.emit(UserEvent.DisplayName, user.events.presence, user);
        }
        return prom;
    }

    /**
     * Set avatar URL
     */
    public async setAvatarUrl(url: string): Promise<EmptyObject> {
        const prom = await this.setProfileInfo("avatar_url", { avatar_url: url });
        const user = this.client.getUser(this.client.getUserId()!);
        if (user) {
            user.avatarUrl = url;
            user.emit(UserEvent.AvatarUrl, user.events.presence, user);
        }
        return prom;
    }

    /**
     * Turn an MXC URL into an HTTP one
     */
    public mxcUrlToHttp(
        mxcUrl: string,
        width?: number,
        height?: number,
        resizeMethod?: string,
        allowDirectLinks?: boolean,
        allowRedirects?: boolean,
        useAuthentication?: boolean,
    ): string | null {
        return getHttpUriForMxc(
            this.client.baseUrl,
            mxcUrl,
            width,
            height,
            resizeMethod,
            allowDirectLinks,
            allowRedirects,
            useAuthentication,
        );
    }

    /**
     * Get profile information
     */
    public getProfileInfo(
        userId: string,
        info?: string,
    ): Promise<{ avatar_url?: string; displayname?: string }> {
        const path = info
            ? utils.encodeUri("/profile/$userId/$info", { $userId: userId, $info: info })
            : utils.encodeUri("/profile/$userId", { $userId: userId });
        return this.client.http.authedRequest(Method.Get, path);
    }

    /**
     * Get display name for a user
     */
    public async getDisplayName(userId: string): Promise<string | null> {
        try {
            const profile = await this.getProfileInfo(userId);
            return profile.displayname ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Get avatar URL for a user
     */
    public async getAvatarUrl(userId: string): Promise<string | null> {
        try {
            const profile = await this.getProfileInfo(userId);
            return profile.avatar_url ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Get own display name
     */
    public async getMyDisplayName(): Promise<string | null> {
        const userId = this.client.getUserId();
        if (!userId) return null;
        return this.getDisplayName(userId);
    }

    /**
     * Get own avatar URL
     */
    public async getMyAvatarUrl(): Promise<string | null> {
        const userId = this.client.getUserId();
        if (!userId) return null;
        return this.getAvatarUrl(userId);
    }

    /**
     * Determine if the server supports extended profiles (MSC4133)
     */
    public async doesServerSupportExtendedProfiles(): Promise<boolean> {
        return (
            (await this.client.isVersionSupported("v1.16")) ||
            (await this.client.doesServerSupportUnstableFeature(UNSTABLE_MSC4133_EXTENDED_PROFILES)) ||
            (await this.client.doesServerSupportUnstableFeature(STABLE_MSC4133_EXTENDED_PROFILES))
        );
    }

    /**
     * Get the prefix used for extended profile requests
     */
    private async getExtendedProfileRequestPrefix(): Promise<string> {
        if (
            (await this.client.isVersionSupported("v1.16")) ||
            (await this.client.doesServerSupportUnstableFeature("uk.tcpip.msc4133.stable"))
        ) {
            return ClientPrefix.V3;
        }
        return "/_matrix/client/unstable/uk.tcpip.msc4133";
    }

    /**
     * Fetch a user's extended profile (MSC4133)
     */
    public async getExtendedProfile(userId: string): Promise<Record<string, unknown>> {
        if (!(await this.doesServerSupportExtendedProfiles())) {
            throw new Error("Server does not support extended profiles");
        }
        return this.client.http.authedRequest(
            Method.Get,
            utils.encodeUri("/profile/$userId", { $userId: userId }),
            undefined,
            undefined,
            {
                prefix: await this.getExtendedProfileRequestPrefix(),
            },
        );
    }

    /**
     * Fetch a specific key from the user's extended profile
     */
    public async getExtendedProfileProperty(userId: string, key: string): Promise<unknown> {
        if (!(await this.doesServerSupportExtendedProfiles())) {
            throw new Error("Server does not support extended profiles");
        }
        const profile = await this.client.http.authedRequest(
            Method.Get,
            utils.encodeUri("/profile/$userId/$key", { $userId: userId, $key: key }),
        );
        return profile;
    }
}

// Declare prototype extension
declare module "../client.ts" {
    interface MatrixClient {
        /**
         * Get the profile manager
         */
        getProfileManager(): ProfileManager;
    }
}

/**
 * Extend MatrixClient with profile manager
 */
export function extendMatrixClient(): void {
    MatrixClient.prototype.getProfileManager = function (): ProfileManager {
        return new ProfileManager(this);
    };
}

export default extendMatrixClient;
