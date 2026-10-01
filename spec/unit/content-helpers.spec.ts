import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";

import { LocationAssetType, M_ASSET, M_LOCATION, M_TIMESTAMP } from "../../src/@types/location";
import { M_TEXT, REFERENCE_RELATION } from "../../src/@types/extensible_events";
import {
    getTextForLocationEvent,
    makeBeaconContent,
    makeBeaconInfoContent,
    makeLocationContent,
} from "../../src/content-helpers";

describe("Location content helpers", () => {
    describe("getTextForLocationEvent()", () => {
        it("renders user asset + description + uri + date", () => {
            const text = getTextForLocationEvent("geo:foo", LocationAssetType.Self, 134235435, "desc");

            expect(text).toBe('User Location "desc" geo:foo at 1970-01-02T13:17:15.435Z');
        });

        it("renders non-user asset without the User prefix", () => {
            const text = getTextForLocationEvent("geo:foo", LocationAssetType.Pin, 134235435);

            expect(text).toBe("Location geo:foo at 1970-01-02T13:17:15.435Z");
        });
    });

    describe("makeLocationContent()", () => {
        it("creates a valid location with defaults", () => {
            const loc = makeLocationContent(undefined, "geo:foo", 134235435);

            expect(loc.body).toEqual("User Location geo:foo at 1970-01-02T13:17:15.435Z");
            expect(loc.msgtype).toEqual("m.location");
            expect(loc.geo_uri).toEqual("geo:foo");
            expect(M_LOCATION.findIn(loc)).toEqual({ uri: "geo:foo", description: undefined });
            expect(M_ASSET.findIn(loc)).toEqual({ type: LocationAssetType.Self });
            expect(M_TEXT.findIn(loc)).toEqual("User Location geo:foo at 1970-01-02T13:17:15.435Z");
            expect(M_TIMESTAMP.findIn(loc)).toEqual(134235435);
        });

        it("creates a valid location with explicit properties", () => {
            const loc = makeLocationContent(undefined, "geo:bar", 134235436, "desc", LocationAssetType.Pin);

            expect(loc.body).toEqual('Location "desc" geo:bar at 1970-01-02T13:17:15.436Z');
            expect(loc.msgtype).toEqual("m.location");
            expect(loc.geo_uri).toEqual("geo:bar");
            expect(M_LOCATION.findIn(loc)).toEqual({ uri: "geo:bar", description: "desc" });
            expect(M_ASSET.findIn(loc)).toEqual({ type: LocationAssetType.Pin });
            expect(M_TEXT.findIn(loc)).toEqual('Location "desc" geo:bar at 1970-01-02T13:17:15.436Z');
            expect(M_TIMESTAMP.findIn(loc)).toEqual(134235436);
        });

        it("omits the timestamp when not provided", () => {
            const loc = makeLocationContent("custom text", "geo:baz");

            expect(loc.body).toEqual("custom text");
            expect(M_TIMESTAMP.findIn(loc)).toBeFalsy();
            expect(M_ASSET.findIn(loc)).toEqual({ type: LocationAssetType.Self });
        });
    });
});

describe("Beacon content helpers", () => {
    const mockDateNow = 123456789;

    beforeEach(() => {
        vi.spyOn(globalThis.Date, "now").mockReturnValue(mockDateNow);
    });

    afterAll(() => {
        vi.spyOn(globalThis.Date, "now").mockRestore();
    });

    describe("makeBeaconInfoContent()", () => {
        it("creates fully defined top-level beacon_info content", () => {
            const content = makeBeaconInfoContent(1234, true, "nice beacon_info", LocationAssetType.Pin, 99999);

            expect(content.description).toBe("nice beacon_info");
            expect(content.timeout).toBe(1234);
            expect(content.live).toBe(true);
            expect(M_TIMESTAMP.findIn(content)).toBe(99999);
            expect(M_ASSET.findIn(content)).toEqual({ type: LocationAssetType.Pin });
        });

        it("defaults timestamp to current time", () => {
            const content = makeBeaconInfoContent(1234, true, "nice beacon_info", LocationAssetType.Pin);

            expect(M_TIMESTAMP.findIn(content)).toBe(mockDateNow);
        });

        it("defaults asset type to self when not set", () => {
            const content = makeBeaconInfoContent(1234, true, "nice beacon_info");

            expect(M_ASSET.findIn(content)).toEqual({ type: LocationAssetType.Self });
        });
    });

    describe("makeBeaconContent()", () => {
        it("creates content without description", () => {
            const content = makeBeaconContent("geo:foo", 123, "$1234");

            expect(M_LOCATION.findIn(content)).toEqual({ description: undefined, uri: "geo:foo" });
            expect(M_TIMESTAMP.findIn(content)).toBe(123);
            expect(content["m.relates_to"]).toEqual({
                rel_type: REFERENCE_RELATION.name,
                event_id: "$1234",
            });
        });

        it("creates content with description", () => {
            const content = makeBeaconContent("geo:foo", 123, "$1234", "test description");

            expect(M_LOCATION.findIn(content)).toEqual({ description: "test description", uri: "geo:foo" });
            expect(M_TIMESTAMP.findIn(content)).toBe(123);
            expect(content["m.relates_to"]).toEqual({
                rel_type: REFERENCE_RELATION.name,
                event_id: "$1234",
            });
        });
    });
});
