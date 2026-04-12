import { describe, expect, it } from "vitest";

import { ClientPrefix } from "../../src/http-api/index.ts";
import {
    buildAvatarUrlBody,
    buildDisplayNameBody,
    buildExtendedProfilePropertyBody,
    buildExtendedProfilePropertyPath,
    buildProfileFieldPath,
    buildProfilePath,
    selectExtendedProfileRequestPrefix,
} from "../../src/client-profile-requests.ts";

describe("client profile request helpers", () => {
    it("builds profile paths", () => {
        expect(buildProfilePath("@alice:example.org")).toBe("/profile/%40alice%3Aexample.org");
        expect(buildProfileFieldPath("@alice:example.org", "displayname")).toBe(
            "/profile/%40alice%3Aexample.org/displayname",
        );
        expect(buildProfileFieldPath("@alice:example.org", "avatar_url")).toBe(
            "/profile/%40alice%3Aexample.org/avatar_url",
        );
        expect(buildExtendedProfilePropertyPath("@alice:example.org", "timezone")).toBe(
            "/profile/%40alice%3Aexample.org/timezone",
        );
    });

    it("builds displayname, avatar and extended profile bodies", () => {
        expect(buildDisplayNameBody("Alice")).toEqual({ displayname: "Alice" });
        expect(buildAvatarUrlBody("mxc://example.org/abc123")).toEqual({ avatar_url: "mxc://example.org/abc123" });
        expect(buildExtendedProfilePropertyBody("timezone", "UTC+8")).toEqual({ timezone: "UTC+8" });
    });

    it("selects extended profile prefix from support flags", () => {
        expect(selectExtendedProfileRequestPrefix(true, false)).toBe(ClientPrefix.V3);
        expect(selectExtendedProfileRequestPrefix(false, true)).toBe(ClientPrefix.V3);
        expect(selectExtendedProfileRequestPrefix(false, false)).toBe("/_matrix/client/unstable/uk.tcpip.msc4133");
    });
});
