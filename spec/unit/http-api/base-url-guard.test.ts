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

import { describe, it, expect } from "vitest";
import { assertSecureBaseUrl } from "../../../src/http-api/base-url-guard";

describe("ISSUE-09a base url guard", () => {
    it("rejects http in production", () => {
        expect(() => assertSecureBaseUrl("http://matrix.example.org", { allowInsecureDev: false })).toThrow(
            /non-https base url/i,
        );
    });

    it("allows https", () => {
        expect(() => assertSecureBaseUrl("https://matrix.example.org")).not.toThrow();
    });

    it("allows localhost http in dev", () => {
        expect(() => assertSecureBaseUrl("http://localhost:8008", { allowInsecureDev: true })).not.toThrow();
        expect(() => assertSecureBaseUrl("http://127.0.0.1:8008", { allowInsecureDev: true })).not.toThrow();
        expect(() => assertSecureBaseUrl("http://10.0.2.2:8008", { allowInsecureDev: true })).not.toThrow();
        expect(() => assertSecureBaseUrl("http://[::1]:8008", { allowInsecureDev: true })).not.toThrow();
    });

    it("rejects non-localhost http even in dev", () => {
        expect(() => assertSecureBaseUrl("http://matrix.example.org", { allowInsecureDev: true })).toThrow(
            /non-https base url/i,
        );
    });

    it("rejects unsupported protocol", () => {
        expect(() => assertSecureBaseUrl("ftp://matrix.example.org")).toThrow(/unsupported base url protocol/i);
    });

    it("rejects invalid url", () => {
        expect(() => assertSecureBaseUrl("not-a-url")).toThrow(/invalid base url/i);
    });
});
