import type { Room, RoomMember, MatrixEvent, ISendEventResponse } from "matrix-js-sdk";

declare module "matrix-js-sdk" {
    interface MatrixClient {
        checkCrossSigningStatus(): Promise<unknown>;
        getCrossSigningKeys(): Promise<unknown>;
        isCrossSigningReady(): Promise<boolean>;
        getUserCrossSigningKeys(userId: string): Promise<unknown>;
        checkAndTrustCrossSigning(): Promise<unknown>;
        getCryptoAlgorithm(): unknown;
        setCryptoAlgorithm(algorithm: unknown): void;
        hasCrypto(): boolean;
        initCrypto(): Promise<void>;
        stopCrypto(): void;
        isCryptoBackupEnabled(): Promise<boolean>;
        enableCryptoBackup(): Promise<void>;
        disableCryptoBackup(): Promise<void>;
        getCryptoBackup(): Promise<unknown>;
        restoreCryptoBackup(
            recoveryKey: string,
            roomId?: string,
            sessionId?: string,
            backupInfo?: unknown,
        ): Promise<unknown>;
        cryptoStore: unknown;
        deleteCryptoStore(): Promise<void>;
        isCryptoStoreReady(): Promise<boolean>;
        rotateEncryptionKeys(): Promise<unknown>;
        isRotationNeeded(): Promise<boolean>;
        getRotationPeriod(): number;
        setRotationPeriod(period: number): void;
        getLastRotationTime(): number;
        getRoomWithHighestUnread(): Room | null;
        getRoomsWithUnreadNotifications(): Room[];
        rooms: Room[];
        getRoomByAlias(alias: string): Room | null;
        sortRoomsByLastMessage(rooms: Room[]): Room[];
        claimKeys(keys: unknown): Promise<unknown>;
        claimedKeys: Map<string, unknown>;
        getUserStorageUsage(userId: string): Promise<unknown>;
        getNotificationCount(): number;
        getHighlightCount(): number;
        hasUnreadNotifications(): boolean;
        hasUnreadHighlights(): boolean;
        notificationCallback: unknown;
        getTotalNotificationCount(): number;
        getTotalHighlightCount(): number;
        getPendingEvents(): MatrixEvent[];
        hasPendingEvents(): boolean;
        getUnsentEvents(): MatrixEvent[];
        reactToMessage(roomId: string, eventId: string, emoji: string): Promise<ISendEventResponse>;
        redactReaction(roomId: string, eventId: string, reactionEventId: string): Promise<void>;
        getReactionUsers(roomId: string, eventId: string, emoji: string): Promise<RoomMember[]>;
        hasReaction(roomId: string, eventId: string, emoji: string): Promise<boolean>;
        getRoomRetention(roomId: string): Promise<unknown>;
        setRoomRetention(roomId: string, retention: unknown): Promise<void>;
        getServerRetention(): Promise<unknown>;
        shareRoomKey(roomId: string, userIds: string[], options?: unknown): Promise<unknown>;
        getSharedWithUsers(roomId: string): Promise<unknown>;
        hasSharedKeyWithUser(roomId: string, userId: string): Promise<boolean>;
        exportRoomKeys(): Promise<unknown[]>;
        importRoomKeys(keys: unknown[], options?: unknown): Promise<unknown[]>;
        getRoomName(roomId: string): Promise<string>;
        getRoomTopic(roomId: string): Promise<string>;
        getRoomAvatarUrl(roomId: string): Promise<string | null>;
        setRoomAvatar(roomId: string, avatarUrl: string): Promise<void>;
        getRoomHistoryVisibility(roomId: string): Promise<string>;
        setRoomHistoryVisibility(roomId: string, visibility: string): Promise<void>;
        getRoomGuestAccess(roomId: string): Promise<string>;
        setRoomGuestAccess(roomId: string, access: string): Promise<void>;
        getRoomJoinRule(roomId: string): Promise<string>;
        setRoomJoinRule(roomId: string, rule: string): Promise<void>;
        isSecretStorageReady(): Promise<boolean>;
        getSecretStorageKey(keyId: string): Promise<unknown>;
        storeSecret(name: string, secret: unknown, keys?: unknown): Promise<void>;
        getSecret(name: string): Promise<unknown>;
        hasSecret(name: string): Promise<boolean>;
        getSecretStorageKeys(): Promise<unknown[]>;
        getServerCapabilities(): Promise<unknown>;
        hasServerSupport(feature: string): boolean;
        getServerVersion(): Promise<string>;
        supportsLocation(): boolean;
        serverClockDiff: number;
        getLocalTimestampForServerTime(serverTs: number): number;
        getServerTimestamp(): number;
        updateServerTimeInfo(): Promise<void>;
        waitForPendingRequests(): Promise<void>;
        hasStartedSync(): boolean;
        isSyncing(): boolean;
        waitForSync(): Promise<void>;
        syncToken: string | null;
        syncing: boolean;
        getTurnServerURIs(): Promise<string[]>;
        getUserWidgets(): Promise<unknown[]>;
        getRoomWidgets(roomId: string): Promise<unknown[]>;
        setUserWidgets(widgets: unknown[]): Promise<void>;
        setRoomWidgets(roomId: string, widgets: unknown[]): Promise<void>;
        getAllWidgetEvents(roomId: string): Promise<unknown[]>;
    }
}
