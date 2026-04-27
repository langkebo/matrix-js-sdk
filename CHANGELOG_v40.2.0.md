# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [40.2.0] - 2026-04-16

### 🎉 Major Optimization Release

This release includes a comprehensive optimization of the SDK with significant improvements to security, code quality, maintainability, and developer experience.

### Added

#### Security
- ✅ **Input Validation**: Added `ValidationError` class and `AdminValidators` utility for comprehensive input validation
- ✅ **Format Validation**: User ID and Room ID format validation to prevent injection attacks
- ✅ **Boundary Checks**: Parameter boundary validation (e.g., limit: 1-10000) to prevent resource exhaustion

#### Documentation
- ✅ **Usage Examples**: Added detailed `@example` documentation for 25+ methods
- ✅ **Error Documentation**: Added `@throws` documentation for all core methods
- ✅ **Admin Guide**: Created comprehensive Admin API usage guide (600+ lines)
- ✅ **Version Policy**: Created version policy and deprecation guidelines (400+ lines)
- ✅ **Optimization Reports**: Created detailed optimization reports for all phases

#### API Improvements
- ✅ **Unified Pagination**: Added `PaginatedResponse<T>` type for consistent pagination format
- ✅ **New Methods**: 
  - `getUsersPaginated()` - Unified format for user list pagination
  - `getRoomsPaginated()` - Unified format for room list pagination
- ✅ **Deprecation Warnings**: Added deprecation warning utility for smooth API transitions

#### Code Quality
- ✅ **Admin Utils**: Created utility functions for query parameter building
- ✅ **Type Safety**: Added `WhoisResponse` type, eliminated `any` type usage

### Changed

#### Security Improvements
- 🔒 **Admin Module**: Added input validation to 7 core methods
- 🔒 **Auth Module**: Enhanced validation and added security warnings
- 🔒 **Friend Module**: Replaced basic validation with standard validators
- 🔒 **DM Module**: Added user ID validation for all operations
- 🔒 **Device Module**: Added input validation and improved error messages

#### Error Handling
- ⚠️ **Cleaned Empty Catch Blocks**: Removed 5 instances of `catch {}` with explicit error handling
  - `/src/models/room.ts` - getRecommendedVersion()
  - `/src/interactive-auth.ts` - submitPromise handling
  - `/src/browser-index.ts` - IndexedDB initialization
  - `/src/store/memory.ts` - localStorage operations (2 instances)

#### Code Quality
- 📝 **Reduced Code Duplication**: Extracted common query building logic (~30 lines)
- 📝 **Improved Error Messages**: More descriptive validation error messages
- 📝 **Consistent API**: Unified pagination format across modules

### Deprecated

- ⚠️ `getUsers(from?, limit?)` - Use `getUsersPaginated(options?)` instead (will be removed in v41.0.0)
- ⚠️ `getRooms(from?, limit?, searchTerm?)` - Use `getRoomsPaginated(options?)` instead (will be removed in v41.0.0)

### Fixed

- 🐛 **Error Handling**: Fixed silent error swallowing in 5 locations
- 🐛 **Type Safety**: Eliminated `any` type usage in whois() method
- 🐛 **Validation**: Fixed inconsistent validation across modules

### Testing

- ✅ **New Tests**: Added 9 boundary condition tests for input validation
- ✅ **Test Coverage**: All tests passing (113/113)
- ✅ **Type Checking**: All type checks passing

### Documentation

- 📚 **New Files**:
  - `/docs/ADMIN_GUIDE.md` - Comprehensive Admin API guide
  - `/docs/VERSION_POLICY.md` - Version policy and deprecation guidelines
  - `/docs/OPTIMIZATION_SHOWCASE.md` - Optimization results showcase
  - `/docs/SDK_OPTIMIZATION_FINAL_REPORT_2026-04-16.md` - Final optimization report
  - Multiple phase reports documenting the optimization process

- 📚 **Updated Files**:
  - `/README.md` - Added "Recent Updates" section
  - `/CLAUDE.md` - Added Admin architecture, code quality standards, and best practices

### Performance

- ⚡ **Reduced Code Duplication**: ~30 lines of duplicate code eliminated
- ⚡ **Improved Validation**: Centralized validation logic for better performance

### Migration Guide

#### Migrating to Unified Pagination API

**Before (deprecated)**:
```typescript
const result = await adminManager.getUsers(undefined, 50);
result.users.forEach(user => console.log(user.user_id));
const nextToken = result.next_token;
```

**After (recommended)**:
```typescript
const result = await adminManager.getUsersPaginated({ limit: 50 });
result.items.forEach(user => console.log(user.user_id));
const nextToken = result.nextToken;
```

#### Using Input Validation

```typescript
import { AdminValidators } from "matrix-js-sdk/admin/validators";

// Validate user ID before use
AdminValidators.validateUserId(userId);

// Validate room ID before use
AdminValidators.validateRoomId(roomId);

// Validate limit parameter
AdminValidators.validateLimit(limit);
```

#### Handling Typed Errors

```typescript
import { ValidationError, AuthError, NotFoundError } from "matrix-js-sdk/errors";

try {
    await adminManager.getUser(userId);
} catch (error) {
    if (error instanceof ValidationError) {
        console.error("Invalid input:", error.message);
    } else if (error instanceof NotFoundError) {
        console.error("User not found");
    } else if (error instanceof AuthError) {
        console.error("Authentication failed");
    }
}
```

### Statistics

- **Work Duration**: 2 days
- **Phases Completed**: 4 (Architecture, Code Quality, Maintainability, Module Optimization)
- **Tasks Completed**: 12
- **Files Added**: 11
- **Files Modified**: 12
- **Code Added**: ~1700 lines
- **Documentation Added**: ~1300 lines
- **Methods Optimized**: 25+
- **Modules Optimized**: 5 (Admin, Auth, Friend, DM, Device)

### Contributors

- SDK Development Team

### References

- [Admin API Guide](./docs/ADMIN_GUIDE.md)
- [Version Policy](./docs/VERSION_POLICY.md)
- [Optimization Report](./docs/SDK_OPTIMIZATION_FINAL_REPORT_2026-04-16.md)
- [Optimization Showcase](./docs/OPTIMIZATION_SHOWCASE.md)

---

## [40.1.0] - Previous Release

... (previous changelog entries)
