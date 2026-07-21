# SDK-Frontend Export Usage Matrix

> Generated: 2026-07-21
> Audits: D.3 Manager Usage Matrix + F.1 Frontend API Usage Table
> Sources: `matrix-js-sdk/package.json` (52 export entries, 114 registered managers) vs `hula/src/` (197 SDK import statements)

---

## Zero-usage Export Entries

The following 33 export entries in `package.json` have **zero** hula imports (`from 'matrix-js-sdk/<entry>'`):

| # | Export Entry | Notes |
|---|---|---|
| 1 | `./core` | Core module not used standalone |
| 2 | `./advanced` | Advanced features |
| 3 | `./legacy` | Legacy support |
| 4 | `./crypto-keys` | Used only in `.d.ts` type position: `import('matrix-js-sdk/crypto-keys')` |
| 5 | `./voice` | Voice module |
| 6 | `./notification` | Notification module |
| 7 | `./ai-connection` | AI connection |
| 8 | `./saml` | SAML auth |
| 9 | `./app-service` | App service |
| 10 | `./beacon` | Beacon/location |
| 11 | `./store` | Storage (uses `./store/worker` only) |
| 12 | `./http-api` | HTTP API utilities |
| 13 | `./http-api/errors` | HTTP error types |
| 14 | `./errors` | Error types |
| 15 | `./models/event` | Event models |
| 16 | `./runtime-schemas` | Runtime schemas |
| 17 | `./manager-extensions` | Manager extensions API |
| 18 | `./@types/PushRules` | Push rules types |
| 19 | `./timeline-window` | Timeline window |
| 20 | `./src/manager-extensions` | Anti-pattern: exposes `src/` path as public API |
| 21 | `./src/filter` | Anti-pattern: exposes `src/` path as public API |
| 22 | `./src/telemetry` | Anti-pattern: exposes `src/` path as public API |
| 23 | `./device` | Device module |
| 24 | `./e2ee` | E2EE module |
| 25 | `./external-service` | External service |
| 26 | `./feature-flags` | Feature flags |
| 27 | `./federation` | Federation module |
| 28 | `./media` | Media module |
| 29 | `./oidc` | OIDC module |
| 30 | `./presence` | hula imports `PresenceManager` from main entry instead |
| 31 | `./room` | Room module |
| 32 | `./room-summary` | Room summary |
| 33 | `./verification` | hula uses `./key-verification` entry instead |

**Active export entries (19):** `.` (main, 157 imports), `./admin` (11), `./telemetry` (4), `./friend` (3), `./dm` (3), `./crypto` (2), `./guest` (2), `./event-report` (2), `./sync` (2), `./key-verification` (2), `./push` (1), `./space` (1), `./store/worker` (1), `./client` (1), `./models/room` (1), `./models/room-state` (1), `./@types/partials` (1), `./device-keys` (1), `./key-backup` (1)

---

## Deep-path Violations

### Static imports from `matrix-js-sdk/src/` or `matrix-js-sdk/lib/` in production code

**Result: NONE FOUND** -- No hula production file uses static `import ... from 'matrix-js-sdk/src/...'`.

### Type-level violations in `.d.ts` files

Two deep-path references exist in hula's type augmentation files. These are `import()` type expressions, not runtime imports:

| File | Line | Internal Path | Symbol |
|---|---|---|---|
| `hula/src/types/matrix-js-sdk-augmentations.d.ts` | 368 | `matrix-js-sdk/src/key-rotation/index` | `KeyRotationManager` |
| `hula/src/types/matrix-js-sdk-augmentations.d.ts` | 369 | `matrix-js-sdk/src/dehydrated-device/index` | `DehydratedDeviceManager` |

**Risk**: These paths are NOT listed in the SDK's `package.json` exports. If the SDK renames or moves these directories, hula's type check will break.

**Recommendation**: Add `./key-rotation` and `./dehydrated-device` as official SDK export entries, or refactor hula's `.d.ts` to use locally-defined interfaces.

**Count: 2 violations (type-only, not production code).**

---

## SDK补导出清单 (Augmentations That Could Move to SDK Exports)

Analysis of `hula/src/types/matrix-js-sdk-augmentations.d.ts` (1921 lines). See also existing Type Gap Analysis sections below for detailed categorization.

### Types that already exist in SDK but not exported from main (6 types)

| # | Augmentation Type | SDK Internal Equivalent | SDK Location | Status |
|---|---|---|---|---|
| 1 | `IPublicRoomsOpts` | `IRoomDirectoryOptions` | `src/@types/requests.ts` | Identical structure -- already exported |
| 2 | `ISendEventResponse` | `ISendEventResponse` | `src/@types/requests.ts` | Already defined, not exported from entry |
| 3 | `ICreateRoomOpts` | `ICreateRoomOpts` | `src/@types/requests.ts` | Already defined, not exported from entry |
| 4 | `IPushRule` / `IPushRules` | `IPushRule` / `IPushRules` | `src/@types/PushRules.ts` | Already defined, not exported from main |
| 5 | `SlidingSyncRoomSubscription` | `MSC3575RoomSubscription` | `src/sliding-sync.ts` | Identical -- already exported |
| 6 | `SlidingSyncList` | `MSC3575List` | `src/sliding-sync.ts` | Superset in SDK |

### Hula-specific types that could be upstreamed (15 type categories)

| # | Type Category | Suggested SDK Addition |
|---|---|---|
| 1 | `ILoginRequest` / `IRegisterRequest` | Add broader auth request shapes to SDK |
| 2 | `VoIPHandler` | VoIP call handler interface |
| 3 | `IMemberEvent` | Simplified member event shape |
| 4 | `SearchParams` / `SearchResponse` | Search parameter and response types |
| 5 | `SyncParams` / `SyncResponse` + sub-types | Sync protocol types |
| 6 | `RoomData` / `TimelineData` / `StateData` / `EphemeralData` | Sync response sub-types |
| 7 | `InvitedRoom` / `LeftRoom` | Sync room state shapes |
| 8 | `PresenceUpdate` | Presence update shape |
| 9 | `PaginatedMessages` | Pagination result type |
| 10 | `EventRelation` | Event relation shape |
| 11 | `MessageEditContent` | Message edit content |
| 12 | `ReplyContent` | Reply content shape |
| 13 | `ThreadBundle` | Thread bundle type |
| 14 | `DeviceUpdate` / `DeviceDeletion` | Device management shapes |
| 15 | `UserDirectorySearchParams` / `UserDirectorySearchResponse` | User directory types |
| 16 | `Group` / `GroupUser` / `GroupProfile` | Community/group types |
| 17 | `ThirdParty` family types | Third-party network types |

### Large MatrixClient augmentation (lines 150-480, ~330 lines)

~60 method signatures that largely duplicate SDK's `MatrixClient` class. Root cause: SDK's use of nominal `Method` enum vs hula's preference for string literals. Most of this block could be eliminated if the SDK adds string-literal overloads.

### RoomMember and User augmentations (lines 487-527)

**Completely duplicates** the SDK's `RoomMember` and `User` classes. All properties/methods already exist in the SDK. Can be removed entirely.

### hula-specific extensions that should NOT move to SDK

1. `MSC3575RoomData.state` / `.summary` -- hula-specific sliding sync field expectations
2. `SlidingSync.getList()` / `.subscribeToRoom()` / `.unsubscribeFromRoom()` -- hula-custom methods
3. `Room.topic` -- convenience property (SDK provides via `currentState`)

**Total augmentations that could move to SDK: ~30 type categories + ~60 MatrixClient method overloads + 2 duplicate interface blocks.**

---

## Manager Usage Matrix

Audit of all 114 managers registered in `src/client-infra/manager-registry.ts`.
Column definitions:
- **SDK Files**: Number of files in `src/` referencing the manager name
- **Hula Files**: Number of files in `hula/src/` referencing the manager name
- **Tests**: Whether test files exist in `spec/`
- **Contract**: Whether a corresponding contract route exists in `docs/api-contract/generated/modules/`
- **Status**: Active (has hula or contract), Zombie (0 hula + minimal SDK + no contract), Deprecated (has @deprecated), Dormant (has contract but 0 hula)

| Manager | SDK Files | SDK Lines | Hula Files | Hula Lines | Tests | Depr. | Contract | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| account | 79 | 502 | 158 | 661 | Y | Y | N | **Deprecated** | @deprecated in src/account/index.ts |
| accountData | 14 | 97 | 9 | 29 | Y | N | Y | Active | Contract: account_data |
| admin | 53 | 576 | 144 | 2618 | Y | N | Y | Active | Heavy hula usage (admin panel) |
| aggregations | 7 | 13 | 3 | 5 | Y | N | N | Active | Low but existing usage |
| aiConnection | 3 | 6 | 3 | 5 | Y | N | Y | Active | Contract: ai_connection |
| auth | 145 | 911 | 177 | 883 | Y | N | N | Active | Heavy usage |
| authGlobalLogout | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| backgroundUpdate | 2 | 4 | 0 | 0 | N | N | Y | Dormant | Contract: background_update; no hula use |
| beacon | 15 | 140 | 17 | 125 | Y | N | N | Active | Has hula usage |
| BurnAfterReadManager | 4 | 36 | 3 | 3 | Y | N | Y | Active | Contract: burn_after_read |
| capabilities | 30 | 160 | 27 | 131 | Y | N | N | Active | Has hula usage |
| captcha | 9 | 56 | 13 | 318 | Y | N | Y | Active | Contract: captcha |
| cas | 90 | 434 | 111 | 540 | Y | N | Y | Active | Contract: cas |
| crossSigning | 9 | 51 | 19 | 107 | Y | N | N | Active | Has hula usage |
| cryptoBackup | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| cryptoEncryption | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| cryptoKeys | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| cryptoStore | 7 | 14 | 0 | 0 | Y | N | N | Dormant | 7 SDK files, no hula/contract |
| dehydratedDevice | 5 | 25 | 1 | 1 | Y | N | N | Dormant | Minimal hula ref (1 type-only) |
| device | 136 | 1734 | 149 | 1752 | Y | N | Y | Active | Contract: device; heavy usage |
| deviceKeys | 6 | 24 | 1 | 5 | Y | N | N | Active | Used via sub-path export |
| deviceTrust | 2 | 20 | 3 | 4 | Y | N | N | Active | Has hula usage |
| directory | 18 | 90 | 11 | 56 | Y | N | N | Active | Has hula usage |
| discovery | 22 | 48 | 17 | 78 | Y | N | N | Active | Has hula usage |
| dm | 71 | 1401 | 204 | 4114 | Y | N | Y | Active | Contract: dm; heavy usage |
| e2ee | 18 | 27 | 8 | 42 | Y | N | Y | Active | Contract: e2ee |
| ephemeral | 22 | 65 | 8 | 15 | Y | N | Y | Active | Contract: ephemeral |
| event | 265 | 6420 | 436 | 3073 | Y | N | N | Active | Core event manager; heavy usage |
| eventProcessing | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| eventReport | 2 | 4 | 3 | 15 | N | N | Y | Active | Contract: event_report |
| eventStatus | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| external-service | 6 | 9 | 1 | 1 | Y | N | Y | Active | Contract: external_service |
| featureFlags | 2 | 4 | 4 | 12 | Y | N | Y | Active | Contract: feature_flags |
| federation | 19 | 133 | 19 | 143 | Y | N | Y | Active | Contract: federation |
| filter | 96 | 560 | 300 | 1046 | Y | N | N | Active | Heavy usage |
| friend | 59 | 242 | 120 | 1384 | Y | N | Y | Active | Contract: friend_room; heavy usage |
| guest | 36 | 148 | 21 | 120 | Y | N | Y | Active | Contract: guest |
| identity | 45 | 244 | 40 | 153 | Y | N | N | Active | Has hula usage |
| identityServer | 10 | 27 | 30 | 110 | Y | N | N | Active | Has hula usage |
| inviteBlocklist | 2 | 4 | 2 | 12 | N | N | N | Active | Has 2 hula refs |
| invites | 18 | 70 | 5 | 12 | Y | N | N | Active | Has hula usage |
| keyBackup | 7 | 42 | 14 | 109 | Y | N | Y | Active | Contract: key_backup |
| keyForwarding | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| keyRotation | 4 | 10 | 0 | 0 | Y | N | Y | Dormant | Contract: key_rotation; no hula |
| keyVerification | 2 | 4 | 0 | 0 | N | N | Y | Dormant | Contract: verification_routes; no hula |
| lifecycle | 14 | 40 | 10 | 18 | Y | N | N | Active | Has hula usage |
| media | 84 | 534 | 211 | 711 | Y | N | Y | Active | Contract: media; heavy usage |
| mediaQuota | 2 | 11 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| membership | 57 | 535 | 49 | 112 | Y | N | N | Active | Has hula usage |
| moderation | 5 | 11 | 20 | 108 | Y | N | Y | Active | Contract: moderation |
| module | 158 | 515 | 45 | 64 | Y | N | Y | Active | Contract: module |
| notifications | 32 | 109 | 66 | 371 | Y | N | N | Active | Has hula usage |
| oidc | 19 | 88 | 12 | 87 | Y | Y | Y | **Deprecated** | @deprecated in src/oidc/manager.ts |
| openclaw | 10 | 45 | 10 | 85 | Y | N | Y | Active | Contract: openclaw |
| passwordReset | 2 | 4 | 0 | 0 | Y | N | N | **Zombie** | Bare definition only |
| pinnedMessages | 2 | 4 | 1 | 6 | N | N | N | Active | 1 hula ref |
| presence | 37 | 267 | 41 | 238 | Y | N | Y | Active | Contract: presence |
| profile | 70 | 211 | 50 | 371 | Y | N | N | Active | Has hula usage |
| push | 112 | 687 | 274 | 1014 | Y | N | Y | Active | Contract: push; heavy usage |
| pushNotifications | 2 | 4 | 2 | 3 | N | N | Y | Active | Contract: push_notification |
| pushRules | 9 | 34 | 3 | 14 | Y | N | N | Active | Has hula usage |
| qrLogin | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| reactions | 8 | 27 | 12 | 39 | Y | N | Y | Active | Contract: reactions |
| readReceipts | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| relations | 34 | 155 | 3 | 15 | Y | N | Y | Active | Contract: relations |
| rendezvous | 14 | 86 | 13 | 103 | Y | N | Y | Active | Contract: rendezvous |
| reporting | 6 | 9 | 2 | 2 | Y | N | N | Active | Has hula usage |
| retention | 11 | 44 | 14 | 80 | Y | N | N | Active | Has hula usage |
| room | 287 | 7086 | 607 | 9685 | Y | N | Y | Active | Contract: room; heaviest usage |
| roomAccountData | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| roomCreation | 2 | 4 | 1 | 2 | N | N | N | Dormant | 1 hula ref |
| roomEvents | 5 | 19 | 2 | 5 | Y | N | N | Active | Has hula usage |
| roomJoining | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| roomKeySharing | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| roomKeys | 3 | 6 | 2 | 5 | Y | N | N | Active | Has hula usage |
| roomList | 2 | 4 | 20 | 57 | Y | N | N | Dormant | hula refs likely general pattern matches |
| roomMember | 4 | 9 | 2 | 8 | Y | N | N | Active | Has hula usage |
| roomSettings | 4 | 16 | 2 | 16 | N | N | N | Active | Has hula usage |
| roomState | 12 | 63 | 3 | 12 | Y | N | N | Active | Has hula usage |
| roomStateManagement | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| roomSummary | 8 | 48 | 1 | 1 | Y | N | Y | Active | Contract: room_summary |
| roomUpgrades | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| saml-auth | 2 | 4 | 0 | 0 | N | N | Y | Dormant | Contract: saml; no hula |
| scheduledEvents | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| search | 68 | 324 | 196 | 1578 | Y | N | Y | Active | Contract: search; heavy usage |
| secretStorage | 9 | 82 | 1 | 1 | Y | N | N | Dormant | 1 hula ref |
| secureBackup | 2 | 4 | 4 | 40 | N | N | N | Active | Has hula usage |
| security | 14 | 35 | 51 | 475 | Y | N | N | Active | Has hula usage |
| sending | 41 | 137 | 24 | 67 | Y | N | N | Active | Has hula usage |
| sendingQueue | 3 | 12 | 0 | 0 | Y | N | N | **Zombie** | 3 SDK files; no hula/contract |
| serverCapabilities | 9 | 22 | 0 | 0 | Y | N | N | **Zombie** | 9 SDK files; no hula/contract |
| serverTime | 4 | 15 | 0 | 0 | N | N | N | **Zombie** | Internal only |
| session | 93 | 991 | 179 | 1925 | Y | N | N | Active | Heavy usage |
| sessions | 36 | 248 | 51 | 215 | Y | N | N | Active | Has hula usage |
| space | 50 | 401 | 301 | 2992 | Y | N | Y | Active | Contract: space; heavy usage |
| stateSend | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| stickyEvent | 7 | 73 | 0 | 0 | Y | N | N | Dormant | 7 SDK files; no hula/contract |
| syncAccumulator | 4 | 14 | 0 | 0 | N | N | Y | Dormant | Contract: sync; no hula |
| syncManagement | 2 | 4 | 0 | 0 | N | N | Y | Dormant | Contract: sync; no hula |
| tagsManagement | 2 | 4 | 0 | 0 | N | N | Y | Dormant | Contract: tags; no hula |
| telemetry | 12 | 40 | 7 | 11 | Y | N | Y | Active | Contract: telemetry |
| thirdparty | 10 | 55 | 6 | 27 | Y | N | Y | Active | Contract: thirdparty |
| thread | 61 | 1120 | 41 | 512 | Y | N | Y | Active | Contract: thread |
| threading | 6 | 9 | 5 | 19 | Y | N | N | Active | Has hula usage |
| threepids | 7 | 13 | 3 | 4 | Y | N | N | Active | Has hula usage |
| timeline | 56 | 1160 | 39 | 149 | Y | N | N | Active | Has hula usage |
| toDevice | 12 | 42 | 1 | 2 | Y | N | N | Active | Has hula usage |
| tokenManagement | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| turnServer | 7 | 51 | 3 | 9 | Y | N | N | Active | Has hula usage |
| typing | 22 | 115 | 29 | 142 | Y | N | Y | Active | Contract: typing |
| uploads | 11 | 22 | 6 | 11 | Y | N | N | Active | Has hula usage |
| user | 294 | 3588 | 652 | 5722 | Y | N | N | Active | Heavy usage |
| userDirectory | 2 | 4 | 4 | 10 | N | N | N | Active | Has hula usage |
| userPresence | 3 | 6 | 0 | 0 | N | N | N | **Zombie** | Internal only |
| userReport | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| verification | 42 | 313 | 26 | 157 | Y | N | Y | Active | Contract: verification_routes |
| voice | 10 | 32 | 81 | 534 | Y | N | Y | Active | Contract: voice |
| voipCalls | 2 | 4 | 0 | 0 | N | N | N | **Zombie** | Bare definition only |
| widget | 19 | 334 | 142 | 645 | Y | N | Y | Active | Contract: widget |
| widgets | 8 | 117 | 7 | 38 | Y | N | N | Active | Has hula usage |
| workerAdmin | 2 | 4 | 0 | 0 | N | N | Y | Dormant | Contract: worker; no hula |
| workerBody | 2 | 4 | 0 | 0 | N | N | Y | Dormant | Contract: worker_body; no hula |

### Manager Classification Summary

| Category | Count | Description |
|---|---|---|
| **Active** | 66 | Has hula references or contract routes |
| **Zombie** | 25 | 0 hula refs, minimal SDK refs (2-3 files), no contract route |
| **Deprecated** | 2 | Marked @deprecated in source (account, oidc) |
| **Dormant** | 12 | Has contract routes but 0 hula usage |

### Zombie Manager Candidates for Removal

These 25 managers have zero hula usage, minimal SDK internal references (mostly just the definition + registration boilerplate), and no contract route. They are candidates for removal:

1. authGlobalLogout
1. cryptoBackup
1. cryptoEncryption
1. cryptoKeys
1. eventProcessing
1. eventStatus
1. keyForwarding
1. mediaQuota
1. passwordReset
1. qrLogin
1. readReceipts
1. roomAccountData
1. roomJoining
1. roomKeySharing
1. roomStateManagement
1. roomUpgrades
1. scheduledEvents
1. sendingQueue (3 SDK files -- verify internal usage)
1. serverCapabilities (9 SDK files -- verify internal usage)
1. serverTime
1. stateSend
1. stickyEvent (7 SDK files -- verify internal usage)
1. tokenManagement
1. userPresence
1. userReport
1. voipCalls

**Note:** sendingQueue, serverCapabilities, and stickyEvent have internal SDK refs beyond the bare definition. Audit their internal usage before removal.

### Deprecated Manager Candidates

| Manager | Deprecated Since | Hula Still Uses? | Recommended Action |
|---|---|---|---|
| account | src/account/index.ts | Uses via client methods, not manager directly | Remove after ensuring hula doesn't call `getAccountManager()` |
| oidc | src/oidc/manager.ts | Yes (12 hula files) | Migrate hula to non-deprecated OIDC API, then remove |

---

## Architecture Observations

### Main entry dominance
157 out of 197 total SDK imports (80%) go through the main `matrix-js-sdk` entry. The remaining 40 imports (20%) use 18 sub-path entries, mostly for domain-specific managers (admin, crypto, friends, telemetry).

### Barrel file pattern
hula uses two barrel files:
- **`src/services/matrix/sdk.ts`**: Re-exports ~42 symbols from main entry + ~18 types/values from 11 sub-paths
- **`src/services/matrix/sdk-compat.ts`**: Re-exports 4 sub-path entries

8 sub-paths (`./push`, `./space`, `./store/worker`, `./client`, `./models/room`, `./models/room-state`, `./sync`, `./@types/partials`) are imported ONLY by these barrel files.

### Anti-pattern: `./src/` public exports
3 export entries (`./src/manager-extensions`, `./src/filter`, `./src/telemetry`) expose internal `src/` paths as public API. Zero hula consumers. Should be migrated to proper public paths or removed.

### Type augmentation coupling
`matrix-js-sdk-augmentations.d.ts` (1921 lines) uses `import()` type expressions referencing 6 sub-paths plus 2 deep-path locations. The MatrixClient augmentation (330 lines) is the single largest block and is largely duplicative.

---

## Summary Statistics

| Metric | Count |
|---|---|
| Total managers registered | 114 |
| Active managers | 66 |
| Zombie managers | 25 |
| Deprecated managers | 2 |
| Dormant managers | 12 |
| Total package.json export entries | 52 |
| Zero-usage export entries | 33 |
| Active export entries (has hula imports) | 19 |
| Deep-path violations | 2 (type-only) |
| Augmentation type blocks | ~40 |
| Augmentations that can move to SDK | ~30 type categories |
| hula import statements (total) | 197 |
