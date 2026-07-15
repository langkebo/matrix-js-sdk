import { describe, expect, it, vi } from "vitest";

import { Method } from "../../src/http-api/method.ts";
import { ServerSupport } from "../../src/feature.ts";
import {
    buildCreateFilterPath,
    deleteUserAccountDataRequest,
    buildFilterPath,
    getUserAccountDataRequest,
    buildRoomAccountDataPath,
    buildRoomTagPath,
    buildRoomTagsPath,
    selectDeleteAccountDataRequestOptions,
    setUserAccountDataRequest,
    buildUserAccountDataListPath,
    buildUserAccountDataPath,
} from "../../src/client-account-data-requests.ts";

describe("client account-data request helpers", () => {
    it("builds user account data paths", () => {
        expect(buildUserAccountDataPath("@alice:example.org", "m.push_rules")).toBe(
            "/user/%40alice%3Aexample.org/account_data/m.push_rules",
        );
        expect(buildUserAccountDataListPath("@alice:example.org")).toBe("/user/%40alice%3Aexample.org/account_data/");
    });

    it("builds room account data and tags paths", () => {
        expect(buildRoomAccountDataPath("@alice:example.org", "!room:example.org", "m.fully_read")).toBe(
            "/user/%40alice%3Aexample.org/rooms/!room%3Aexample.org/account_data/m.fully_read",
        );
        expect(buildRoomTagsPath("@alice:example.org", "!room:example.org")).toBe(
            "/user/%40alice%3Aexample.org/rooms/!room%3Aexample.org/tags",
        );
        expect(buildRoomTagPath("@alice:example.org", "!room:example.org", "m.favourite")).toBe(
            "/user/%40alice%3Aexample.org/rooms/!room%3Aexample.org/tags/m.favourite",
        );
    });

    it("builds filter paths", () => {
        expect(buildCreateFilterPath("@alice:example.org")).toBe("/user/%40alice%3Aexample.org/filter");
        expect(buildFilterPath("@alice:example.org", "123")).toBe("/user/%40alice%3Aexample.org/filter/123");
    });

    it("dispatches set/get/delete user account-data requests", async () => {
        const authedRequest = vi.fn().mockResolvedValue({ ok: true });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await setUserAccountDataRequest("@alice:example.org", "m.fully_read", { event_id: "$a" }, authedRequest as any);
        expect(authedRequest).toHaveBeenNthCalledWith(
            1,
            Method.Put,
            "/user/%40alice%3Aexample.org/account_data/m.fully_read",
            undefined,
            { event_id: "$a" },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await getUserAccountDataRequest("@alice:example.org", "m.fully_read", authedRequest as any);
        expect(authedRequest).toHaveBeenNthCalledWith(
            2,
            Method.Get,
            "/user/%40alice%3Aexample.org/account_data/m.fully_read",
        );

        await deleteUserAccountDataRequest(
            "@alice:example.org",
            "m.fully_read",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            authedRequest as any,
            {
                prefix: "/_matrix/client/v3",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        );
        expect(authedRequest).toHaveBeenNthCalledWith(
            3,
            Method.Delete,
            "/user/%40alice%3Aexample.org/account_data/m.fully_read",
            undefined,
            undefined,
            { prefix: "/_matrix/client/v3" },
        );
    });

    it("selects delete account data request options from server support", () => {
        expect(selectDeleteAccountDataRequestOptions(ServerSupport.Unstable)).toEqual({
            prefix: "/_matrix/client/unstable/org.matrix.msc3391",
        });
        expect(selectDeleteAccountDataRequestOptions(ServerSupport.Stable)).toBeUndefined();
        expect(selectDeleteAccountDataRequestOptions(ServerSupport.Unsupported)).toBeUndefined();
        expect(selectDeleteAccountDataRequestOptions(undefined)).toBeUndefined();
    });
});
