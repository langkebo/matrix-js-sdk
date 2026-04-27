#!/usr/bin/env node

/**
 * Account Data 契约验证脚本
 *
 * 验证 SDK 实现与后端契约文档的一致性
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function logSection(title) {
    console.log('\n' + '='.repeat(80));
    log(title, 'cyan');
    console.log('='.repeat(80));
}

function logSuccess(message) {
    log(`✓ ${message}`, 'green');
}

function logError(message) {
    log(`✗ ${message}`, 'red');
}

function logWarning(message) {
    log(`⚠ ${message}`, 'yellow');
}

// 验证项目
const verifications = {
    passed: 0,
    failed: 0,
    warnings: 0,
};

// 1. 验证契约文档存在
logSection('1. 验证契约文档');

const contractPath = path.join(__dirname, '../docs/api-contract/account-data.md');
if (fs.existsSync(contractPath)) {
    logSuccess('契约文档存在: docs/api-contract/account-data.md');
    verifications.passed++;
} else {
    logError('契约文档不存在');
    verifications.failed++;
}

// 2. 验证 SDK 实现文件
logSection('2. 验证 SDK 实现文件');

const sdkFiles = [
    'src/account-data/index.ts',
    'src/client-account-data-requests.ts',
    'spec/unit/account-data.spec.ts',
];

sdkFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        logSuccess(`文件存在: ${file}`);
        verifications.passed++;
    } else {
        logError(`文件不存在: ${file}`);
        verifications.failed++;
    }
});

// 3. 验证常量定义
logSection('3. 验证数据约束常量');

const accountDataIndexPath = path.join(__dirname, '../src/account-data/index.ts');
const accountDataContent = fs.readFileSync(accountDataIndexPath, 'utf-8');

const constraints = [
    { name: 'MAX_DATA_TYPE_LENGTH', value: '128', pattern: /MAX_DATA_TYPE_LENGTH\s*=\s*128/ },
    { name: 'MAX_CONTENT_SIZE', value: '65536', pattern: /MAX_CONTENT_SIZE\s*=\s*65536/ },
];

constraints.forEach(({ name, value, pattern }) => {
    if (pattern.test(accountDataContent)) {
        logSuccess(`常量定义正确: ${name} = ${value}`);
        verifications.passed++;
    } else {
        logError(`常量定义缺失或错误: ${name}`);
        verifications.failed++;
    }
});

// 4. 验证方法实现
logSection('4. 验证 AccountDataManager 方法');

const requiredMethods = [
    'setAccountData',
    'getAccountData',
    'getAccountDataFromServer',
    'listAccountData',
    'getRoomAccountDataFromServer',
    'setRoomAccountData',
    'deleteAccountData',
    'deleteRoomAccountData',
    'validateDataType',
    'validateContentSize',
];

requiredMethods.forEach(method => {
    const methodPattern = new RegExp(`(public|private)\\s+(async\\s+)?${method}\\s*[<(]`);
    if (methodPattern.test(accountDataContent)) {
        logSuccess(`方法已实现: ${method}`);
        verifications.passed++;
    } else {
        logError(`方法未实现: ${method}`);
        verifications.failed++;
    }
});

// 5. 验证路径构建函数
logSection('5. 验证路径构建函数');

const requestsPath = path.join(__dirname, '../src/client-account-data-requests.ts');
const requestsContent = fs.readFileSync(requestsPath, 'utf-8');

const pathBuilders = [
    'buildUserAccountDataPath',
    'buildUserAccountDataListPath',
    'buildRoomAccountDataPath',
    'buildCreateFilterPath',
    'buildFilterPath',
];

pathBuilders.forEach(builder => {
    const pattern = new RegExp(`export\\s+function\\s+${builder}`);
    if (pattern.test(requestsContent)) {
        logSuccess(`路径构建函数已实现: ${builder}`);
        verifications.passed++;
    } else {
        logError(`路径构建函数未实现: ${builder}`);
        verifications.failed++;
    }
});

// 6. 验证测试覆盖
logSection('6. 验证测试覆盖');

const testPath = path.join(__dirname, '../spec/unit/account-data.spec.ts');
const testContent = fs.readFileSync(testPath, 'utf-8');

const testSuites = [
    'setAccountData',
    'getAccountData',
    'getAccountDataFromServer',
    'listAccountData',
    'getRoomAccountDataFromServer',
    'setRoomAccountData',
    'deleteAccountData',
    'deleteRoomAccountData',
    'Data Validation',
    'Error Handling',
];

testSuites.forEach(suite => {
    const pattern = new RegExp(`describe\\s*\\(\\s*["'\`]${suite}["'\`]`);
    if (pattern.test(testContent)) {
        logSuccess(`测试套件存在: ${suite}`);
        verifications.passed++;
    } else {
        logError(`测试套件缺失: ${suite}`);
        verifications.failed++;
    }
});

// 7. 验证数据验证逻辑
logSection('7. 验证数据验证逻辑');

const validations = [
    { name: '数据类型长度验证', pattern: /data_type too long/ },
    { name: '内容大小验证', pattern: /Account data too large/ },
    { name: 'validateDataType 调用', pattern: /this\.validateDataType\(eventType\)/ },
    { name: 'validateContentSize 调用', pattern: /this\.validateContentSize\(content\)/ },
];

validations.forEach(({ name, pattern }) => {
    if (pattern.test(accountDataContent)) {
        logSuccess(`验证逻辑存在: ${name}`);
        verifications.passed++;
    } else {
        logError(`验证逻辑缺失: ${name}`);
        verifications.failed++;
    }
});

// 8. 验证契约文档内容
logSection('8. 验证契约文档内容');

const contractContent = fs.readFileSync(contractPath, 'utf-8');

const contractSections = [
    { name: '概述', pattern: /## 概述/ },
    { name: '挂载版本', pattern: /## 挂载版本/ },
    { name: '路由清单', pattern: /## 路由清单/ },
    { name: '接口详细说明', pattern: /## 接口详细说明/ },
    { name: '数据库表结构', pattern: /## 数据库表结构/ },
    { name: '权限约束', pattern: /## 权限约束/ },
    { name: '错误码', pattern: /## 错误码/ },
    { name: '常见 Account Data 类型', pattern: /## 常见 Account Data 类型/ },
    { name: '版本变更记录', pattern: /## 版本变更记录/ },
];

contractSections.forEach(({ name, pattern }) => {
    if (pattern.test(contractContent)) {
        logSuccess(`契约文档章节存在: ${name}`);
        verifications.passed++;
    } else {
        logError(`契约文档章节缺失: ${name}`);
        verifications.failed++;
    }
});

// 9. 验证接口端点
logSection('9. 验证接口端点');

const endpoints = [
    { name: 'GET /user/{user_id}/account_data/', pattern: /GET.*\/user\/\{user_id\}\/account_data\// },
    { name: 'GET /user/{user_id}/account_data/{type}', pattern: /GET.*\/user\/\{user_id\}\/account_data\/\{type\}/ },
    { name: 'PUT /user/{user_id}/account_data/{type}', pattern: /PUT.*\/user\/\{user_id\}\/account_data\/\{type\}/ },
    { name: 'DELETE /user/{user_id}/account_data/{type}', pattern: /DELETE.*\/user\/\{user_id\}\/account_data\/\{type\}/ },
    { name: 'GET /user/{user_id}/rooms/{room_id}/account_data/{type}', pattern: /GET.*\/user\/\{user_id\}\/rooms\/\{room_id\}\/account_data\/\{type\}/ },
    { name: 'PUT /user/{user_id}/rooms/{room_id}/account_data/{type}', pattern: /PUT.*\/user\/\{user_id\}\/rooms\/\{room_id\}\/account_data\/\{type\}/ },
    { name: 'DELETE /user/{user_id}/rooms/{room_id}/account_data/{type}', pattern: /DELETE.*\/user\/\{user_id\}\/rooms\/\{room_id\}\/account_data\/\{type\}/ },
];

endpoints.forEach(({ name, pattern }) => {
    if (pattern.test(contractContent)) {
        logSuccess(`端点已文档化: ${name}`);
        verifications.passed++;
    } else {
        logError(`端点未文档化: ${name}`);
        verifications.failed++;
    }
});

// 10. 验证错误码
logSection('10. 验证错误码');

const errorCodes = [
    'M_FORBIDDEN',
    'M_NOT_FOUND',
    'M_BAD_JSON',
    'M_INVALID_PARAM',
    'M_TOO_LARGE',
    'M_UNKNOWN',
];

errorCodes.forEach(code => {
    const pattern = new RegExp(`\`${code}\``);
    if (pattern.test(contractContent)) {
        logSuccess(`错误码已文档化: ${code}`);
        verifications.passed++;
    } else {
        logError(`错误码未文档化: ${code}`);
        verifications.failed++;
    }
});

// 11. 验证数据库表
logSection('11. 验证数据库表');

const tables = [
    'account_data',
    'room_account_data',
    'filters',
    'openid_tokens',
];

tables.forEach(table => {
    const pattern = new RegExp(`CREATE TABLE.*${table}`);
    if (pattern.test(contractContent)) {
        logSuccess(`数据库表已文档化: ${table}`);
        verifications.passed++;
    } else {
        logError(`数据库表未文档化: ${table}`);
        verifications.failed++;
    }
});

// 12. 验证数据约束文档
logSection('12. 验证数据约束文档');

const documentedConstraints = [
    { name: 'data_type 最大长度: 128', pattern: /128\s*字符/ },
    { name: '内容最大大小: 64KB', pattern: /64KB|65536/ },
    { name: 'Filter ID 长度: 16', pattern: /16\s*字符.*随机/ },
    { name: 'OpenID Token 长度: 32', pattern: /32\s*字符.*token/ },
    { name: 'OpenID Token 有效期: 3600秒', pattern: /3600.*秒|1\s*小时/ },
];

documentedConstraints.forEach(({ name, pattern }) => {
    if (pattern.test(contractContent)) {
        logSuccess(`约束已文档化: ${name}`);
        verifications.passed++;
    } else {
        logWarning(`约束可能未文档化: ${name}`);
        verifications.warnings++;
    }
});

// 总结
logSection('验证总结');

const total = verifications.passed + verifications.failed + verifications.warnings;
const passRate = ((verifications.passed / total) * 100).toFixed(2);

console.log(`\n总计: ${total} 项验证`);
log(`✓ 通过: ${verifications.passed}`, 'green');
log(`✗ 失败: ${verifications.failed}`, 'red');
log(`⚠ 警告: ${verifications.warnings}`, 'yellow');
log(`\n通过率: ${passRate}%`, verifications.failed === 0 ? 'green' : 'yellow');

if (verifications.failed === 0) {
    log('\n🎉 所有验证通过！文档与实现完全一致。', 'green');
    process.exit(0);
} else {
    log('\n❌ 存在验证失败项，请检查并修复。', 'red');
    process.exit(1);
}
