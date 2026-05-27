import jsdoc from "eslint-plugin-jsdoc";
import n from "eslint-plugin-n";
import importX from "eslint-plugin-import-x";
import unicorn from "eslint-plugin-unicorn";
import vitest from "@vitest/eslint-plugin";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
    // Global ignores
    {
        ignores: [
            "lib/**",
            "coverage/**",
            "node_modules/**",
            "eslint.config.mjs",
            "_docs/**",
            "src/matrix-client-extensions.d.ts",
        ],
    },

    // Base JavaScript config (inlined from eslint-plugin-matrix-org/javascript + google + eslint:recommended)
    {
        plugins: {
            jsdoc,
            n,
            "import-x": importX,
            unicorn,
        },
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
            },
        },
        settings: {
            "import-x/resolver": {
                typescript: true,
                node: true,
            },
        },
        rules: {
            // eslint:recommended rules (already included by tseslint.configs.base)
            "no-empty": "off",
            "no-useless-catch": "off",

            // matrix-org/javascript base rules
            curly: ["error", "multi-line"],
            "prefer-const": "error",
            "comma-dangle": [
                "error",
                {
                    arrays: "always-multiline",
                    objects: "always-multiline",
                    imports: "always-multiline",
                    exports: "always-multiline",
                    functions: "always-multiline",
                },
            ],
            "arrow-spacing": "error",
            "space-in-parens": "error",
            "jsdoc/require-jsdoc": [
                "error",
                {
                    require: {
                        FunctionDeclaration: false,
                    },
                },
            ],
            "jsdoc/valid-types": "error",
            "no-prototype-builtins": "off",
            "no-multiple-empty-lines": ["error", { max: 1 }],
            "import-x/first": "off",
            "unicorn/no-instanceof-array": "error",
            "object-curly-spacing": ["error", "always"],

            // Project-specific overrides (from .eslintrc.cjs)
            "@typescript-eslint/no-base-to-string": "off",
            "no-var": "error",
            "prefer-rest-params": "error",
            "prefer-spread": "error",
            "one-var": "error",
            "padded-blocks": "error",
            "no-extend-native": "error",
            camelcase: "error",
            "no-multi-spaces": ["error", { ignoreEOLComments: true }],
            "space-before-function-paren": [
                "error",
                {
                    anonymous: "never",
                    named: "never",
                    asyncArrow: "always",
                },
            ],
            "arrow-parens": "off",
            "prefer-promise-reject-errors": "off",
            "no-constant-condition": "off",
            "no-async-promise-executor": "off",
            "no-console": "error",

            "no-restricted-imports": [
                "error",
                {
                    name: "events",
                    message: "Please use TypedEventEmitter instead",
                },
            ],
            "no-restricted-properties": [
                "error",
                {
                    object: "window",
                    property: "setImmediate",
                    message: "Use setTimeout instead.",
                },
            ],
            "no-restricted-globals": [
                "error",
                {
                    name: "setImmediate",
                    message: "Use setTimeout instead.",
                },
                {
                    name: "global",
                    message: "Use globalThis instead.",
                },
            ],

            "import-x/no-restricted-paths": [
                "error",
                {
                    zones: [
                        {
                            target: "./src/",
                            from: "./src/index.ts",
                            message:
                                "The package index is dynamic between src and lib depending on " +
                                "whether release or development, target the specific module or matrix.ts instead",
                        },
                    ],
                },
            ],
        },
    },

    // TypeScript config (inlined from eslint-plugin-matrix-org/typescript)
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts"],
        plugins: {
            jsdoc,
        },
        languageOptions: {
            parserOptions: {
                project: ["./tsconfig.eslint.json"],
            },
        },
        rules: {
            // matrix-org/typescript base rules
            "@typescript-eslint/no-unused-vars": ["error", { args: "none", ignoreRestSiblings: true }],
            "valid-jsdoc": "off",
            "@typescript-eslint/naming-convention": [
                "error",
                {
                    selector: ["parameterProperty", "classMethod", "typeMethod", "accessor"],
                    format: ["camelCase"],
                    leadingUnderscore: "forbid",
                },
                {
                    selector: ["function", "parameter", "objectLiteralMethod"],
                    format: ["camelCase", "PascalCase"],
                    leadingUnderscore: "allow",
                },
                {
                    selector: ["class", "typeAlias", "typeParameter"],
                    format: ["PascalCase"],
                    leadingUnderscore: "forbid",
                },
            ],
            "@typescript-eslint/explicit-function-return-type": "error",
            "@typescript-eslint/explicit-member-accessibility": "error",
            "@typescript-eslint/no-base-to-string": "error",
            "@typescript-eslint/consistent-type-exports": "error",
            "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],

            // Project-specific overrides for .ts files
            "@typescript-eslint/no-empty-interface": "off",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-empty-object-type": [
                "error",
                {
                    allowInterfaces: "with-single-extends",
                },
            ],
            quotes: "off",
            "no-console": "error",
            // No @babel plugin in flat config
            "@babel/no-invalid-this": "off",
            // jsdoc/valid-types is too strict for existing JSDoc
            "jsdoc/valid-types": "off",
        },
    },

    // src/**/*.ts specific rules
    {
        files: ["src/**/*.ts"],
        rules: {
            "jsdoc/no-types": "error",
            "jsdoc/empty-tags": "error",
            "jsdoc/check-property-names": "error",
            "jsdoc/check-values": "error",
            "@typescript-eslint/explicit-member-accessibility": "off",
            "@typescript-eslint/consistent-type-imports": "off",
            "@typescript-eslint/consistent-type-exports": "off",
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/no-base-to-string": "off",
            "import-x/order": "off",
            "n/file-extension-in-import": "off",
            "@stylistic/semi": "off",
            "@stylistic/member-delimiter-style": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    ignoreRestSiblings: true,
                },
            ],
            "no-restricted-imports": "off",
            "@typescript-eslint/no-unsafe-function-type": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            "no-extra-boolean-cast": "error",
            // API field names use snake_case
            camelcase: "off",
            // Allow multiple const declarations
            "one-var": "off",
            // Allow snake_case in naming convention for API fields
            "@typescript-eslint/naming-convention": "off",
            // JSDoc not required for all source files
            "jsdoc/require-jsdoc": "off",
        },
    },

    // spec/**/*.ts (test files)
    {
        files: ["spec/**/*.ts", "spec/**/*.cjs", "spec/**/*.js"],
        plugins: {
            vitest,
        },
        languageOptions: {
            globals: {
                ...globals.vitest,
            },
        },
        rules: {
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/explicit-member-accessibility": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/consistent-type-exports": "off",
            "@typescript-eslint/consistent-type-imports": "off",
            "@typescript-eslint/no-base-to-string": "off",
            "@typescript-eslint/naming-convention": "off",
            camelcase: "off",
            "no-empty": "off",
            "one-var": "off",
            "jsdoc/require-jsdoc": "off",
            "jsdoc/valid-types": "off",
            "require-jsdoc": "off",
            "valid-jsdoc": "off",
            "vitest/no-disabled-tests": "off",
            "vitest/no-standalone-expect": [
                "error",
                {
                    additionalTestBlockFunctions: ["beforeAll", "beforeEach"],
                },
            ],
            "vitest/expect-expect": [
                "error",
                {
                    assertFunctionNames: [
                        "expect",
                        "expectDevices",
                        "assert.isTrue",
                        "assert.isFalse",
                        "passwordTest",
                        "compareHeaders",
                        "doTest",
                    ],
                },
            ],
        },
    },

    // spec/integ/real-backend/**/*.ts
    {
        files: ["spec/integ/real-backend/**/*.ts"],
        rules: {
            "no-console": "off",
            "@typescript-eslint/no-unused-vars": "off",
        },
    },

    // MatrixRTC stricter promise rules
    {
        files: ["src/matrixrtc/**/*.ts", "spec/unit/matrixrtc/*.ts"],
        rules: {
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/require-await": "error",
            "@typescript-eslint/await-thenable": "error",
        },
    },

    // Prettier config (must be last to override formatting rules)
    prettierConfig,
);
