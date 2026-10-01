# SDK Manager Gap Analysis & Optimization Plan

> **Date**: 2026-07-31
> **Scope**: P-102 follow-up — identify and fill Manager implementation gaps between synapse-rust backend and matrix-js-sdk
> **Status**: Analysis complete, ready for implementation

---

## Executive Summary

After thorough cross-repo analysis of synapse-rust backend routes and matrix-js-sdk Manager implementations, **9 service areas** have been identified with implementation gaps. The gaps range from missing methods on existing Managers to entirely missing Manager classes.

| Priority | Service                                       | Gap Type           | Existing Manager    | Action                |
| -------- | --------------------------------------------- | ------------------ | ------------------- | --------------------- |
| P0       | **MediaService** quota/alerts                 | Missing methods    | `MediaManager`      | Add 3 methods         |
| P0       | **AuthService** captcha/whoami/saml/versions  | Missing methods    | `AuthManager`       | Add 5 methods         |
| P0       | **AccountService** my_rooms/events            | Missing methods    | `AccountManager`    | Add 2 methods         |
| P1       | **MessageService** pagination                 | Missing method     | `RoomManager`       | Add 1 method          |
| P1       | **RoomNotificationService** unread_count      | Missing method     | `RoomManager`       | Add 1 method          |
| P1       | **RoomCapabilitiesService** room-level        | Missing method     | `RoomManager`       | Add 1 method          |
| P1       | **DeviceService** room_keys/request           | Partially exists   | `RoomKeysManager`   | Extend + add delete   |
| P2       | **VoIPService** TURN complete config          | Incomplete return  | `TurnServerManager` | Enhance return type   |
| P2       | **MatrixMessageRelationService** sendRelation | Parameter mismatch | `RelationsManager`  | Fix parameter mapping |

---

## Phase 1: Detailed Gap Analysis

### 1.1 DeviceService — `/room_keys/request` (2 occurrences)

**Backend Routes** (from `e2ee_routes.rs`):

- `GET /_matrix/client/v3/room_keys/request` — list key requests
- `POST /_matrix/client/v3/room_keys/request` — create key request
- `DELETE /_matrix/client/v3/room_keys/request/{request_id}` — delete/cancel key request

**SDK Current State**: `src/room-keys/index.ts`

- ✅ `getRoomKeyRequests()` — GET implemented
- ✅ `createRoomKeyRequest()` — POST implemented
- ❌ `deleteRoomKeyRequest(requestId)` — DELETE missing

**Gap**: Missing `deleteRoomKeyRequest()` method. The `RoomKeysManager` exists but lacks the DELETE endpoint.

**Implementation**: Add `deleteRoomKeyRequest(requestId: string): Promise<void>` to `RoomKeysManager`.

---

### 1.2 VoIPService — `getTurnServer()` Complete Configuration

**Backend Route**: `GET /_matrix/client/v3/voip/turnServer` (or `/_matrix/client/v3/turn_server`)

**SDK Current State**: `src/turn-server/index.ts`

- `getTurnServerURIs()` — returns `Promise<string[]>` (URIs only)
- `checkTurnServers()` — internal credential refresh, emits client events

**Gap**: No public method returns the **complete TURN configuration** including:

- `uris: string[]`
- `username: string`
- `password: string` (credential)
- `ttl: number`

The `ITurnServerResponse` type exists in `src/client.ts` but is only used internally in `checkTurnServers()`.

**Implementation**: Add `getTurnServerConfig(): Promise<ITurnServerResponse>` to `TurnServerManager` that returns the full server response.

---

### 1.3 MediaService — `/media/quota_check`, `/media/quota_stats`, `/media/alerts`

**Backend Routes** (from `media_routes.rs`, confirmed in `__generated__/route-table.ts`):

- `GET /_matrix/media/v1/quota/check` — check user quota status
- `GET /_matrix/media/v1/quota/stats` — get quota statistics
- `GET /_matrix/media/v1/quota/alerts` — get quota alerts

**SDK Current State**: `src/media/index.ts`

- The `MEDIA_ROUTES` in `__generated__/route-table.ts` includes these 3 routes (lines 27-29)
- The `MediaManager` class has NO methods for any of these endpoints

**Gap**: 3 entirely missing methods on existing `MediaManager`.

**Implementation**: Add to `MediaManager`:

- `checkMediaQuota(): Promise<MediaQuotaCheckResponse>`
- `getMediaQuotaStats(): Promise<MediaQuotaStatsResponse>`
- `getMediaQuotaAlerts(): Promise<MediaQuotaAlertsResponse>`

---

### 1.4 AuthService — captcha/whoami/logout/saml/versions

**Backend Routes** (from `auth_compat.rs`):

- `GET /_matrix/client/v3/auth/captcha` — get captcha challenge
- `GET /_matrix/client/v3/account/whoami` — get current user info
- `POST /_matrix/client/v3/logout` — logout
- `GET /_matrix/client/v3/login/sso/redirect/{idp_id}` — SAML/OAuth redirect
- `GET /_matrix/client/versions` — server versions

**SDK Current State**: `src/auth/index.ts`

- `getLoginFlows()` — ✅ implemented
- `register()` — ✅ implemented
- `login()` — partially exists on client
- ❌ `getCaptcha()` — missing
- ❌ `whoami()` — missing
- ❌ `logout()` — missing (exists on client but not on AuthManager)
- ❌ `getSamlRedirect(idpId)` — missing
- ❌ `getVersions()` — missing (exists on client but not on AuthManager)

**Gap**: 5 missing methods on `AuthManager`.

**Implementation**: Add all 5 methods to `AuthManager`.

---

### 1.5 AccountService — `/my_rooms`, `/events`

**Backend Routes**:

- `GET /_matrix/client/v3/account/rooms` (or `/my_rooms`) — list user's rooms
- `GET /_matrix/client/v3/events` — global event stream

**SDK Current State**: `src/account/index.ts`

- Account data methods exist
- ❌ `getMyRooms()` — missing
- ❌ `getEvents()` — missing (event stream)

**Gap**: 2 missing methods. These may exist on `MatrixClient` directly but not on `AccountManager`.

**Implementation**: Add to `AccountManager`:

- `getMyRooms(): Promise<MyRoomsResponse>`
- `getEvents(options?: EventsRequestOptions): Promise<EventsResponse>`

---

### 1.6 MessageService — `/rooms/{id}/messages` Pagination

**Backend Route**: `GET /_matrix/client/v3/rooms/{room_id}/messages`

**SDK Current State**: `src/room/index.ts` (RoomManager)

- `getRoomMessages()` may exist but pagination interface may be incomplete
- The `client.ts` has `scrollback()` and `paginateEventTimeline()`

**Gap**: Need to verify if `RoomManager` exposes a proper paginated messages method with:

- `from` / `to` tokens
- `limit`
- `dir` (direction)
- `filter`

**Implementation**: Ensure `RoomManager` has `getRoomMessages(roomId, options)` with full pagination support.

---

### 1.7 RoomNotificationService — `/rooms/{id}/unread_count`

**Backend Route**: `GET /_matrix/client/v3/rooms/{room_id}/unread_count` or via `/notifications`

**SDK Current State**: `src/room/index.ts`

- `getRoomUnreadCount()` may exist on `RoomSummaryManager` (line 876 in `room-summary/index.ts`)
- But this may be a different endpoint

**Gap**: Verify if dedicated unread count endpoint exists on `RoomManager`.

**Implementation**: Add `getRoomUnreadCount(roomId): Promise<number>` to `RoomManager` if missing.

---

### 1.8 RoomCapabilitiesService — `/rooms/{id}/capabilities`

**Backend Route**: `GET /_matrix/client/v3/rooms/{room_id}/capabilities`

**SDK Current State**: `src/room-summary/index.ts`

- `getRoomCapabilities(roomId)` exists on `RoomSummaryManager.eventOps` (line 838)

**Gap**: This is on `RoomSummaryManager`, not `RoomManager`. The user wants it on `RoomManager` (room-level, not summary-level).

**Implementation**: Add `getRoomCapabilities(roomId)` to `RoomManager` as a facade that delegates or makes its own request.

---

### 1.9 MatrixMessageRelationService — `sendRelation` Parameter Mismatch

**Backend Route**: `PUT /_matrix/client/v3/rooms/{room_id}/relations/{event_id}/{rel_type}/{event_id}`

**SDK Current State**: `src/relations/index.ts`

```typescript
public async sendRelation(
    roomId: string,
    eventId: string,          // ← This is the PARENT event ID
    relationType: RelationType,
    targetEventId: string,   // ← This is the CHILD event ID
    body: SendRelationRequestBody = {},
): Promise<SendRelationResponse>
```

**Gap Analysis**: The parameter naming may be confusing. The backend path is:
`/rooms/{room_id}/relations/{event_id}/{rel_type}/{event_id}`

The FIRST `{event_id}` is the parent event, the SECOND is the child/relation event.

In the SDK, `eventId` = parent, `targetEventId` = child. This is semantically correct but the naming could be clearer (`parentEventId`, `childEventId`).

Also, the `SendRelationRequestBody` type may not match the backend DTO exactly.

**Implementation**: Review and potentially rename parameters for clarity. Verify body type matches backend.

---

## Phase 2: Design Specifications

### 2.1 New Types to Define

```typescript
// src/media/index.ts additions
export interface MediaQuotaCheckResponse {
    used_bytes: number;
    quota_bytes: number;
    remaining_bytes: number;
    exceeded: boolean;
}

export interface MediaQuotaStatsResponse {
    total_uploads: number;
    total_bytes: number;
    average_file_size: number;
    largest_file_bytes: number;
}

export interface MediaQuotaAlert {
    alert_type: "quota_warning" | "quota_exceeded";
    threshold_percent: number;
    current_usage_percent: number;
    message: string;
}

export interface MediaQuotaAlertsResponse {
    alerts: MediaQuotaAlert[];
}

// src/auth/index.ts additions
export interface CaptchaResponse {
    public_key: string;
    challenge?: string;
    html?: string;
}

export interface WhoamiResponse {
    user_id: string;
    device_id?: string;
    is_guest?: boolean;
}

export interface SamlRedirectResponse {
    location: string;
}

export interface VersionsResponse {
    versions: string[];
    unstable_features?: Record<string, boolean>;
}

// src/account/index.ts additions
export interface MyRoomsResponse {
    joined_rooms: string[];
    invited_rooms: string[];
    left_rooms: string[];
}

export interface EventsResponse {
    chunk: IEvent[];
    start?: string;
    end?: string;
}

export interface EventsRequestOptions {
    from?: string;
    to?: string;
    dir?: "f" | "b";
    limit?: number;
}
```

### 2.2 Method Signatures

```typescript
// RoomKeysManager (src/room-keys/index.ts)
async deleteRoomKeyRequest(requestId: string): Promise<void>;

// TurnServerManager (src/turn-server/index.ts)
async getTurnServerConfig(): Promise<ITurnServerResponse>;

// MediaManager (src/media/index.ts)
async checkMediaQuota(): Promise<MediaQuotaCheckResponse>;
async getMediaQuotaStats(): Promise<MediaQuotaStatsResponse>;
async getMediaQuotaAlerts(): Promise<MediaQuotaAlertsResponse>;

// AuthManager (src/auth/index.ts)
async getCaptcha(): Promise<CaptchaResponse>;
async whoami(): Promise<WhoamiResponse>;
async logout(): Promise<void>;
async getSamlRedirect(idpId: string): Promise<SamlRedirectResponse>;
async getVersions(): Promise<VersionsResponse>;

// AccountManager (src/account/index.ts)
async getMyRooms(): Promise<MyRoomsResponse>;
async getEvents(options?: EventsRequestOptions): Promise<EventsResponse>;

// RoomManager (src/room/index.ts)
async getRoomMessages(
    roomId: string,
    options?: {
        from?: string;
        to?: string;
        dir?: "f" | "b";
        limit?: number;
        filter?: string;
    }
): Promise<MessagesResponse>;
async getRoomUnreadCount(roomId: string): Promise<number>;
async getRoomCapabilities(roomId: string): Promise<RoomCapabilities>;

// RelationsManager (src/relations/index.ts)
// Parameter rename for clarity:
async sendRelation(
    roomId: string,
    parentEventId: string,     // renamed from eventId
    relationType: RelationType,
    childEventId: string,      // renamed from targetEventId
    body: SendRelationRequestBody = {},
): Promise<SendRelationResponse>;
```

---

## Phase 3: Implementation Order (TDD)

### Sprint A: High-Priority (P0) — Media + Auth + Account

1. **MediaManager** — 3 quota methods
    - Write tests first (`spec/unit/media-extended.spec.ts`)
    - Implement methods
    - Run tests + lint

2. **AuthManager** — 5 auth methods
    - Write tests first (`spec/unit/auth-extended.spec.ts`)
    - Implement methods
    - Run tests + lint

3. **AccountManager** — 2 account methods
    - Write tests first (`spec/unit/account-extended.spec.ts`)
    - Implement methods
    - Run tests + lint

### Sprint B: Medium-Priority (P1) — Room + Relations

4. **RoomManager** — 3 room methods (messages, unread, capabilities)
    - Write tests first
    - Implement methods
    - Run tests + lint

5. **RoomKeysManager** — 1 delete method
    - Write tests first
    - Implement method
    - Run tests + lint

6. **RelationsManager** — parameter fix
    - Write tests first
    - Rename parameters (backward-compatible with overloads)
    - Run tests + lint

### Sprint C: Low-Priority (P2) — VoIP

7. **TurnServerManager** — 1 config method
    - Write tests first
    - Implement method
    - Run tests + lint

---

## Phase 4: Error Handling Strategy

All new methods follow the established SDK pattern:

1. **Input validation**: Use `ValidationError` for missing/invalid parameters
2. **Request wrapping**: Use `withRetry()` for idempotent GETs, direct `request()` for mutating operations
3. **Error normalization**: Use `normalizeError()` to convert HTTP errors to typed `SdkError` subclasses
4. **Event emission**: Emit `Error` events on the Manager for async error propagation
5. **Cache management**: Clear relevant caches on mutating operations

---

## Phase 5: Documentation Updates

1. Update `docs/api-contract/media.md` — document new quota endpoints
2. Update `docs/api-contract/auth.md` — document new auth endpoints
3. Update `docs/api-contract/account.md` — document new account endpoints
4. Update module JSDoc with `@example` blocks for all new methods
5. Update `CLAUDE.md` architecture section if new Managers are created

---

## Phase 6: Verification Checklist

- [ ] All new methods have unit tests (mocked HTTP)
- [ ] `pnpm vitest run spec/unit/<module>*.spec.ts` passes for all modified modules
- [ ] `pnpm lint:types` (tsc --noEmit) passes with 0 errors
- [ ] `pnpm lint:js` passes (or only pre-existing errors)
- [ ] `pnpm contract:codegen:check` passes (if route tables changed)
- [ ] No new `any` types introduced
- [ ] All public methods have JSDoc with `@example` and `@throws`
- [ ] Backward compatibility preserved (no breaking changes)
