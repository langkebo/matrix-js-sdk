import { describe, expect, it } from "vitest";

import { MatrixClient, type IClientWellKnown, type ITileServerWellKnown } from "../../src";

describe("IClientWellKnown m.tile_server", () => {
    const MAP_STYLE_URL = "https://tiles.example.com/style.json";

    it("exposes m.tile_server.map_style_url on IClientWellKnown", () => {
        const tileServer: ITileServerWellKnown = { map_style_url: MAP_STYLE_URL };
        const wellKnown: IClientWellKnown = {
            "m.homeserver": { base_url: "https://matrix.example.com" },
            "m.tile_server": tileServer,
        };

        expect(wellKnown["m.tile_server"]?.map_style_url).toBe(MAP_STYLE_URL);
    });

    it("reads m.tile_server.map_style_url through client.getClientWellKnown()", () => {
        const client = new MatrixClient({ baseUrl: "https://matrix.example.com" });
        client.clientWellKnown = {
            "m.homeserver": { base_url: "https://matrix.example.com" },
            "m.tile_server": { map_style_url: MAP_STYLE_URL },
        };

        // Compile-time assertion: the accessor chain resolves to `string | undefined`.
        const mapStyleUrl: string | undefined = client.getClientWellKnown()?.["m.tile_server"]?.map_style_url;
        expect(mapStyleUrl).toBe(MAP_STYLE_URL);
    });
});
