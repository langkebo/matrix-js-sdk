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
 * Centralized Matrix error code constants.
 *
 * ISSUE-14: The SDK previously scattered `M_*` error codes as string literals
 * throughout the codebase. This object provides a single source of truth so
 * callers can reference codes symbolically instead of repeating magic strings.
 *
 * Values mirror the canonical Matrix client-server error codes.
 *
 * @see https://spec.matrix.org/v1.11/client-server-api/#error-codes
 */
export const MatrixErrorCode = {
    /** Forbidden access, e.g. joining a room without permission (HTTP 403). */
    M_FORBIDDEN: "M_FORBIDDEN",
    /** The supplied access token was not recognised or has expired (HTTP 401). */
    M_UNKNOWN_TOKEN: "M_UNKNOWN_TOKEN",
    /** No access token was supplied for a request that requires one (HTTP 401). */
    M_MISSING_TOKEN: "M_MISSING_TOKEN",
    /** The request was malformed or used an unsupported parameter (HTTP 400). */
    M_BAD_REQUEST: "M_BAD_REQUEST",
    /** The request was rate limited (HTTP 429). */
    M_LIMIT_EXCEEDED: "M_LIMIT_EXCEEDED",
    /** The requested resource could not be found (HTTP 404). */
    M_NOT_FOUND: "M_NOT_FOUND",
    /** An unknown error has occurred (HTTP 500). */
    M_UNKNOWN: "M_UNKNOWN",
    /** The server does not recognise the request token/endpoint (HTTP 404). */
    M_UNRECOGNIZED: "M_UNRECOGNIZED",
    /** The request was not authorised (HTTP 401). */
    M_UNAUTHORIZED: "M_UNAUTHORIZED",
    /** The requested username is already in use (HTTP 400). */
    M_USER_IN_USE: "M_USER_IN_USE",
    /** The third-party identifier is already in use (HTTP 400). */
    M_THREEPID_IN_USE: "M_THREEPID_IN_USE",
    /** The third-party identifier could not be found (HTTP 400). */
    M_THREEPID_NOT_FOUND: "M_THREEPID_NOT_FOUND",
    /** The request was too large (HTTP 413). */
    M_TOO_LARGE: "M_TOO_LARGE",
    /** The homeserver does not permit the third-party identifier (HTTP 400). */
    M_EXCLUSIVE_THREEPID: "M_EXCLUSIVE_THREEPID",
    /** Third-party identifier authentication failed (HTTP 401). */
    M_THREEPID_AUTH_FAILED: "M_THREEPID_AUTH_FAILED",
    /** The third-party identifier is denied by the server policy (HTTP 403). */
    M_THREEPID_DENIED: "M_THREEPID_DENIED",
    /** The identity server is not trusted by the homeserver (HTTP 400). */
    M_SERVER_NOT_TRUSTED: "M_SERVER_NOT_TRUSTED",
    /** The requested room version is unsupported by the server (HTTP 400). */
    M_UNSUPPORTED_ROOM_VERSION: "M_UNSUPPORTED_ROOM_VERSION",
    /** The room state update was invalid (HTTP 400). */
    M_INVALID_ROOM_STATE: "M_INVALID_ROOM_STATE",
    /** The supplied CAPTCHA response was invalid (HTTP 400). */
    M_CAPTCHA_INVALID: "M_CAPTCHA_INVALID",
    /** A CAPTCHA response is required to complete the request (HTTP 400). */
    M_CAPTCHA_NEEDED: "M_CAPTCHA_NEEDED",
    /** A required parameter was missing from the request (HTTP 400). */
    M_MISSING_PARAM: "M_MISSING_PARAM",
    /** A supplied parameter was invalid (HTTP 400). */
    M_INVALID_PARAM: "M_INVALID_PARAM",
    /** The request should be redirected to another URI (HTTP 302). */
    M_FOUND: "M_FOUND",
    /** The homeserver has exceeded a resource limit (HTTP 403). */
    M_RESOURCE_LIMIT_EXCEEDED: "M_RESOURCE_LIMIT_EXCEEDED",
    /** The user cannot leave the server notice room (HTTP 403). */
    M_CANNOT_LEAVE_SERVER_NOTICE_ROOM: "M_CANNOT_LEAVE_SERVER_NOTICE_ROOM",
    /** The supplied password does not meet the server's strength policy (HTTP 400). */
    M_WEAK_PASSWORD: "M_WEAK_PASSWORD",
    /** The supplied password is too short (HTTP 400). */
    M_PASSWORD_TOO_SHORT: "M_PASSWORD_TOO_SHORT",
    /** The supplied password contains no digits (HTTP 400). */
    M_PASSWORD_NO_DIGIT: "M_PASSWORD_NO_DIGIT",
    /** The supplied password contains no uppercase letter (HTTP 400). */
    M_PASSWORD_NO_UPPERCASE: "M_PASSWORD_NO_UPPERCASE",
    /** The supplied password contains no lowercase letter (HTTP 400). */
    M_PASSWORD_NO_LOWERCASE: "M_PASSWORD_NO_LOWERCASE",
    /** The supplied password contains no symbol (HTTP 400). */
    M_PASSWORD_NO_SYMBOL: "M_PASSWORD_NO_SYMBOL",
    /** The supplied password appears in a common-password blocklist (HTTP 400). */
    M_PASSWORD_IN_COMMON_LIST: "M_PASSWORD_IN_COMMON_LIST",
    /** The requested room key could not be found (E2EE). */
    M_ROOM_KEY_NOT_FOUND: "M_ROOM_KEY_NOT_FOUND",
    /** The user account has been deactivated (HTTP 403). */
    M_USER_DEACTIVATED: "M_USER_DEACTIVATED",
    /** A remote server was automatically trusted (federation extension). */
    M_AUTO_TRUSTED_REMOTE: "M_AUTO_TRUSTED_REMOTE",
    /** Authentication failed (HTTP 401). */
    M_AUTHENTICATION_FAILED: "M_AUTHENTICATION_FAILED",
    /** The user has not agreed to the required consent terms (HTTP 403). */
    M_CONSENT_NOT_GIVEN: "M_CONSENT_NOT_GIVEN",
    /** The user is not authorised to perform the action (HTTP 403). */
    M_AUTHORIZATION_FAILED: "M_AUTHORIZATION_FAILED",
} as const;

/**
 * Union type of all known Matrix error code string values.
 *
 * Use this to type variables that hold an error code from {@link MatrixErrorCode}.
 */
export type MatrixErrorCodeValue = (typeof MatrixErrorCode)[keyof typeof MatrixErrorCode];
