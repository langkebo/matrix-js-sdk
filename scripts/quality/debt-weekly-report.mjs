#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const inventoryPath = path.resolve(rootDir, "scripts/quality/technical-debt-inventory.json");
const baselinePath = path.resolve(rootDir, "scripts/quality/technical-debt-baseline.json");
const reportsDir = path.resolve(rootDir, "docs/governance");

function getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

function readInventory() {
    if (!fs.existsSync(inventoryPath)) {
        return { summary: { total: 0, todo: 0, fixme: 0, hack: 0, xxx: 0 }, items: [] };
    }
    return JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
}

function readBaseline() {
    if (!fs.existsSync(baselinePath)) {
        return { ids: [] };
    }
    return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

function groupByOwner(items) {
    const groups = new Map();
    for (const item of items) {
        const owner = item.owner || "unassigned";
        if (!groups.has(owner)) {
            groups.set(owner, []);
        }
        groups.get(owner).push(item);
    }
    return groups;
}

function groupByModule(items) {
    const groups = new Map();
    for (const item of items) {
        const parts = item.filePath.split("/");
        const module = parts.length > 1 ? parts[1] : "root";
        if (!groups.has(module)) {
            groups.set(module, []);
        }
        groups.get(module).push(item);
    }
    return groups;
}

function generateReport() {
    const now = new Date();
    const year = now.getFullYear();
    const week = getWeekNumber(now);
    const dateStr = now.toISOString().slice(0, 10);

    const inventory = readInventory();
    const baseline = readBaseline();
    const baselineIds = new Set(baseline.ids || []);

    const newItems = inventory.items.filter((item) => !baselineIds.has(item.id));
    const resolvedIds = [...baselineIds].filter((id) => !inventory.items.find((item) => item.id === id));

    const byOwner = groupByOwner(inventory.items);
    const byModule = groupByModule(inventory.items);

    const report = `# 技术债务周报 ${year}-W${week.toString().padStart(2, "0")}

> 报告周期: ${year}-W${week}
> 生成日期: ${dateStr}
> 扫描工具: \`scripts/quality/scan-technical-debt.mjs\`

## 一、债务概览

### 1.1 本周统计

| 指标 | 上周 | 本周 | 变化 |
|------|------|------|------|
| 总债务数 | ${baseline.ids?.length || 0} | ${inventory.summary.total} | ${inventory.summary.total - (baseline.ids?.length || 0) > 0 ? "+" : ""}${inventory.summary.total - (baseline.ids?.length || 0)} |
| TODO (P1) | - | ${inventory.summary.todo} | - |
| FIXME (P0) | - | ${inventory.summary.fixme} | - |
| HACK (P2) | - | ${inventory.summary.hack} | - |
| XXX (P3) | - | ${inventory.summary.xxx} | - |

### 1.2 本周新增债务 (${newItems.length} 项)

${newItems.length > 0 ? newItems.map((item) => `| ${item.filePath} | ${item.line} | ${item.markerType} | ${item.snippet.slice(0, 50)} | ${item.owner} | - |`).join("\n") : "无新增债务"}

### 1.3 本周解决债务 (${resolvedIds.size} 项)

${resolvedIds.size > 0 ? `已解决 ${resolvedIds.size} 项债务` : "无解决债务"}

## 二、到期债务提醒

### 2.1 已超期债务

${
    inventory.items
        .filter((item) => item.dueDate && new Date(item.dueDate) < now)
        .map(
            (item) =>
                `| ${item.filePath} | ${item.line} | ${item.markerType} | ${item.snippet.slice(0, 50)} | ${item.owner} | ${item.dueDate} | ${Math.floor((now - new Date(item.dueDate)) / 86400000)} |`,
        )
        .join("\n") || "无超期债务"
}

### 2.2 本周到期的债务

${
    inventory.items
        .filter((item) => {
            if (!item.dueDate) return false;
            const due = new Date(item.dueDate);
            const weekEnd = new Date(now);
            weekEnd.setDate(weekEnd.getDate() + 7);
            return due >= now && due <= weekEnd;
        })
        .map(
            (item) =>
                `| ${item.filePath} | ${item.line} | ${item.markerType} | ${item.snippet.slice(0, 50)} | ${item.owner} | ${item.dueDate} |`,
        )
        .join("\n") || "无本周到期债务"
}

## 三、责任人任务分配

| 责任人 | 待处理数 | 本周新增 | 本周解决 | 备注 |
|--------|----------|----------|----------|------|
${[...byOwner.entries()]
    .map(([owner, items]) => {
        const ownerNewItems = newItems.filter((i) => i.owner === owner);
        const ownerResolvedItems = resolvedIds.size;
        return `| ${owner} | ${items.length} | ${ownerNewItems.length} | - | - |`;
    })
    .join("\n")}

## 四、模块分布

| 模块 | 债务数 | 占比 |
|------|--------|------|
${[...byModule.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(
        ([module, items]) =>
            `| ${module}/ | ${items.length} | ${((items.length / inventory.summary.total) * 100).toFixed(1)}% |`,
    )
    .join("\n")}

## 五、风险与建议

### 5.1 风险项

${newItems.some((i) => i.markerType === "FIXME" || i.markerType === "HACK") ? "- [ ] 发现新增高优先级债务 (FIXME/HACK)" : "- [ ] 无高风险项"}

### 5.2 建议

${inventory.summary.total > 100 ? "- [ ] 债务数量较多，建议优先处理高优先级项" : "- [ ] 债务数量可控，继续保持"}

---

*本报告由 \`scripts/quality/debt-weekly-report.mjs\` 自动生成*
`;

    const reportPath = path.resolve(reportsDir, `debt-weekly-report-${year}-W${week.toString().padStart(2, "0")}.md`);
    fs.writeFileSync(reportPath, report, "utf8");
    console.log(`[debt-weekly-report] Generated: ${reportPath}`);
}

generateReport();
