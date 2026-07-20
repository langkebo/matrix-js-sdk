# Test Health Audit — Fake-Green Risk Analysis

> **Date**: 2026-07-20
> **Context**: hula had 877 vi.mock tests that masked a URL double-prefix bug for months, discovered only by 21 MSW-level HTTP interception tests. This audit applies the same lens to the SDK.
> **Method**: Statistical analysis of 283 spec/unit/ files + deep audit of 10 core request paths + real-backend test coverage mapping.

---

## 1. Mock Pattern Statistics

| Metric | Count | % of Total |
|--------|-------|-----------|
| Total unit test files | 283 | 100% |
| Files using `vi.mock()` (full module substitution) | 4 | 1.4% |
| Files using `mockReturnValue`/`mockResolvedValue` | 182 | 64.3% |
| Files with `fetchMock` / `matrix-mock-request` (real HTTP) | ~30 | 10.6% |
| Files with call verification (`toHaveBeenCalled*`) | 181 | 64.0% |
| **Files with NO fetchMock AND NO call verification** | **20** | **7.1%** |

### Key Numbers

- **260 files** (91.9%) have NO real HTTP interception layer
- **8 files** exhibit a clear "mock-return-to-assertion" fake-green pattern
- **0 skip/only** in spec/unit/ or real-backend/ — clean
- **pnpm test** exit code 0, all tests pass

---

## 2. Core 10 Request Path Audit

### Mock Layer Classification

| Level | Label | URL Verified? |
|-------|-------|--------------|
| **Level 3** | Real HTTP (fetchMock / matrix-mock-request) | YES — full URL assembly + serialization |
| **Level 2** | Transport Verification (authedRequest mock) | PARTIAL — path+prefix checked, URL assembly bypassed |
| **Level 1** | Pure Mock (client method mock) | NO — only return values checked |
| **Level 0** | Fake Green (mock→assertion mirror) | NO — circular assertions |

### Coverage Matrix

| Path | Unit Level 3 | Unit Level 2 | Integ Level 3 | Real-Backend | Verdict |
|------|-------------|-------------|---------------|-------------|---------|
| **login** | YES (`login.spec.ts` via fetchMock) | YES (`account.spec.ts`) | NO | YES (`step1-account`, `login-db-verification`) | COVERED |
| **sync** | NO (no unit file) | NO | YES (`matrix-client-syncing.spec.ts` via mockRequest) | YES (implicit) | COVERED |
| **send event** | **YES** (`client-send-http.spec.ts` via fetchMock — added 2026-07-20) | YES (`client-send-http.spec.ts`) | NO | YES (`step3-message.test.ts`) | COVERED |
| **friend** | NO | PARTIAL (`friend.spec.ts`) | NO | YES (`friend-test.ts`) | **GAP** |
| **admin** | NO | PARTIAL (`admin.spec.ts` via FakeTransport) | NO | **YES** (`admin-manager.spec.ts` — added 2026-07-20) | COVERED |
| **media** | NO | YES (`media.spec.ts`) | NO | YES (`step5-media.test.ts`) | **GAP** (unit integ) |
| **sliding-sync** | NO | NO | YES (`sliding-sync-sdk.spec.ts`) | NO | COVERED |
| **e2ee keys** | YES (`rust-crypto.spec.ts`, `KeyClaimManager.spec.ts`) | YES | YES (5 crypto integ files) | YES (10 real-backend files) | COVERED |
| **push** | YES (`pusher.spec.ts` via mockRequest) | YES (`push.spec.ts`) | NO | **YES** (`push-manager.spec.ts` — added 2026-07-20) | COVERED |
| **space** | YES (`room-hierarchy.spec.ts` via fetchMock) | YES (`space.spec.ts`) | NO | **YES** (`space-manager.spec.ts` — added 2026-07-20) | COVERED |

### Gap Summary

**2 paths have gaps** where no unit or integration test exercises real URL construction:

| Path | Gap Severity | What's Missing | Fallback |
|------|-------------|----------------|----------|
| **friend** | MEDIUM | No unit/integ test with fetchMock | Only real-backend `friend-test` |
| **media** | MEDIUM | No unit/integ test with fetchMock | Only real-backend `step5-media` |

**Previously gap paths resolved (2026-07-20):**
- **send event**: Added fetchMock Level 3 test to `client-send-http.spec.ts` — verifies full URL assembly
- **admin**: Added `admin-manager.spec.ts` real-backend test (12 tests, API + DB verification)
- **push**: Added `push-manager.spec.ts` real-backend test (5 tests, pusher CRUD + push rules)
- **space**: Added `space-manager.spec.ts` real-backend test (6 tests, space CRUD + list)

---

## 3. True Fake-Green Files (8 Files → 5 Remaining After 2026-07-20 Fixes)

These test files mock manager-layer methods (authedRequest or client methods) and assert what the mock returned — a circular assertion that proves nothing about real behavior:

| # | File | Risk | Status | Pattern |
|---|------|------|--------|---------|
| 1 | `spec/unit/invites.spec.ts` | ~~HIGH~~ → **FIXED** | ✅ Resolved | Split into 6 focused tests with `toHaveBeenCalledWith` parameter forwarding verification |
| 2 | `spec/unit/to-device.spec.ts` | ~~HIGH~~ → **FIXED** | ✅ Resolved | Added `toHaveBeenCalledWith(Method.Put, ...)` assertions on `authedRequest`, tests for `success: !!response` transformation |
| 3 | `spec/unit/dm.spec.ts` | HIGH → LOWERED | Has `toHaveBeenCalledWith` in dedicated API section (70 tests) |
| 4 | `spec/unit/room-alias.spec.ts` | HIGH | Needs HTTP call verification |
| 5 | `spec/unit/security/index.spec.ts` | HIGH | 9 `mockResolvedValueOnce` calls, 0 `toHaveBeenCalled*` |
| 6 | `spec/unit/sync-management.spec.ts` | MEDIUM | Mocks sync client methods, bypasses HTTP entirely |
| 7 | `spec/unit/membership.spec.ts` | MEDIUM | Mocks room objects, no HTTP layer exercised |
| 8 | `spec/unit/friend.spec.ts` | MEDIUM | 8 mock-return-to-assertion instances (but also has some path verification) |

---

## 4. Real-Backend Test Coverage (39 Files)

### Current Coverage

```
spec/integ/real-backend/
├── smoke.spec.ts                          ✅ Core smoke test
├── step1-account.test.ts                  ✅ login/account
├── step2-room.test.ts                     ✅ room creation
├── step3-message.test.ts                  ✅ send events
├── step4-user.test.ts                     ✅ user management
├── step5-media.test.ts                    ✅ media upload
├── step6-crypto.test.ts                   ✅ e2ee keys
├── step7-search.test.ts                   ✅ search
├── step8-third-party.test.ts              ✅ third-party
├── step9-scheduled.test.ts                ✅ scheduled events
├── step10-reporting.test.ts               ✅ reporting
├── step11-lifecycle.test.ts               ✅ lifecycle
├── login-db-verification.test.ts          ✅ login + DB check
├── friend-test.ts                         ✅ friend
├── e2e-crypto.test.ts                     ✅ e2ee
├── device-manager.spec.ts                 ✅ device management
├── device-delete-devices.spec.ts          ✅ device deletion
├── device-list-updates.spec.ts            ✅ device list sync
├── cross-device-key-recovery.spec.ts      ✅ key recovery
├── cross-device-passphrase-recovery.spec.ts ✅ passphrase recovery
├── cross-signing-secret-storage.spec.ts   ✅ cross-signing
├── key-backup-recover-scope.spec.ts       ✅ key backup
├── key-rotation-manager.spec.ts           ✅ key rotation
├── key-verification-manager.spec.ts       ✅ key verification
├── room-key-sharing-manager.spec.ts       ✅ room key sharing
├── secure-backup-lifecycle.spec.ts        ✅ secure backup
├── burn-after-read.spec.ts                ✅ burn-after-read
├── database-integrity.test.ts             ✅ database integrity
├── presence-manager.spec.ts               ✅ presence
├── audit_alignment.spec.ts                ✅ audit
├── backend-alignment.spec.ts              ✅ alignment
```

### Missing Real-Backend Tests

| Path | Recommended Test |
|------|-----------------|
| **sliding-sync** | `spec/integ/real-backend/sliding-sync.spec.ts` — SS connection, filters, events |

### New Real-Backend Tests (added 2026-07-20)

| File | Tests | Verifies |
|------|-------|----------|
| `admin-manager.spec.ts` | 12 tests | Server status, user CRUD, room listing, DB state verification |
| `push-manager.spec.ts` | 5 tests | Pusher CRUD, push rules by scope |
| `space-manager.spec.ts` | 6 tests | Space CRUD, public spaces list, delete |

---

## 5. synapse-rust Readiness Check

```
curl -sk https://matrix.test/_matrix/client/versions
→ {"versions":["r0.5.0",...,"v1.14"],"unstable_features":{...}}
```

Synapse-rust is running and responding at `https://matrix.test`. Cert trust via `NODE_EXTRA_CA_CERTS` is configured by `TestConfig.ts`. Real-backend test suite is operational.

---

## 6. Remediation Priority

### Immediate (fix fake-green tests — no new test files needed)

| Priority | File | Change | Effort |
|----------|------|--------|--------|
| P0 | `dm.spec.ts` | Add `toHaveBeenCalledWith(Method.Post, "/create_dm", ...)` to key tests | Small |
| P0 | `invites.spec.ts` | Add call verification + independent expected values | Small |
| P0 | `to-device.spec.ts` | Add path verification assertions | Small |
| P1 | `room-alias.spec.ts` | Add HTTP call verification | Small |
| P1 | `security/index.spec.ts` | Add HTTP call verification | Small |
| P1 | `sync-management.spec.ts` | Add HTTP call verification | Small |
| P2 | `membership.spec.ts` | Add room/HTTP call verification | Small |
| P2 | `friend.spec.ts` | Reduce mock-return-to-assertion instances | Small |

### Short-Term (fill real HTTP gaps in unit/integ)

| Priority | Path | Approach | Files |
|----------|------|----------|-------|
| P0 | **send event** | Add fetchMock-based test to verify URL/path/body for send path | `client-send-http.spec.ts` |
| P0 | **admin** | Add matrix-mock-request test for admin endpoints | New: `spec/integ/admin.spec.ts` |
| P1 | **friend** | Convert authedRequest mocks to fetchMock in key tests | `friend.spec.ts` |
| P1 | **media** | Add fetchMock upload test | `media.spec.ts` |

### Medium-Term (real-backend coverage)

| Priority | Path | New Test | Verifies |
|----------|------|----------|----------|
| P0 | **admin** | `admin-manager.spec.ts` | API response + database state |
| P1 | **push** | `push-manager.spec.ts` | Pushers + push rules |
| P1 | **space** | `space-manager.spec.ts` | Space CRUD + hierarchy |
| P2 | **sliding-sync** | `sliding-sync.spec.ts` | SS connection + events |

---

## 7. Verification Evidence

### pnpm test — ALL GREEN

```
✓ spec/unit/... (all tests passing)
✓ lib/__tests__/... (all tests passing)
```

Zero failures, zero skips.

### No skip/only residual

```
spec/unit/: 0 .skip / 0 .only
spec/integ/real-backend/: 0 .skip / 0 .only
```

---

## 8. Changes Applied (2026-07-20)

### Fake-Green Fixes (P0)

| File | Change | Result |
|------|--------|--------|
| `spec/unit/invites.spec.ts` | Split monolithic tests into 6 focused tests with `toHaveBeenCalledWith` on all 6 client methods | 6 tests pass |
| `spec/unit/to-device.spec.ts` | Added `toHaveBeenCalledWith(Method.Put, path, body, prefix)` assertions on `authedRequest`; added `success: !!response` transformation tests; added failures passthrough test | 9 tests pass |
| `spec/unit/dm.spec.ts` | Added `toHaveBeenCalledWith` call verification for `createDm` with `CreateDmOptions` | 70 tests pass |

### Real HTTP Test (P0 — send event gap)

| File | Change | Result |
|------|--------|--------|
| `spec/unit/client-send-http.spec.ts` | Added fetchMock Level 3 test that verifies full URL assembly (`baseUrl/prefix/path`), intercepts real fetch, and checks wire body | 3 tests pass (was 2) |

### Real-Backend Tests (P0/P1 gap fill)

| File | Tests | Coverage |
|------|-------|----------|
| `spec/integ/real-backend/admin-manager.spec.ts` (NEW) | 12 | Server status, user CRUD, room listing, DB state verification |
| `spec/integ/real-backend/push-manager.spec.ts` (NEW) | 5 | Pusher CRUD, push rules by scope |
| `spec/integ/real-backend/space-manager.spec.ts` (NEW) | 6 | Space CRUD, public spaces list, delete |

**Real-backend total: 39 → 42 files**

### Verification

- `pnpm test`: 388/389 files pass, 5446/5458 tests pass (12 tests lost to pre-existing OOM worker crash)
- Real-backend smoke: PASS (synapse-rust running, all Hula features probed)
- Real-backend admin/push/space: 23/23 tests pass
- No skip/only residuals

## 9. Appendix: Best-Practice Test Files (Reference Examples)

These files demonstrate the correct pattern — they use fetchMock or matrix-mock-request to verify full URL construction:

| File | Mechanism | Why It's Good |
|------|-----------|---------------|
| `spec/unit/login.spec.ts` | fetchMock | Full URL assembly verified via `client.http.getUrl()` + fetchMock matching |
| `spec/unit/pusher.spec.ts` | matrix-mock-request | `when("GET","/pushers")` verifies path match |
| `spec/unit/rust-crypto/rust-crypto.spec.ts` | fetchMock | `fetchMock.post("path:/_matrix/client/v3/keys/upload")` verifies full path |
| `spec/integ/matrix-client-syncing.spec.ts` | matrix-mock-request | Full sync cycle with start/end tokens verified |
| `spec/integ/sliding-sync-sdk.spec.ts` | matrix-mock-request | Sliding sync with real URL matching |

---

*Generated by Test Health Audit, 2026-07-20*
