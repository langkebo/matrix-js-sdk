import { logger } from "../logger"
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
 * Widget Manager - 小组件管理
 * 
 * 提供小组件的创建、管理、权限验证功能
 * 对接后端: synapse-rust/src/services/widget_service.rs
 */

import { TypedEventEmitter } from "../models/typed-event-emitter.ts";
import { Method } from "../http-api/method.ts";
import { ClientPrefix } from "../http-api/prefix.ts";

export enum WidgetEvent {
    WidgetAdded = "WidgetAdded",
    WidgetRemoved = "WidgetRemoved",
    WidgetUpdated = "WidgetUpdated",
    WidgetError = "WidgetError",
    PermissionRequested = "PermissionRequested",
    PermissionGranted = "PermissionGranted",
    PermissionDenied = "PermissionDenied",
}

export interface IWidget {
    id: string;
    type: string;
    name: string;
    url: string;
    data?: Record<string, any>;
    creatorUserId?: string;
    roomId?: string;
}

export interface IWidgetPermission {
    widgetId: string;
    roomId: string;
    permissions: string[];
    granted: boolean;
    grantedAt?: number;
}

export interface IWidgetCapabilities {
    capabilities: string[];
}

export interface WidgetOpenURLOptions {
    useIframe?: boolean;
    width?: number;
    height?: number;
    title?: string;
}

export interface WidgetMessage {
    api: string;
    action: string;
    data?: any;
    requestId?: string;
}

export interface WidgetMessageResponse {
    requestId: string;
    response?: any;
    error?: {
        message: string;
        code?: string;
    };
}

interface WidgetManagerEventMap {
    [WidgetEvent.WidgetAdded]: (roomId: string, widget: IWidget) => void;
    [WidgetEvent.WidgetRemoved]: (roomId: string, widgetId: string) => void;
    [WidgetEvent.WidgetUpdated]: (roomId: string, widget: IWidget) => void;
    [WidgetEvent.WidgetError]: (roomId: string, widgetId: string, error: Error) => void;
    [WidgetEvent.PermissionRequested]: (widgetId: string, permissions: string[]) => void;
    [WidgetEvent.PermissionGranted]: (widgetId: string, permissions: string[]) => void;
    [WidgetEvent.PermissionDenied]: (widgetId: string, permissions: string[]) => void;
}

export class WidgetManager extends TypedEventEmitter<WidgetEvent, WidgetManagerEventMap> {
    private client: any;
    private widgets: Map<string, Map<string, IWidget>> = new Map();
    private permissions: Map<string, IWidgetPermission> = new Map();
    private pendingRequests: Map<string, (response: WidgetMessageResponse) => void> = new Map();

    constructor(client: any) {
        super();
        this.client = client;
    }

    async getRoomWidgets(roomId: string): Promise<IWidget[]> {
        if (this.widgets.has(roomId)) {
            return Array.from(this.widgets.get(roomId)!.values());
        }

        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                return [];
            }

            const widgetEvents = room.currentState.getStateEvents('im.vector.modular.widgets');
            const widgets: IWidget[] = [];

            for (const event of widgetEvents) {
                const content = event.getContent();
                const widget: IWidget = {
                    id: event.getStateKey(),
                    type: content.type || 'customwidget',
                    name: content.name || 'Widget',
                    url: content.url || '',
                    data: content.data,
                    creatorUserId: content.creatorUserId,
                    roomId,
                };
                widgets.push(widget);
            }

            if (!this.widgets.has(roomId)) {
                this.widgets.set(roomId, new Map());
            }
            widgets.forEach(w => this.widgets.get(roomId)!.set(w.id, w));

            return widgets;
        } catch (e) {
            logger.warn('WidgetManager.getRoomWidgets failed:', e);
            return [];
        }
    }

    async addWidget(roomId: string, widget: Omit<IWidget, 'roomId'>): Promise<IWidget> {
        if (!roomId) {
            throw new Error("Room ID is required");
        }

        if (!widget.id) {
            widget.id = `widget_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        const content = {
            type: widget.type,
            name: widget.name,
            url: widget.url,
            data: widget.data,
            creatorUserId: widget.creatorUserId || this.client.getUserId(),
        };

        try {
            await this.client.sendStateEvent(
                roomId,
                'im.vector.modular.widgets',
                content,
                widget.id
            );

            const newWidget: IWidget = {
                ...widget,
                roomId,
            };

            if (!this.widgets.has(roomId)) {
                this.widgets.set(roomId, new Map());
            }
            this.widgets.get(roomId)!.set(widget.id, newWidget);

            this.emit(WidgetEvent.WidgetAdded, roomId, newWidget);

            return newWidget;
        } catch (error) {
            this.emit(WidgetEvent.WidgetError, roomId, widget.id, error as Error);
            throw error;
        }
    }

    async removeWidget(roomId: string, widgetId: string): Promise<void> {
        if (!roomId || !widgetId) {
            throw new Error("Room ID and Widget ID are required");
        }

        try {
            await this.client.sendStateEvent(
                roomId,
                'im.vector.modular.widgets',
                {},
                widgetId
            );

            if (this.widgets.has(roomId)) {
                this.widgets.get(roomId)!.delete(widgetId);
            }

            this.emit(WidgetEvent.WidgetRemoved, roomId, widgetId);
        } catch (error) {
            this.emit(WidgetEvent.WidgetError, roomId, widgetId, error as Error);
            throw error;
        }
    }

    async updateWidget(roomId: string, widgetId: string, updates: Partial<IWidget>): Promise<IWidget> {
        if (!roomId || !widgetId) {
            throw new Error("Room ID and Widget ID are required");
        }

        const existingWidgets = this.widgets.get(roomId);
        if (!existingWidgets || !existingWidgets.has(widgetId)) {
            throw new Error(`Widget ${widgetId} not found in room ${roomId}`);
        }

        const existingWidget = existingWidgets.get(widgetId)!;
        const updatedWidget: IWidget = {
            ...existingWidget,
            ...updates,
            id: widgetId,
            roomId,
        };

        const content = {
            type: updatedWidget.type,
            name: updatedWidget.name,
            url: updatedWidget.url,
            data: updatedWidget.data,
            creatorUserId: updatedWidget.creatorUserId,
        };

        try {
            await this.client.sendStateEvent(
                roomId,
                'im.vector.modular.widgets',
                content,
                widgetId
            );

            this.widgets.get(roomId)!.set(widgetId, updatedWidget);
            this.emit(WidgetEvent.WidgetUpdated, roomId, updatedWidget);

            return updatedWidget;
        } catch (error) {
            this.emit(WidgetEvent.WidgetError, roomId, widgetId, error as Error);
            throw error;
        }
    }

    async getWidget(roomId: string, widgetId: string): Promise<IWidget | null> {
        const roomWidgets = this.widgets.get(roomId);
        if (roomWidgets && roomWidgets.has(widgetId)) {
            return roomWidgets.get(widgetId) || null;
        }

        await this.getRoomWidgets(roomId);
        
        const widgets = this.widgets.get(roomId);
        return widgets?.get(widgetId) || null;
    }

    async checkWidgetPermission(
        roomId: string,
        widgetId: string,
        permissions: string[]
    ): Promise<boolean> {
        const permissionKey = `${roomId}:${widgetId}`;
        const existing = this.permissions.get(permissionKey);

        if (existing && existing.granted) {
            const hasAll = permissions.every(p => existing.permissions.includes(p));
            if (hasAll) {
                return true;
            }
        }

        this.emit(WidgetEvent.PermissionRequested, widgetId, permissions);
        
        return false;
    }

    async grantWidgetPermission(
        roomId: string,
        widgetId: string,
        permissions: string[]
    ): Promise<void> {
        const permissionKey = `${roomId}:${widgetId}`;
        
        const permission: IWidgetPermission = {
            widgetId,
            roomId,
            permissions,
            granted: true,
            grantedAt: Date.now(),
        };

        this.permissions.set(permissionKey, permission);
        this.emit(WidgetEvent.PermissionGranted, widgetId, permissions);
    }

    async denyWidgetPermission(
        roomId: string,
        widgetId: string,
        permissions: string[]
    ): Promise<void> {
        const permissionKey = `${roomId}:${widgetId}`;
        
        const permission: IWidgetPermission = {
            widgetId,
            roomId,
            permissions,
            granted: false,
        };

        this.permissions.set(permissionKey, permission);
        this.emit(WidgetEvent.PermissionDenied, widgetId, permissions);
    }

    async getWidgetCapabilities(roomId: string, widgetId: string): Promise<IWidgetCapabilities> {
        try {
            const response = await this.client.http.authedRequest(
                Method.Get,
                `/rooms/${roomId}/widgets/${widgetId}/capabilities`,
                undefined,
                undefined,
                { prefix: ClientPrefix.V3 }
            );

            return {
                capabilities: response.capabilities || [],
            };
        } catch (e) {
            logger.warn('WidgetManager.getWidgetCapabilities failed:', e);
            return { capabilities: [] };
        }
    }

    async sendWidgetMessage(
        roomId: string,
        widgetId: string,
        message: WidgetMessage
    ): Promise<WidgetMessageResponse> {
        const requestId = message.requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        try {
            const response = await this.client.http.authedRequest(
                Method.Post,
                `/rooms/${roomId}/widgets/${widgetId}/send`,
                undefined,
                {
                    ...message,
                    request_id: requestId,
                },
                { prefix: ClientPrefix.V3 }
            );

            return {
                requestId,
                response: response,
            };
        } catch (e: any) {
            return {
                requestId,
                error: {
                    message: e.message || 'Unknown error',
                    code: e.errcode,
                },
            };
        }
    }

    async navigateWidget(
        roomId: string,
        widgetId: string,
        url: string
    ): Promise<void> {
        await this.sendWidgetMessage(roomId, widgetId, {
            api: 'widget',
            action: 'navigate',
            data: { url },
        });
    }

    async openWidgetURL(
        roomId: string,
        widgetId: string,
        options?: WidgetOpenURLOptions
    ): Promise<void> {
        const widget = await this.getWidget(roomId, widgetId);
        if (!widget) {
            throw new Error(`Widget ${widgetId} not found`);
        }

        if (options?.useIframe) {
            const iframe = document.createElement('iframe');
            iframe.src = widget.url;
            iframe.width = String(options.width || 400);
            iframe.height = String(options.height || 300);
            iframe.title = options.title || widget.name;
            document.body.appendChild(iframe);
        } else {
            window.open(widget.url, '_blank', 'noopener,noreferrer');
        }
    }

    async validateWidgetURL(url: string): Promise<boolean> {
        try {
            const parsedUrl = new URL(url);
            
            const allowedSchemes = ['http:', 'https:'];
            if (!allowedSchemes.includes(parsedUrl.protocol)) {
                return false;
            }

            return true;
        } catch {
            return false;
        }
    }

    getCachedWidgets(roomId: string): IWidget[] {
        const roomWidgets = this.widgets.get(roomId);
        return roomWidgets ? Array.from(roomWidgets.values()) : [];
    }

    getCachedWidget(roomId: string, widgetId: string): IWidget | null {
        const roomWidgets = this.widgets.get(roomId);
        return roomWidgets?.get(widgetId) || null;
    }

    clearRoomWidgets(roomId: string): void {
        this.widgets.delete(roomId);
        
        for (const [key, permission] of this.permissions.entries()) {
            if (permission.roomId === roomId) {
                this.permissions.delete(key);
            }
        }
    }

    async start(): Promise<void> {
        const rooms = this.client.getRooms?.() || [];
        for (const room of rooms) {
            try {
                await this.getRoomWidgets(room.roomId);
            } catch (e) {
                logger.warn(`Failed to load widgets for room ${room.roomId}:`, e);
            }
        }
    }

    stop(): void {
        this.widgets.clear();
        this.permissions.clear();
        this.pendingRequests.clear();
    }
}
