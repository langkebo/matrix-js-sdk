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
 * Admin types — barrel re-export
 *
 * All admin types are now organized by sub-manager domain:
 * - admin-user-types.ts: user management, accounts, sessions, tokens, pagination
 * - admin-room-types.ts: room management, events, spaces, reports
 * - admin-server-types.ts: server management, stats, notifications, media quota
 * - admin-federation-types.ts: federation management, destinations, cache
 * - admin-config-types.ts: configuration, retention, feature flags, modules, SAML
 */
export * from "./sub-managers/admin-user-types";
export * from "./sub-managers/admin-room-types";
export * from "./sub-managers/admin-server-types";
export * from "./sub-managers/admin-federation-types";
export * from "./sub-managers/admin-config-types";
