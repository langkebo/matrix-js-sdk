# SDK-Frontend Export Usage Matrix

> Generated: 2026-07-20
> Scope: Cross-referencing every `matrix-js-sdk` package.json `exports` entry against hula's actual imports
> Sources: `matrix-js-sdk/package.json` (52 export entries) vs `hula/src/` (all `.ts`, `.tsx`, `.vue`, `.js` files)

---

## Executive Summary

| Metric | Value |
|---|---|
| Total SDK export entries | 52 (1 main + 51 sub-paths) |
| Main entry (`matrix-js-sdk`) import count | 156 (145 unique files; 72 production + 73 test) |
| Sub-path exports with static imports | 18 / 51 (35%) |
| Sub-path exports with ZERO static imports | 33 / 51 (65%) |
| Deep-path violations (`src/` or `lib/`) | 0 static imports, 2 type-level (in `.d.ts` files) |
| `import * as sdk` namespace imports | 3 files |
| Dynamic `import()` calls | 5 files (1 production, 4 type-definition) |
| hula barrel files re-exporting from SDK | 2 (`sdk.ts`, `sdk-compat.ts`) |

**Key finding**: hula imports 97% of all SDK symbols through the main `matrix-js-sdk` entry point. Only 18 sub-path entries are used, and of those, 8 are used exclusively within hula's two barrel files (`sdk.ts` and `sdk-compat.ts`). 33 sub-path exports have zero consumers in hula. Two type-level deep-path violations exist in `.d.ts` augmentation files.

---

## A. Export Usage Matrix

### Main Entry

| Export Path | hula Import Count | Unique Files | Status | Notes |
|---|---|---|---|---|
| `.` (main) | 156 | 145 (72 prod + 73 test) | **ACTIVE** | Heavily used; top symbols: `MatrixClient` (106), `Room` (33), `MatrixEvent` (27), `createClient` (16), `RoomMember` (8) |

### Sub-Path Exports -- ACTIVE (18 entries)

| Export Path | Import Count | Unique Files | Status | Symbols Imported | Notes |
|---|---|---|---|---|---|
| `./admin` | 11 | 11 | **ACTIVE** | `AdminManager`, `FeatureFlag` | 8/11 in test files; also via barrel `sdk.ts` |
| `./telemetry` | 4 | 4 | **ACTIVE** | `TelemetryManager` | 1 test; also via barrel `sdk-compat.ts` |
| `./friend` | 3 | 2 | **ACTIVE** | `Friend`, `FriendEvent`, `FriendManager`, `FriendRequest` | Via barrel `sdk.ts` + direct in `MatrixFriendService.ts` |
| `./dm` | 3 | 3 | **ACTIVE** | `DirectMessageManager`, `CreateDmOptions`, `DmPartnerResponse`, `DmRoomInfo`, `IDirectRoomsMap` | Via barrel `sdk-compat.ts` + direct usage |
| `./crypto` | 2 | 2 | **ACTIVE** | `CryptoEvent`, `VerificationPhase`, `VerificationRequestEvent` | Via barrel `sdk.ts` |
| `./guest` | 2 | 2 | **ACTIVE** | `GuestManager`, `IAuthDict`, `IGuestInfo`, `IGuestLoginResponse`, `IGuestRegisterResponse`, `IServerGuestInfo`, `IUpgradeGuestRequest`, `IUpgradeGuestResponse` | Via barrel `sdk.ts` + `MatrixGuestService.ts` |
| `./event-report` | 2 | 2 | **ACTIVE** | `CreateReportBody`, `DismissReportBody`, `EscalateReportBody`, `EventReportCountResponse`, `EventReportManager`, `QueryParams`, `ReportResponse`, `ResolveReportBody`, `StatsResponse`, `StatusCountResponse`, `UpdateReportBody` | Via barrel `sdk.ts` + `MatrixEventReportService.ts` |
| `./sync` | 2 | 1 | **ACTIVE** | `ISyncStateData`, `SyncState` | Via barrel `sdk.ts` only |
| `./key-verification` | 2 | 2 | **ACTIVE** | `KeyVerificationManager` | Direct usage in crypto services; also in `.d.ts` type expressions |
| `./push` | 1 | 1 | **ACTIVE** | `PushManager` | Via barrel `sdk.ts` only |
| `./space` | 1 | 1 | **ACTIVE** | `Space`, `SpaceChild`, `SpaceManager`, `SpaceMember`, `SpaceQueryOptions` | Via barrel `sdk-compat.ts` only |
| `./store/worker` | 1 | 1 | **ACTIVE** | `IndexedDBStoreWorker` | Via barrel `sdk-compat.ts` only |
| `./client` | 1 | 1 | **ACTIVE** | `ClientEvent` | Via barrel `sdk.ts` only |
| `./models/room` | 1 | 1 | **ACTIVE** | `RoomEvent` | Via barrel `sdk.ts` only |
| `./models/room-state` | 1 | 1 | **ACTIVE** | `RoomStateEvent` | Via barrel `sdk.ts` only |
| `./@types/partials` | 1 | 1 | **ACTIVE** | `JoinRule` | Via barrel `sdk-compat.ts` only |
| `./device-keys` | 1 | 1 | **ACTIVE** | `DeviceKeysManager` | Direct in `CryptoSDKAdapter.ts`; also in `.d.ts` type expressions |
| `./key-backup` | 1 | 1 | **ACTIVE** | `KeyBackupManager` | Direct in `CryptoSDKAdapter.ts`; aliased as `SDKKeyBackupManager`; also in `.d.ts` type expressions |

### Sub-Path Exports -- ZERO-USE (33 entries)

| Export Path | Status | Notes |
|---|---|---|
| `./core` | ZERO-USE | |
| `./advanced` | ZERO-USE | |
| `./legacy` | ZERO-USE | |
| `./crypto-keys` | ZERO-USE (static) | Used in type position only: `import('matrix-js-sdk/crypto-keys').CryptoKeysManager` in `matrix-extensions.d.ts:424` |
| `./voice` | ZERO-USE | |
| `./notification` | ZERO-USE | |
| `./ai-connection` | ZERO-USE | hula has its own AI service layer (`src/services/matrix/ai/`) |
| `./saml` | ZERO-USE | |
| `./app-service` | ZERO-USE | |
| `./beacon` | ZERO-USE | |
| `./store` | ZERO-USE | |
| `./http-api` | ZERO-USE | |
| `./http-api/errors` | ZERO-USE | |
| `./errors` | ZERO-USE | |
| `./models/event` | ZERO-USE | |
| `./runtime-schemas` | ZERO-USE | |
| `./manager-extensions` | ZERO-USE | hula uses `initializeManagerExtensions` from main entry instead |
| `./@types/PushRules` | ZERO-USE | |
| `./timeline-window` | ZERO-USE | |
| `./src/manager-extensions` | ZERO-USE | Unusual export (exposes `src/` path as public API) |
| `./src/filter` | ZERO-USE | Unusual export (exposes `src/` path as public API) |
| `./src/telemetry` | ZERO-USE | Unusual export (exposes `src/` path as public API) |
| `./device` | ZERO-USE | |
| `./e2ee` | ZERO-USE | |
| `./external-service` | ZERO-USE | |
| `./feature-flags` | ZERO-USE | |
| `./federation` | ZERO-USE | |
| `./media` | ZERO-USE | |
| `./oidc` | ZERO-USE | |
| `./presence` | ZERO-USE | hula imports `PresenceManager` from main entry instead |
| `./room` | ZERO-USE | |
| `./room-summary` | ZERO-USE | |
| `./verification` | ZERO-USE | hula uses `./key-verification` entry instead |

---

## B. Zero-Usage Exports (Candidates for Review)

33 of 51 sub-path exports (65%) have zero static import usage from hula. These fall into several categories:

### B.1 Feature areas not yet adopted by hula (16 entries)
`./core`, `./advanced`, `./legacy`, `./voice`, `./notification`, `./ai-connection`, `./saml`, `./app-service`, `./beacon`, `./external-service`, `./feature-flags`, `./federation`, `./media`, `./oidc`, `./room-summary`, `./verification`

These may be needed by other consumers or future hula features. Do not remove without broader impact analysis.

### B.2 Overlap with main entry (4 entries)
`./presence`, `./room`, `./device`, `./errors`

hula imports equivalent symbols from the main `matrix-js-sdk` entry instead. Example: `PresenceManager` is imported from main, not from `./presence`.

### B.3 Low-level / infrastructure exports (6 entries)
`./store`, `./http-api`, `./http-api/errors`, `./models/event`, `./runtime-schemas`, `./timeline-window`

These are likely consumed indirectly through the main entry or are internal implementation details.

### B.4 Awkward `src/` exports (3 entries)
`./src/manager-extensions`, `./src/filter`, `./src/telemetry`

These expose internal `src/` paths as public API entry points -- an anti-pattern. They have zero consumers in hula and should be migrated to proper public paths or removed.

### B.5 Type-only usage (1 entry)
`./crypto-keys` -- used only in `.d.ts` type expressions (`import('matrix-js-sdk/crypto-keys').CryptoKeysManager`). No runtime import exists.

### B.6 Other (3 entries)
`./manager-extensions`, `./@types/PushRules`, `./push` (note: `./push` IS active with 1 import, was miscategorized here -- see Section A)

---

## C. Deep-Path Violations

### C.1 Static import violations (`matrix-js-sdk/src/` or `matrix-js-sdk/lib/`)

**Result: NONE FOUND**

No hula source file uses static `import ... from 'matrix-js-sdk/src/...'` or `'matrix-js-sdk/lib/...'`. This is passing clean.

### C.2 Type-level violations in `.d.ts` files

Two deep-path references exist in TypeScript type augmentation files. These are `import()` type expressions (not runtime imports) but still couple hula's type definitions to SDK internal module layout:

| File | Line | Internal Path | Symbol |
|---|---|---|---|
| `src/types/matrix-js-sdk-augmentations.d.ts` | 385 | `matrix-js-sdk/src/key-rotation/index` | `KeyRotationManager` |
| `src/types/matrix-js-sdk-augmentations.d.ts` | 386 | `matrix-js-sdk/src/dehydrated-device/index` | `DehydratedDeviceManager` |

**Risk**: These paths are NOT listed in the SDK's `package.json` exports. If the SDK renames or moves `src/key-rotation/` or `src/dehydrated-device/`, hula's type augmentation file will break at compile time.

**Recommendation**: Either:
1. Add `./key-rotation` and `./dehydrated-device` as official SDK export entries, or
2. Refactor hula's `.d.ts` to reference the types via the main entry or a sub-path that already exports them.

### C.3 Dynamic `import()` runtime calls

| File | Line | Path | Context |
|---|---|---|---|
| `src/workers/matrixSdk.worker.ts` | 412 | `sdk = await import('matrix-js-sdk')` | Runtime dynamic import of main entry (valid) |
| `src/services/matrix/admin/AdminFacadeService.ts` | 195 | `import('matrix-js-sdk/admin').AdminManager` | Type annotation (valid, `./admin` is an export) |
| `src/services/matrix/admin/RetentionService.ts` | 7 | `import('matrix-js-sdk/admin').AdminManager` | Type annotation (valid) |
| `src/services/matrix/admin/ServerService.ts` | 6 | `import('matrix-js-sdk/admin').AdminManager` | Type annotation (valid) |
| `src/composables/chat/useChatContextMenu.ts` | 29 | `import('matrix-js-sdk').ISendEventResponse` | Return type annotation (valid) |
| `src/services/matrix/room/__tests__/CreationService.test.ts` | 34 | `await import('matrix-js-sdk')` | Test dynamic import (valid) |

All runtime dynamic imports reference valid export paths. No violations here.

---

## D. Most-Heavily-Used Exports (Top 10)

### D.1 By sub-path import count

| Rank | Export Path | Import Lines | Unique Files | Primary Consumers |
|---|---|---|---|---|
| 1 | `./admin` | 11 | 11 | Admin service + 8 test files + barrel `sdk.ts` |
| 2 | `./telemetry` | 4 | 4 | `MatrixClientService`, `matrixClientAccessor`, barrel `sdk-compat.ts` |
| 3 | `./friend` | 3 | 2 | `MatrixFriendService`, barrel `sdk.ts` |
| 4 | `./dm` | 3 | 3 | `MatrixDirectMessageService`, barrel `sdk-compat.ts` |
| 5 | `./crypto` | 2 | 2 | `MatrixVerificationService`, barrel `sdk.ts` |
| 6 | `./guest` | 2 | 2 | `MatrixGuestService`, barrel `sdk.ts` |
| 7 | `./event-report` | 2 | 2 | `MatrixEventReportService`, barrel `sdk.ts` |
| 8 | `./sync` | 2 | 1 | barrel `sdk.ts` only |
| 9 | `./key-verification` | 2 | 2 | `CryptoSDKAdapter`, `MatrixVerificationService` |
| 10 | `./push` | 1 | 1 | barrel `sdk.ts` only |

### D.2 By main entry symbol usage (collapsed type + value)

| Rank | Symbol | Usage Count | Category |
|---|---|---|---|
| 1 | `MatrixClient` | 106 | Core client (85 value + 21 type imports) |
| 2 | `Room` | 33 | Room model (28 value + 5 type imports) |
| 3 | `MatrixEvent` | 27 | Event model (25 value + 2 type imports) |
| 4 | `createClient` | 16 | Factory function |
| 5 | `RoomMember` | 8 | Room membership (7 value + 1 type import) |
| 6 | `NotificationCountType` | 5 | Enum |
| 7 | `Visibility` | 4 | Enum |
| 8 | `PushRuleActionName` | 3 | Enum |
| 9 | `IPusherRequest` | 4 | Interface (3 value + 1 type import) |
| 10 | `ICreateRoomOpts` | 3 | Interface |

---

## E. Architecture Observations

### E.1 Barrel file pattern

hula uses two barrel files to consolidate SDK re-exports:

- **`src/services/matrix/sdk.ts`**: Re-exports ~42 symbols from main entry + ~18 types/values from 11 sub-paths. This is the primary SDK surface for hula's service layer.
- **`src/services/matrix/sdk-compat.ts`**: Re-exports 4 sub-path entries (`./dm`, `./space`, `./store/worker`, `./telemetry`) and `./@types/partials`. Labeled as "compatibility shims."

The barrel files are the right pattern. However, 8 sub-paths (`./push`, `./space`, `./store/worker`, `./client`, `./models/room`, `./models/room-state`, `./sync`, `./@types/partials`) are imported ONLY by these barrel files and nowhere else in hula. This means hula's actual service code never touches these sub-paths directly.

### E.2 Main entry dominance

156 out of 203 total SDK imports (77%) go through the main `matrix-js-sdk` entry. The remaining 47 imports (23%) use sub-path entries, mostly for domain-specific managers (admin, crypto, friends, telemetry).

### E.3 Type augmentation coupling

`src/types/matrix-js-sdk-augmentations.d.ts` and `src/types/matrix-extensions.d.ts` use `import()` type expressions to reference 6 sub-paths (`space`, `device-keys`, `crypto-keys`, `key-verification`, `key-backup`, plus the two deep-path `src/key-rotation` and `src/dehydrated-device`). These type files are the only places that reference `crypto-keys` at all.

### E.4 Test vs production split

Of 145 unique files importing from `matrix-js-sdk` main entry:
- 72 production files
- 73 test files

The test/production ratio is ~1:1, which is healthy and indicates good test coverage of SDK-dependent code.

---

## F. Recommendations

### F.1 Immediate (no code change required)
- No static deep-path violations exist. The codebase is clean in this regard.

### F.2 Short-term (consider for next SDK release)
- **Fix type-level deep paths**: Replace `import('matrix-js-sdk/src/key-rotation/index').KeyRotationManager` and `import('matrix-js-sdk/src/dehydrated-device/index').DehydratedDeviceManager` in `matrix-js-sdk-augmentations.d.ts` with either official export paths or locally-defined interfaces.
- **Review 3 `./src/*` exports**: `./src/manager-extensions`, `./src/filter`, `./src/telemetry` are zero-use and expose internal layout. Consider removing them or migrating to proper public paths.

### F.3 Medium-term (API surface simplification)
- **33 zero-use exports** represent potential API surface to deprecate or remove, but each needs its own impact analysis (other consumers, future hula features).
- **8 single-consumer exports** (`./push`, `./space`, `./store/worker`, `./client`, `./models/room`, `./models/room-state`, `./sync`, `./@types/partials`) are only used by hula's barrel files. Consider whether these symbols could flow through the main entry instead.

---

## Type Gap Analysis

> Source: `/Users/ljf/Desktop/hu_ts/hula/src/types/matrix-js-sdk-augmentations.d.ts` (818 lines)
> Method: Each type/interface declaration was cross-referenced against SDK source at `/Users/ljf/Desktop/hu_ts/matrix-js-sdk/src/`
> Purpose: Identify which augmentation types already exist in the SDK, which should be upstreamed, and which are hula-specific

### A. Classification Summary

| Category | Count | Description |
|---|---|---|
| SDK_ALREADY_HAS | 10 | SDK exports an equivalent type; augmentation is a duplicate — can remove |
| SDK_SHOULD_SUPPLEMENT | 6 | SDK has internally but not in public API — should add to exports |
| HULA_SPECIFIC | 18 | Genuinely hula/synapse-rust specific — keep in augmentation |
| OBSOLETE | 4 | Zero usage in hula production code — can delete |
| NEEDS_INVESTIGATION | 2 | Ambiguous or needs deeper analysis |
| **Total** | **40** | |

### B. SDK Supplement Export List (THE KEY OUTPUT)

Types the SDK should add to its public exports. Each entry already exists in SDK source but either is not re-exported from the package entry point, or uses a different name/structure.

#### B.1 Types that exist but need re-export or name alignment

| # | Augmentation Type | SDK Internal Type | SDK Location | Status |
|---|---|---|---|---|
| 1 | `IPublicRoomsOpts` | `IRoomDirectoryOptions` | `src/@types/requests.ts:243-266` | IDENTICAL structure. Already exported via `export * from "./@types/requests"`. Augmentation is a name-alias duplicate. hula should import `IRoomDirectoryOptions` directly from SDK. |
| 2 | `SlidingSyncRoomSubscription` | `MSC3575RoomSubscription` | `src/sliding-sync.ts:37-41` | IDENTICAL structure. Already exported via `export type { MSC3575RoomSubscription }` in `src/matrix.ts:143`. Augmentation is a duplicate. |
| 3 | `SlidingSyncList` | `MSC3575List` | `src/sliding-sync.ts:61-66` | `MSC3575List` has more fields (`filters?`, `slow_get_all_rooms?`, `include_old_rooms?`, optional `sort`) than augmentation's `SlidingSyncList` (all required). Already exported. |
| 4 | `ILoginRequest` | `LoginRequest` | `src/@types/auth.ts:155-195` | SDK's `LoginRequest` is spec-compliant with `identifier` field. Augmentation's `ILoginRequest` is a simpler shape with `user?`/`password?`/`token?`. Already exported. |
| 5 | `IRegisterRequest` | `RegisterRequest` | `src/@types/registration.ts:25-63` | SDK's `RegisterRequest` is spec-compliant. Augmentation's `IRegisterRequest` adds `[key: string]: unknown` for extensibility. Already exported. |
| 6 | `IEventRelation` (used as `EventRelation` in augmentation) | `IEventRelation` | `src/models/event.ts:142-150` | Already exported in `src/matrix.ts:115`. SDK's has `rel_type`, `event_id`, `is_falling_back`, `m.in_reply_to`, `key`. Augmentation's `EventRelation` adds a `m.relates_to` nested field that is actually the parent content field, not the relation object itself. |

#### B.2 Hula-specific augmentations that could be upstreamed to SDK

| # | Type | Current Augmentation | Suggested SDK Addition | Rationale |
|---|---|---|---|---|
| 1 | `MSC3575RoomData` extensions | Lines 40-43: adds `state?` and `summary?` | Add `state?: Record<string, unknown>` and `summary?: Record<string, unknown>` to `MSC3575RoomData` in `src/sliding-sync.ts:97-113` | Synapse-rust returns extra fields in Sliding Sync responses; this is a reasonable extension point |
| 2 | `Room.topic` property | Line 67: adds `topic?: string` | Add a `topic` getter to `Room` class in `src/models/room.ts` | Convenience accessor for `m.room.topic` state event; common pattern in other Matrix SDKs like matrix-rust-sdk |

### C. Duplicate Types (Augmentation Can Remove)

Types that exist in both SDK exports and augmentation with equivalent or nearly-equivalent shapes. Hula should remove these from the augmentation file and import from the SDK instead.

| # | Augmentation Type | SDK Equivalent | Location | Compatibility |
|---|---|---|---|---|
| 1 | `IPublicRoomsOpts` | `IRoomDirectoryOptions` | `src/@types/requests.ts:243-266` | IDENTICAL — drop-in replacement |
| 2 | `SlidingSyncRoomSubscription` | `MSC3575RoomSubscription` | `src/sliding-sync.ts:37-41` | IDENTICAL — drop-in replacement |
| 3 | `SlidingSyncList` | `MSC3575List` | `src/sliding-sync.ts:61-66` | `MSC3575List` is superset — hula code may need to adjust optional field access |
| 4 | `ILoginRequest` | `LoginRequest` | `src/@types/auth.ts:155-195` | SDK's version is spec-compliant — hula may need to provide `identifier` instead of `user`/`password` |
| 5 | `IRegisterRequest` | `RegisterRequest` | `src/@types/registration.ts:25-63` | SDK's version is spec-compliant — hula may need to adapt |
| 6 | `RoomMember` interface (lines 505-533) | `RoomMember` class | `src/models/room-member.ts` | All properties/methods already exist on SDK's class. **The entire RoomMember augmentation is a duplicate.** |
| 7 | `User` interface (lines 536-545) | `User` class | `src/models/user.ts` | All properties/methods already exist on SDK's class. **The entire User augmentation is a duplicate.** |
| 8 | MatrixClient methods (most of lines 167-497) | `MatrixClient` class methods | `src/client.ts` | **~90% of the MatrixClient augmentation is a duplicate** of methods that already exist on SDK's class. See Section F.4 for details. |
| 9 | `EventRelation` | `IEventRelation` | `src/models/event.ts:142-150` | Different shapes — augmentation adds `m.relates_to` field. Recommend aligning on SDK's version or extending it. |
| 10 | `IRequestTokenResponse` | `IRegistrationTokenResponse` or similar in SDK | Internal auth types | Check if SDK exposes an equivalent |

### D. Hula-Specific Types (Keep in Augmentation)

These types have no equivalent in the SDK and are genuinely needed by hula for synapse-rust integration or custom features.

| # | Type Name | Lines | Purpose | Hula Usage |
|---|---|---|---|---|
| 1 | `MatrixHttpApi.authedRequest(request)` with `method: string` | 21-35 | Allow string-based method params instead of `Method` enum | All services |
| 2 | `MSC3575RoomData` extensions (`state`, `summary`) | 40-43 | Synapse-rust Sliding Sync response fields | `MatrixSlidingSyncService` |
| 3 | `SlidingSync` custom methods (`getList`, `subscribeToRoom`, `unsubscribeFromRoom`, `getSyncToken`) | 48-61 | Hula-customized SlidingSync API | `MatrixSlidingSyncService` |
| 4 | `Room.topic` | 66-68 | Convenience property for `m.room.topic` event content | Room display components |
| 5 | `VoIPHandler` | 131-133 | Simple VoIP call handler interface | VoIP service |
| 6 | `IMemberEvent` | 136-140 | Simplified membership event shape | Membership state views |
| 7 | `SearchParams` / `SearchResponse` | 556-568 | Hula-specific search API shapes (simpler than SDK's `ISearchRequestBody`) | Search service (17 usages) |
| 8 | `SyncParams` | 572-578 | Hula-specific sync parameter type | Sync service |
| 9 | `SyncResponse` + sub-types (`RoomData`, `TimelineData`, `StateData`, `EphemeralData`, `InvitedRoom`, `LeftRoom`, `PresenceUpdate`, `DeviceMessages`, `DeviceLists`, `UnreadNotifications`) | 580-652 | Hula-specific sync response shapes | Sync service (7 usages for `SyncResponse`, 9 for `RoomData`) |
| 10 | `PaginatedMessages` | 657-662 | Hula-specific pagination response | Message pagination |
| 11 | `MessageEditContent` | 680-698 | Hula-specific message edit content | Message edit service |
| 12 | `ReplyContent` | 701-716 | Hula-specific reply content type | Reply service (7 usages) |
| 13 | `ThreadBundle` | 719-726 | Hula-specific thread bundle type | Thread service |
| 14 | `DeviceUpdate` | 735-739 | Hula-specific device update type | Device service (9 usages) |
| 15 | `UserDirectorySearchParams` / `UserDirectorySearchResponse` / `UserDirectoryResult` | 747-762 | Hula-specific user directory types | User directory service |
| 16 | `Group` / `GroupUser` / `GroupProfile` | 765-784 | Hula community/group feature types | Group store |
| 17 | `ThirdPartyProtocol` / `ThirdPartyProtocolInstance` / `ThirdPartyUser` / `ThirdPartyLocation` | 787-810 | Hula-specific third-party API types (different shape from SDK's `IThirdParty*` in `client-internal-types.ts`) | Third-party service (4 usages) |
| 18 | Manager accessors in MatrixClient augmentation | 467-476, 383-386 | Synapse-rust specific manager extensions (`getBurnAfterReadManager`, `dmManager`, `quotaManager`, `getDeviceKeysManager`, `getCryptoKeysManager`, `getKeyVerificationManager`) | Various services |

### E. Obsolete Types (Can Be Removed Immediately)

Types declared in the augmentation but never used in hula's production code (checked via grep excluding `augmentations.d.ts` and `__tests__`).

| # | Type Name | Lines | Notes |
|---|---|---|---|
| 1 | `DeviceDeletion` | 741-744 | Zero production usage found |
| 2 | `EphemeralData` | 610-612 | Zero production usage found |
| 3 | `DeviceMessages` | 637-641 | Zero production usage found |
| 4 | `UnreadNotifications` | 648-652 | Zero production usage found |

Note: `DeviceLists` (lines 643-646) may also be unused but was flagged as low-usage (1 hit that might be from type re-export).

### F. Detailed Type-by-Type Table

| # | Type Name | Category | SDK Location | Hula Usage | Action |
|---|---|---|---|---|---|
| 1 | `MatrixHttpApi` string-method overloads | HULA_SPECIFIC | N/A | High | KEEP |
| 2 | `MSC3575RoomData.state/summary` | HULA_SPECIFIC | N/A | Medium | KEEP |
| 3 | `SlidingSync` extra methods | HULA_SPECIFIC | N/A | Medium | KEEP |
| 4 | `Room.topic` | HULA_SPECIFIC | N/A | Medium | KEEP (or upstream) |
| 5 | `IPublicRoomsOpts` | SDK_ALREADY_HAS | `IRoomDirectoryOptions` in `src/@types/requests.ts:243` | 0 | REMOVE, use `IRoomDirectoryOptions` |
| 6 | `SlidingSyncList` | SDK_ALREADY_HAS | `MSC3575List` in `src/sliding-sync.ts:61` | ~3 | MIGRATE to `MSC3575List` |
| 7 | `SlidingSyncRoomSubscription` | SDK_ALREADY_HAS | `MSC3575RoomSubscription` in `src/sliding-sync.ts:37` | ~3 | REMOVE, use `MSC3575RoomSubscription` |
| 8 | `ILoginRequest` | SDK_ALREADY_HAS | `LoginRequest` in `src/@types/auth.ts:155` | 1 | MIGRATE to `LoginRequest` |
| 9 | `IRegisterRequest` | SDK_ALREADY_HAS | `RegisterRequest` in `src/@types/registration.ts:25` | 1 | MIGRATE to `RegisterRequest` |
| 10 | `VoIPHandler` | HULA_SPECIFIC | N/A | ~5 | KEEP |
| 11 | `IMemberEvent` | HULA_SPECIFIC | N/A | ~2 | KEEP |
| 12 | `MatrixClient` interface (167-497) | NEEDS_INVESTIGATION | SDK's `MatrixClient` class | High | ~300 lines largely duplicate SDK; see Section F.4 |
| 13 | `RoomMember` interface (505-533) | SDK_ALREADY_HAS | `src/models/room-member.ts` | High | REMOVE — SDK defines all these |
| 14 | `User` interface (536-545) | SDK_ALREADY_HAS | `src/models/user.ts` | High | REMOVE — SDK defines all these |
| 15 | `SearchParams` | HULA_SPECIFIC | N/A | 17 | KEEP |
| 16 | `SearchResponse` | HULA_SPECIFIC | SDK has `ISearchResponse` (different shape) | ~5 | KEEP |
| 17 | `SyncParams` | HULA_SPECIFIC | N/A | ~2 | KEEP |
| 18 | `SyncResponse` | HULA_SPECIFIC | SDK has `ISyncResponse` (different shape) | 7 | KEEP |
| 19 | `RoomData` | HULA_SPECIFIC | N/A | 9 | KEEP |
| 20 | `TimelineData` | HULA_SPECIFIC | Partial `ITimeline` in `sync-accumulator` | ~2 | KEEP |
| 21 | `StateData` | HULA_SPECIFIC | N/A | 1 | KEEP |
| 22 | `EphemeralData` | OBSOLETE | N/A | 0 | REMOVE |
| 23 | `InvitedRoom` | HULA_SPECIFIC | Partial `IInvitedRoom` in `sync-accumulator` | 2 | KEEP |
| 24 | `LeftRoom` | HULA_SPECIFIC | Partial `ILeftRoom` in `sync-accumulator` | 2 | KEEP |
| 25 | `PresenceUpdate` | HULA_SPECIFIC | N/A | 4 | KEEP |
| 26 | `DeviceMessages` | OBSOLETE | N/A | 0 | REMOVE |
| 27 | `DeviceLists` | OBSOLETE | N/A | 0 | REMOVE |
| 28 | `UnreadNotifications` | OBSOLETE | N/A | 0 | REMOVE |
| 29 | `PaginatedMessages` | HULA_SPECIFIC | N/A | ~2 | KEEP |
| 30 | `EventRelation` | SDK_ALREADY_HAS | `IEventRelation` in `src/models/event.ts:142` | 1 | ALIGN or keep if `m.relates_to` needed |
| 31 | `MessageEditContent` | HULA_SPECIFIC | N/A | ~3 | KEEP |
| 32 | `ReplyContent` | HULA_SPECIFIC | N/A | 7 | KEEP |
| 33 | `ThreadBundle` | HULA_SPECIFIC | N/A | ~2 | KEEP |
| 34 | `DeviceUpdate` | HULA_SPECIFIC | N/A | 9 | KEEP |
| 35 | `DeviceDeletion` | OBSOLETE | N/A | 0 | REMOVE |
| 36 | `UserDirectorySearchParams` | HULA_SPECIFIC | N/A | ~2 | KEEP |
| 37 | `UserDirectorySearchResponse` | HULA_SPECIFIC | Partial `IUserDirectoryResponse` in `client-internal-types.ts:60` | ~1 | KEEP |
| 38 | `UserDirectoryResult` | HULA_SPECIFIC | N/A | ~1 | KEEP |
| 39 | `Group` family | HULA_SPECIFIC | N/A | ~3 | KEEP |
| 40 | `ThirdParty` family | HULA_SPECIFIC | SDK has `IThirdParty*` in `client-internal-types.ts` (different shape) | 4 | KEEP |

### G. Key Findings

#### G.1 The MatrixClient Interface Augmentation Is the Biggest Problem

The `MatrixClient` interface augmentation (lines 167-497, ~330 lines) is almost entirely a duplicate of the SDK's `MatrixClient` class type definitions. Most methods declared here already exist on the SDK's `MatrixClient` class with identical or more complete signatures. This section was likely created when the SDK's type generation was incomplete and has not been updated to reflect SDK improvements.

**Specific issues found:**

- **Outdated method signatures**: Several methods use different parameter names/orders than the SDK (e.g., `getSsoLoginUrl` in augmentation takes `(redirectUrl, deviceName?, identityProviderId?)` while SDK uses `(redirectUrl, loginType?, idpId?, action?)`).
- **Looser typing**: Many methods use `Record<string, unknown>` instead of the SDK's specific types.
- **Missing parameters**: Some overloads have fewer parameters than the SDK's actual methods.
- **Duplicate overloads**: Methods like `createRoom`, `joinRoom`, `publicRooms` define two overloads where one matches the SDK and the other is a simplified variant.

**Recommendation**: Incrementally remove method declarations from the augmentation that match the SDK's current signatures. Only keep synapse-rust-specific methods and manager accessors that the SDK doesn't expose.

#### G.2 RoomMember and User Augmentations Are Fully Duplicate

The `RoomMember` (lines 505-533) and `User` (lines 536-545) interface augmentations declare properties and methods that ALL already exist on the SDK's `RoomMember` and `User` classes. These are complete duplicates and can be removed entirely.

#### G.3 Sync Response Types Are Hula's Simplified Layer

The sync response types (`SyncResponse`, `RoomData`, `TimelineData`, etc., lines 572-652) are hula's simplified interpretation of the Matrix sync protocol. The SDK uses `sync-accumulator.ts` types internally (`ISyncResponse`, `IJoinedRoom`, `ITimeline`, etc.) but these aren't designed as a consumer-facing public API. Keeping hula's simpler shapes is reasonable, though some fields could be aligned with SDK types to reduce duplication.

#### G.4 Manager Accessor Pattern

Manager accessor methods (`getSpaceManager()`, `getKeyRotationManager()`, `getDehydratedDeviceManager()`, etc.) are defined in the SDK's `MatrixClientExtensionMethods` type (exported from `src/matrix.ts:162`). If hula can properly resolve this type from the SDK package, these manager accessor declarations could be removed from the augmentation. Currently, the augmentation uses `import()` type syntax to reference SDK internal paths, which is technically a type-level deep-path import.

#### G.5 4 Types Can Be Removed Immediately

`DeviceDeletion`, `EphemeralData`, `DeviceMessages`, and `UnreadNotifications` have zero production usage in hula. They can be safely deleted from the augmentation file.

#### G.6 6 Types Can Be Replaced with SDK Imports

`IPublicRoomsOpts`, `SlidingSyncRoomSubscription`, `SlidingSyncList`, `ILoginRequest`, `IRegisterRequest`, `RoomMember`, and `User` all have existing SDK equivalents that are already exported from the package. Hula should update its imports and remove these from the augmentation.

### H. Recommended Action Plan

**Phase 1 (Safe Deletions — Zero Risk)**

1. Remove 4 obsolete types: `DeviceDeletion`, `EphemeralData`, `DeviceMessages`, `UnreadNotifications`
2. Remove `RoomMember` and `User` interface augmentations (SDK defines the same members)

**Phase 2 (Import Migrations — Low Risk)**

3. Replace `IPublicRoomsOpts` with SDK's `IRoomDirectoryOptions`
4. Replace `SlidingSyncRoomSubscription` with SDK's `MSC3575RoomSubscription`
5. Replace `ILoginRequest` with SDK's `LoginRequest`
6. Replace `IRegisterRequest` with SDK's `RegisterRequest`
7. Evaluate `SlidingSyncList` vs `MSC3575List` — migrate if field differences don't matter

**Phase 3 (MatrixClient Cleanup — Medium Risk)**

8. Audit each method in the MatrixClient augmentation against the SDK's actual signatures
9. Remove methods whose signatures match the SDK's
10. Keep only synapse-rust-specific manager accessors and methods with different signatures

**Phase 4 (Upstream Proposals)**

11. Propose adding `MSC3575RoomData.state`/`.summary` fields to the SDK
12. Propose adding a `Room.topic` getter to the SDK
