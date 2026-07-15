import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationServiceManager } from "../../src/app-service/index.ts";
import { Method } from "../../src/http-api/method.ts";
import { ClientPrefix } from "../../src/http-api/prefix.ts";

describe("ApplicationServiceManager", () => {
    let manager: ApplicationServiceManager;
    let authedRequest: ReturnType<typeof vi.fn>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any;

    beforeEach(() => {
        authedRequest = vi.fn();
        client = {
            http: {
                authedRequest,
            },
            getDomain: vi.fn().mockReturnValue("example.com"),
        };
        manager = new ApplicationServiceManager(client);
    });

    it("gets user appservices through the v1 route", async () => {
        const response = {
            user_id: "@alice:example.com",
            appservices: [],
        };
        authedRequest.mockResolvedValue(response);

        await expect(manager.getUserAppservices("@alice:example.com")).resolves.toEqual(response);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/user/%40alice%3Aexample.com/appservice",
            undefined,
            undefined,
            { prefix: ClientPrefix.V1 },
        );
    });

    it("checks user id through the v3 appservice query route", async () => {
        authedRequest.mockResolvedValue({ exists: true });

        await expect(manager.checkUserId("@bot:example.com")).resolves.toBe(true);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/appservice/user",
            { user_id: "@bot:example.com" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("checks alias through the v3 appservice alias route", async () => {
        authedRequest.mockResolvedValue({ application_service: "irc-bridge" });

        await expect(manager.checkAlias("#irc:example.com")).resolves.toBe(true);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/appservice/alias",
            { alias: "#irc:example.com" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });

    it("lists thirdparty protocols through the v3 route", async () => {
        authedRequest.mockResolvedValue({ irc: {}, slack: {} });

        await expect(manager.getProtocols()).resolves.toEqual(["irc", "slack"]);

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/thirdparty/protocols", undefined, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("queries thirdparty users through the v3 route", async () => {
        const response = [{ user_id: "@alice:example.com" }];
        authedRequest.mockResolvedValue(response);

        await expect(manager.queryUsers("irc", { nick: "alice" })).resolves.toEqual(response);

        expect(authedRequest).toHaveBeenCalledWith(Method.Get, "/thirdparty/user/irc", { nick: "alice" }, undefined, {
            prefix: ClientPrefix.V3,
        });
    });

    it("queries thirdparty locations through the v3 route", async () => {
        const response = [{ alias: "#room:example.com" }];
        authedRequest.mockResolvedValue(response);

        await expect(manager.queryLocations("irc", { alias: "#room:example.com" })).resolves.toEqual(response);

        expect(authedRequest).toHaveBeenCalledWith(
            Method.Get,
            "/thirdparty/location/irc",
            { alias: "#room:example.com" },
            undefined,
            { prefix: ClientPrefix.V3 },
        );
    });
});
