/*
Copyright 2026 The Matrix.org Foundation C.I.C.

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
 * Matrix 标准错误码常量定义（与后端 synapse-rust src/common/error.rs MatrixErrorCode 枚举对齐）。
 *
 * - `M_UNRECOGNIZED` 在 Matrix Spec v1.11+ 中使用 HTTP 404 状态码（不再使用 400）。
 *   Element 客户端依赖此行为来区分"端点未实现"和"请求参数错误"。
 *
 * @see https://spec.matrix.org/v1.13/client-server-api/#standard-error-response
 */

export const MatrixErrorCode = {
    /** 请求被禁止 */
    M_FORBIDDEN: "M_FORBIDDEN",
    /** 未提供访问令牌或令牌无效 */
    M_UNKNOWN_TOKEN: "M_UNKNOWN_TOKEN",
    /** 请求未携带访问令牌 */
    M_MISSING_TOKEN: "M_MISSING_TOKEN",
    /** 请求体非有效 JSON（语法错误） */
    M_BAD_JSON: "M_BAD_JSON",
    /** 请求 Content-Type 非 application/json */
    M_NOT_JSON: "M_NOT_JSON",
    /** 资源不存在 */
    M_NOT_FOUND: "M_NOT_FOUND",
    /** 请求过于频繁，触发速率限制 */
    M_LIMIT_EXCEEDED: "M_LIMIT_EXCEEDED",
    /** 未知内部错误 */
    M_UNKNOWN: "M_UNKNOWN",
    /** [v1.11+] 端点未实现（HTTP 404） */
    M_UNRECOGNIZED: "M_UNRECOGNIZED",
    /** 认证失败 */
    M_UNAUTHORIZED: "M_UNAUTHORIZED",
    /** 用户已被停用 */
    M_USER_DEACTIVATED: "M_USER_DEACTIVATED",
    /** 用户名已被使用 */
    M_USER_IN_USE: "M_USER_IN_USE",
    /** 无效用户名 */
    M_INVALID_USERNAME: "M_INVALID_USERNAME",
    /** 房间别名已被使用 */
    M_ROOM_IN_USE: "M_ROOM_IN_USE",
    /** 房间状态无效 */
    M_INVALID_ROOM_STATE: "M_INVALID_ROOM_STATE",
    /** 第三方标识符已被使用 */
    M_THREEPID_IN_USE: "M_THREEPID_IN_USE",
    /** 第三方标识符未找到 */
    M_THREEPID_NOT_FOUND: "M_THREEPID_NOT_FOUND",
    /** 第三方认证失败 */
    M_THREEPID_AUTH_FAILED: "M_THREEPID_AUTH_FAILED",
    /** 第三方认证被拒绝 */
    M_THREEPID_DENIED: "M_THREEPID_DENIED",
    /** 联邦：服务器不受信任 */
    M_SERVER_NOT_TRUSTED: "M_SERVER_NOT_TRUSTED",
    /** 不支持的房间版本 */
    M_UNSUPPORTED_ROOM_VERSION: "M_UNSUPPORTED_ROOM_VERSION",
    /** 不兼容的房间版本 */
    M_INCOMPATIBLE_ROOM_VERSION: "M_INCOMPATIBLE_ROOM_VERSION",
    /** 状态不合法 */
    M_BAD_STATE: "M_BAD_STATE",
    /** 访客访问被禁止 */
    M_GUEST_ACCESS_FORBIDDEN: "M_GUEST_ACCESS_FORBIDDEN",
    /** 需要 CAPTCHA 验证 */
    M_CAPTCHA_NEEDED: "M_CAPTCHA_NEEDED",
    /** CAPTCHA 验证失败 */
    M_CAPTCHA_INVALID: "M_CAPTCHA_INVALID",
    /** 缺少必需参数 */
    M_MISSING_PARAM: "M_MISSING_PARAM",
    /** 参数值无效 */
    M_INVALID_PARAM: "M_INVALID_PARAM",
    /** 请求体过大 */
    M_TOO_LARGE: "M_TOO_LARGE",
    /** 资源独占冲突 */
    M_EXCLUSIVE: "M_EXCLUSIVE",
    /** 资源限制超出 */
    M_RESOURCE_LIMIT_EXCEEDED: "M_RESOURCE_LIMIT_EXCEEDED",
    /** 用户无法离开系统通知房间 */
    M_CANNOT_LEAVE_SERVER_NOTICE_ROOM: "M_CANNOT_LEAVE_SERVER_NOTICE_ROOM",
    /** 请求超时 */
    M_REQUEST_TIMEOUT: "M_REQUEST_TIMEOUT",
} as const;

export type MatrixErrorCodeType = (typeof MatrixErrorCode)[keyof typeof MatrixErrorCode];

/**
 * Matrix 错误码及其对应的 HTTP 状态码（与后端 http_status() 方法对齐）。
 *
 * 用于客户端根据 errcode 判断预期的 HTTP 响应行为。
 *
 * @see synapse-rust src/common/error.rs
 */
export const MATRIX_ERROR_HTTP_STATUS: Record<string, number> = {
    [MatrixErrorCode.M_FORBIDDEN]: 403,
    [MatrixErrorCode.M_UNKNOWN_TOKEN]: 401,
    [MatrixErrorCode.M_MISSING_TOKEN]: 401,
    [MatrixErrorCode.M_BAD_JSON]: 400,
    [MatrixErrorCode.M_NOT_JSON]: 400,
    [MatrixErrorCode.M_NOT_FOUND]: 404,
    [MatrixErrorCode.M_LIMIT_EXCEEDED]: 429,
    [MatrixErrorCode.M_UNKNOWN]: 500,
    [MatrixErrorCode.M_UNRECOGNIZED]: 404,
    [MatrixErrorCode.M_UNAUTHORIZED]: 401,
    [MatrixErrorCode.M_USER_DEACTIVATED]: 403,
    [MatrixErrorCode.M_USER_IN_USE]: 409,
    [MatrixErrorCode.M_INVALID_USERNAME]: 400,
    [MatrixErrorCode.M_ROOM_IN_USE]: 409,
    [MatrixErrorCode.M_INVALID_ROOM_STATE]: 400,
    [MatrixErrorCode.M_THREEPID_IN_USE]: 409,
    [MatrixErrorCode.M_THREEPID_NOT_FOUND]: 400,
    [MatrixErrorCode.M_THREEPID_AUTH_FAILED]: 403,
    [MatrixErrorCode.M_THREEPID_DENIED]: 403,
    [MatrixErrorCode.M_SERVER_NOT_TRUSTED]: 502,
    [MatrixErrorCode.M_UNSUPPORTED_ROOM_VERSION]: 400,
    [MatrixErrorCode.M_INCOMPATIBLE_ROOM_VERSION]: 400,
    [MatrixErrorCode.M_BAD_STATE]: 400,
    [MatrixErrorCode.M_GUEST_ACCESS_FORBIDDEN]: 403,
    [MatrixErrorCode.M_CAPTCHA_NEEDED]: 400,
    [MatrixErrorCode.M_CAPTCHA_INVALID]: 400,
    [MatrixErrorCode.M_MISSING_PARAM]: 400,
    [MatrixErrorCode.M_INVALID_PARAM]: 400,
    [MatrixErrorCode.M_TOO_LARGE]: 413,
    [MatrixErrorCode.M_EXCLUSIVE]: 409,
    [MatrixErrorCode.M_RESOURCE_LIMIT_EXCEEDED]: 403,
    [MatrixErrorCode.M_CANNOT_LEAVE_SERVER_NOTICE_ROOM]: 403,
    [MatrixErrorCode.M_REQUEST_TIMEOUT]: 408,
} as const;

/**
 * 根据 HTTP 状态码返回对应的 Matrix 错误码（推测值）。
 * 在无法从响应 body 解析 errcode 时使用。
 */
export function httpStatusToErrorCode(httpStatus: number): string {
    switch (httpStatus) {
        case 400:
            return MatrixErrorCode.M_BAD_JSON;
        case 401:
            return MatrixErrorCode.M_UNKNOWN_TOKEN;
        case 403:
            return MatrixErrorCode.M_FORBIDDEN;
        case 404:
            return MatrixErrorCode.M_NOT_FOUND;
        case 408:
            return MatrixErrorCode.M_REQUEST_TIMEOUT;
        case 409:
            return MatrixErrorCode.M_EXCLUSIVE;
        case 413:
            return MatrixErrorCode.M_TOO_LARGE;
        case 429:
            return MatrixErrorCode.M_LIMIT_EXCEEDED;
        case 500:
            return MatrixErrorCode.M_UNKNOWN;
        case 502:
            return MatrixErrorCode.M_SERVER_NOT_TRUSTED;
        default:
            return MatrixErrorCode.M_UNKNOWN;
    }
}
