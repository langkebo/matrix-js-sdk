/*
Copyright 2023 The Matrix.org Foundation C.I.C.

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
 * Base64 encoding and decoding utilities
 */

type Base64Alphabet = "base64" | "base64url";

interface Uint8ArrayToBase64CompatOptions {
    alphabet?: Base64Alphabet;
    omitPadding?: boolean;
}

interface Uint8ArrayFromBase64CompatOptions {
    alphabet?: Base64Alphabet;
    lastChunkHandling?: "loose" | "strict" | "stop-before-partial";
}

type Uint8ArrayWithBase64 = Uint8Array & {
    toBase64?: (options?: Uint8ArrayToBase64CompatOptions) => string;
};

type Uint8ArrayConstructorWithBase64 = Uint8ArrayConstructor & {
    fromBase64?: (base64: string, options?: Uint8ArrayFromBase64CompatOptions) => Uint8Array;
};

function toBase64(uint8Array: Uint8Array, options: Uint8ArrayToBase64CompatOptions): string {
    const runtimeArray = uint8Array as Uint8ArrayWithBase64;
    if (typeof runtimeArray.toBase64 === "function") {
        // Currently this is only supported in Firefox,
        // but we match the options in the hope in the future we can rely on it for all environments.
        // https://tc39.es/proposal-arraybuffer-base64/spec/#sec-uint8array.prototype.tobase64
        return runtimeArray.toBase64(options);
    }

    let base64 = btoa(uint8Array.reduce((acc, current) => acc + String.fromCharCode(current), ""));
    if (options.omitPadding) {
        base64 = base64.replace(/={1,2}$/, "");
    }
    if (options.alphabet === "base64url") {
        base64 = base64.replace(/\+/g, "-").replace(/\//g, "_");
    }

    return base64;
}

/**
 * Encode a typed array of uint8 as base64.
 * @param uint8Array - The data to encode.
 * @returns The base64.
 */
export function encodeBase64(uint8Array: Uint8Array): string {
    return toBase64(uint8Array, { alphabet: "base64", omitPadding: false });
}

/**
 * Encode a typed array of uint8 as unpadded base64.
 * @param uint8Array - The data to encode.
 * @returns The unpadded base64.
 */
export function encodeUnpaddedBase64(uint8Array: Uint8Array): string {
    return toBase64(uint8Array, { alphabet: "base64", omitPadding: true });
}

/**
 * Encode a typed array of uint8 as unpadded base64 using the URL-safe encoding.
 * @param uint8Array - The data to encode.
 * @returns The unpadded base64.
 */
export function encodeUnpaddedBase64Url(uint8Array: Uint8Array): string {
    return toBase64(uint8Array, { alphabet: "base64url", omitPadding: true });
}

function fromBase64(base64: string, options: Uint8ArrayFromBase64CompatOptions): Uint8Array {
    const RuntimeUint8Array = Uint8Array as Uint8ArrayConstructorWithBase64;
    if (typeof RuntimeUint8Array.fromBase64 === "function") {
        // Currently this is only supported in Firefox,
        // but we match the options in the hope in the future we can rely on it for all environments.
        // https://tc39.es/proposal-arraybuffer-base64/spec/#sec-uint8array.frombase64
        return RuntimeUint8Array.fromBase64(base64, options);
    }

    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Decode a base64 (or base64url) string to a typed array of uint8.
 * @param base64 - The base64 to decode.
 * @returns The decoded data.
 */
export function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
    // The function requires us to select an alphabet, but we don't know if base64url was used so we convert.
    // `fromBase64` always allocates a fresh ArrayBuffer-backed Uint8Array; the runtime never returns a
    // SharedArrayBuffer-backed view, but the lib type widens to `Uint8Array<ArrayBufferLike>`. Narrow it
    // here so Web Crypto APIs (`subtle.verify` / `subtle.decrypt`, which require `BufferSource` =
    // `Uint8Array<ArrayBuffer>`) accept the result without per-call-site casts.
    return fromBase64(base64.replace(/-/g, "+").replace(/_/g, "/"), {
        alphabet: "base64",
        lastChunkHandling: "loose",
    }) as Uint8Array<ArrayBuffer>;
}
