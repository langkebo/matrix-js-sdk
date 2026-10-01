module.exports = {
    sourceMaps: true,
    presets: [
        [
            "@babel/preset-env",
            {
                targets: {
                    esmodules: true,
                },
                modules: false,
            },
        ],
        [
            "@babel/preset-typescript",
            {
                rewriteImportExtensions: true,
            },
        ],
    ],
    plugins: [
        ["@babel/plugin-proposal-decorators", { version: "2023-11" }],
        "@babel/plugin-transform-numeric-separator",
        "@babel/plugin-transform-class-properties",
        "@babel/plugin-transform-object-rest-spread",
        "@babel/plugin-syntax-dynamic-import",
        "@babel/plugin-transform-runtime",
        [
            "search-and-replace",
            {
                rules: [
                    // Stamp the package version into src/version.ts so that built artifacts can
                    // identify themselves in logs and User-Agent strings. Always enabled: unlike
                    // the rust-crypto rule below this is harmless under NODE_ENV=test, and leaving
                    // it conditional would make the version depend on how the build was invoked.
                    {
                        search: "__SDK_VERSION__",
                        replace: require("./package.json").version,
                    },
                    // Since rewriteImportExtensions doesn't work on dynamic imports (yet), we need to manually replace
                    // the dynamic rust-crypto import.
                    // (see https://github.com/babel/babel/issues/16750)
                    ...(process.env.NODE_ENV !== "test"
                        ? [
                              {
                                  search: "./rust-crypto/index.ts",
                                  replace: "./rust-crypto/index.js",
                              },
                          ]
                        : []),
                ],
            },
        ],
    ],
};
