#!/usr/bin/env node
/**
 * 判定逻辑在 ./lib/granular-coverage.mjs（18 个 granular 门禁共用）。
 * 本文件只维护下面的 CHECKS 数据 —— 改判据请改共享库，并跑 spec/unit/granular-coverage-gate.spec.ts。
 */

import { runGranularCoverage } from "./lib/granular-coverage.mjs";

const CHECKS = [
    {
        module: "captcha",
        groups: [
            {
                name: "CaptchaManager public registration captcha APIs",
                ownerFile: "src/captcha/index.ts",
                methods: ["sendCaptcha", "verifyCaptcha", "getCaptchaStatus"],
                testFiles: ["spec/unit/captcha.spec.ts"],
            },
            {
                name: "CaptchaManager admin cleanup API",
                ownerFile: "src/captcha/index.ts",
                methods: ["cleanupExpiredCaptchas"],
                testFiles: ["spec/unit/captcha.spec.ts"],
            },
        ],
    },
];

runGranularCoverage({ title: "Captcha Granular Coverage", checks: CHECKS });
