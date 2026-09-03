const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const contractsRoot = path.join(repoRoot, "docs", "api-contract");

const PREFIX_MAP = {
    "ClientPrefix.V1": "/_matrix/client/v1",
    "ClientPrefix.V3": "/_matrix/client/v3",
    "ClientPrefix.Unstable": "/_matrix/client/unstable",
    "AdminPrefix.V1": "/_synapse/admin/v1",
    "MediaPrefix.V1": "/_matrix/media/v1",
    "MediaPrefix.V3": "/_matrix/media/v3",
    "IdentityPrefix.V2": "/_matrix/identity/v2",
    "VendorPrefix": "/_matrix/vendor/v1",
};

function walk(dir, predicate = () => true, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, predicate, acc);
        } else if (predicate(fullPath)) {
            acc.push(fullPath);
        }
    }
    return acc;
}

function findVariableInitializer(name, fromNode, sourceFile) {
    function getStatements(node) {
        if (!node) return [];
        if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
            return node.statements ?? [];
        }
        if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
            return node.statements ?? [];
        }
        return [];
    }

    function findInBindingName(bindingName, initializer) {
        if (ts.isIdentifier(bindingName)) {
            return bindingName.text === name ? initializer : undefined;
        }
        if (ts.isObjectBindingPattern(bindingName)) {
            for (const element of bindingName.elements) {
                if (element.propertyName && ts.isIdentifier(element.name) && element.name.text === name) {
                    if (
                        initializer &&
                        ts.isObjectLiteralExpression(initializer) &&
                        ts.isIdentifier(element.propertyName)
                    ) {
                        for (const property of initializer.properties) {
                            if (!ts.isPropertyAssignment(property)) continue;
                            if (property.name.getText(sourceFile) === element.propertyName.text) {
                                return property.initializer;
                            }
                        }
                    }
                }
                const found = findInBindingName(element.name, initializer);
                if (found) return found;
            }
        }
        return undefined;
    }

    function findInStatements(statements, limitPos) {
        for (let i = statements.length - 1; i >= 0; i -= 1) {
            const statement = statements[i];
            if (statement.pos >= limitPos) continue;
            if (!ts.isVariableStatement(statement)) continue;
            for (let j = statement.declarationList.declarations.length - 1; j >= 0; j -= 1) {
                const declaration = statement.declarationList.declarations[j];
                const found = findInBindingName(declaration.name, declaration.initializer);
                if (found) return found;
            }
        }
        return undefined;
    }

    let current = fromNode;
    while (current) {
        const statements = getStatements(current);
        const found = findInStatements(statements, fromNode.pos);
        if (found) return found;
        current = current.parent;
    }

    return undefined;
}

function extractPropertyFromObjectLiteral(node, propertyName) {
    if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
    for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (property.name.getText() === propertyName) {
            return property.initializer;
        }
    }
    return undefined;
}

function resolveStringVariants(node, sourceFile, fromNode, seen = new Set()) {
    if (!node) return undefined;

    const cacheKey = `${node.pos}:${node.end}`;
    if (seen.has(cacheKey)) return undefined;
    seen.add(cacheKey);

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return [node.text];
    }

    if (ts.isParenthesizedExpression(node)) {
        return resolveStringVariants(node.expression, sourceFile, fromNode, seen);
    }

    if (ts.isTemplateExpression(node)) {
        let text = node.head.text;
        for (const span of node.templateSpans) {
            text += "{}";
            text += span.literal.text;
        }
        return [text];
    }

    if (ts.isConditionalExpression(node)) {
        const whenTrue = resolveStringVariants(node.whenTrue, sourceFile, fromNode, seen) ?? [];
        const whenFalse = resolveStringVariants(node.whenFalse, sourceFile, fromNode, seen) ?? [];
        const merged = [...new Set([...whenTrue, ...whenFalse])];
        return merged.length > 0 ? merged : undefined;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = resolveStringVariants(node.left, sourceFile, fromNode, seen);
        const right = resolveStringVariants(node.right, sourceFile, fromNode, seen);
        if (!left || !right) return undefined;
        const combined = [];
        for (const l of left) {
            for (const r of right) {
                combined.push(`${l}${r}`);
            }
        }
        return [...new Set(combined)];
    }

    if (ts.isIdentifier(node)) {
        const initializer = findVariableInitializer(node.text, fromNode, sourceFile);
        return initializer ? resolveStringVariants(initializer, sourceFile, initializer, seen) : undefined;
    }

    if (ts.isPropertyAccessExpression(node)) {
        const base = ts.isIdentifier(node.expression)
            ? findVariableInitializer(node.expression.text, fromNode, sourceFile)
            : undefined;
        const propertyInitializer = extractPropertyFromObjectLiteral(base, node.name.text);
        if (propertyInitializer) {
            return resolveStringVariants(propertyInitializer, sourceFile, propertyInitializer, seen);
        }

        const directText = node.getText(sourceFile);
        if (
            directText &&
            ((ts.isIdentifier(node.expression) && /^[A-Z]/.test(node.expression.text)) ||
                ts.isPropertyAccessExpression(node.expression))
        ) {
            return [directText];
        }

        return undefined;
    }

    if (ts.isCallExpression(node)) {
        const expressionText = node.expression.getText(sourceFile);
        const calleeName = ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : ts.isIdentifier(node.expression)
              ? node.expression.text
              : undefined;

        if (calleeName === "encodeUri") {
            return resolveStringVariants(node.arguments[0], sourceFile, fromNode, seen);
        }

        if (calleeName === "spacePath") {
            return resolveStringVariants(node.arguments[0], sourceFile, fromNode, seen);
        }

        if (expressionText.endsWith(".getUrl")) {
            return resolveStringVariants(node.arguments[0], sourceFile, fromNode, seen);
        }

        // Many managers bind generated route-table path unions via tiny
        // identity helpers such as `sp("/joined_rooms")`, `mp(...)`, `fr(...)`.
        // They preserve runtime values while tightening compile-time types, so
        // the audit should treat them like transparent wrappers around the
        // first argument.
        if (node.arguments.length >= 1 && calleeName && /^[a-z][a-z0-9_]*$/i.test(calleeName)) {
            return resolveStringVariants(node.arguments[0], sourceFile, fromNode, seen);
        }
    }

    return undefined;
}

function resolvePrefixVariants(node, sourceFile, fromNode) {
    if (!node) return undefined;

    if (ts.isIdentifier(node)) {
        const initializer = findVariableInitializer(node.text, fromNode, sourceFile);
        return initializer ? resolvePrefixVariants(initializer, sourceFile, initializer) : undefined;
    }

    if (ts.isConditionalExpression(node)) {
        const whenTrue = resolvePrefixVariants(node.whenTrue, sourceFile, fromNode) ?? [];
        const whenFalse = resolvePrefixVariants(node.whenFalse, sourceFile, fromNode) ?? [];
        const merged = [...new Set([...whenTrue, ...whenFalse])];
        return merged.length > 0 ? merged : undefined;
    }

    const prefixInitializer = extractPropertyFromObjectLiteral(node, "prefix");
    if (prefixInitializer) {
        return resolveStringVariants(prefixInitializer, sourceFile, prefixInitializer);
    }

    return resolveStringVariants(node, sourceFile, fromNode);
}

function canonicalizeMethod(methodExpr) {
    if (!methodExpr) return undefined;
    if (typeof methodExpr !== "string") return undefined;
    const cleaned = methodExpr.replace(/\s+/g, "");
    if (cleaned === "Method.Get" || cleaned.endsWith(".Get")) return "GET";
    if (cleaned === "Method.Post" || cleaned.endsWith(".Post")) return "POST";
    if (cleaned === "Method.Put" || cleaned.endsWith(".Put")) return "PUT";
    if (cleaned === "Method.Delete" || cleaned.endsWith(".Delete")) return "DELETE";
    if (cleaned === "Method.Patch" || cleaned.endsWith(".Patch")) return "PATCH";
    if (cleaned === "GET" || cleaned === "'GET'" || cleaned === '"GET"') return "GET";
    if (cleaned === "POST" || cleaned === "'POST'" || cleaned === '"POST"') return "POST";
    if (cleaned === "PUT" || cleaned === "'PUT'" || cleaned === '"PUT"') return "PUT";
    if (cleaned === "DELETE" || cleaned === "'DELETE'" || cleaned === '"DELETE"') return "DELETE";
    if (cleaned === "PATCH" || cleaned === "'PATCH'" || cleaned === '"PATCH"') return "PATCH";
    return methodExpr;
}

function resolveMethodVariants(node, sourceFile, fromNode) {
    const rawVariants = resolveStringVariants(node, sourceFile, fromNode) ?? [];
    const methods = [...new Set(rawVariants.map(canonicalizeMethod).filter((value) => typeof value === "string"))];
    return methods.length > 0 ? methods : undefined;
}

function resolvePrefix(prefixExpr) {
    if (prefixExpr === "") return "";
    if (!prefixExpr) return undefined;
    if (typeof prefixExpr !== "string") return undefined;
    if (prefixExpr in PREFIX_MAP) return PREFIX_MAP[prefixExpr];
    if (prefixExpr.startsWith("/")) return prefixExpr;
    return undefined;
}

function joinPrefixAndPath(prefix, reqPath) {
    if (!reqPath || typeof reqPath !== "string") return undefined;
    const pathPart = reqPath.startsWith("/") ? reqPath : `/${reqPath}`;
    if (prefix === undefined) {
        return pathPart;
    }
    if (prefix === "") return pathPart;
    return `${prefix}${pathPart}`;
}

function normalizePathLiteral(text) {
    if (typeof text !== "string") return undefined;
    const trimmed = text.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === "`" && last === "`") || (first === "'" && last === "'") || (first === '"' && last === '"')) {
            return trimmed.slice(1, -1);
        }
    }
    return trimmed;
}

function splitTableCells(line) {
    if (!line.trim().startsWith("|")) return [];
    return line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
}

function isTableDividerRow(cells) {
    return (
        cells.length > 0 &&
        cells.every((cell) => {
            const normalized = cell.replace(/\s+/g, "");
            return normalized.length > 0 && /^:?-{3,}:?$/.test(normalized);
        })
    );
}

function parseTableMethodCell(cell) {
    const normalized = cell.replace(/`/g, "").replace(/\s+/g, "");
    if (!/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)(\/(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS))*$/.test(normalized)) {
        return undefined;
    }
    return normalized.split("/").map((method) => canonicalizeMethod(method));
}

function parseTablePathCell(cell) {
    const codeSpanMatch = cell.match(/`([^`]+)`/);
    const candidate = normalizePathLiteral(codeSpanMatch ? codeSpanMatch[1] : cell);
    return typeof candidate === "string" && candidate.startsWith("/") ? candidate : undefined;
}

function extractEndpointsFromTableLine(line, contract) {
    const cells = splitTableCells(line);
    if (cells.length === 0 || isTableDividerRow(cells)) return [];

    const endpoints = [];
    for (const cell of cells) {
        for (const match of cell.matchAll(/`([A-Z]+(?:\/[A-Z]+)*)\s+([^`\s][^`]*)`/g)) {
            const methods = match[1]
                .split("/")
                .map((item) => canonicalizeMethod(item.trim()))
                .filter(Boolean);
            const endpointPath = normalizePathLiteral(match[2]);
            if (!endpointPath || !endpointPath.startsWith("/")) continue;
            for (const method of methods) {
                endpoints.push({
                    contract,
                    method,
                    path: endpointPath,
                });
            }
        }
    }
    if (endpoints.length > 0) return endpoints;

    const methods = parseTableMethodCell(cells[0]);
    const endpointPath = cells.length > 1 ? parseTablePathCell(cells[1]) : undefined;
    if (!methods || !endpointPath) return [];

    return methods.map((method) => ({
        contract,
        method,
        path: endpointPath,
    }));
}

function expandContractPath(contractPath) {
    if (!contractPath.includes("{")) return [contractPath];
    let paths = [contractPath];
    const regex = /\{([^}]+)\}/;
    while (true) {
        const idx = paths.findIndex((p) => regex.test(p));
        if (idx === -1) break;
        const current = paths[idx];
        const match = current.match(regex);
        const raw = match[1];
        if (!raw.includes(",")) {
            paths[idx] = current;
            break;
        }
        const values = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const prefix = current.slice(0, match.index);
        const suffix = current.slice(match.index + match[0].length);
        paths.splice(idx, 1, ...values.map((v) => `${prefix}${v}${suffix}`));
    }
    return paths;
}

function expandOptionalSegments(contractPath) {
    if (!contractPath.includes("[")) return [contractPath];
    let paths = [contractPath];
    const regex = /\[([^\]]+)\]/;
    while (true) {
        const idx = paths.findIndex((p) => regex.test(p));
        if (idx === -1) break;
        const current = paths[idx];
        const match = current.match(regex);
        const before = current.slice(0, match.index);
        const after = current.slice(match.index + match[0].length);
        const withOptional = `${before}${match[1]}${after}`;
        const withoutOptional = `${before}${after}`;
        paths.splice(idx, 1, withOptional, withoutOptional);
    }
    return paths;
}

function normalizePathForMatch(p) {
    if (typeof p !== "string") return undefined;
    let s = p.trim();
    if (!s.startsWith("/")) return undefined;
    s = s.split("?")[0];
    s = s.replace(/^\/_matrix\/client\/(?:r0|v1|v3)(?=\/|$)/, "/_matrix/client/{stable}");
    s = s.replace(/^\/_matrix\/media\/(?:r0|v1|v3)(?=\/|$)/, "/_matrix/media/{stable}");
    s = s.replace(/^\/_matrix\/identity\/(?:v1|v2)(?=\/|$)/, "/_matrix/identity/{stable}");
    s = s.replace(/^\/_matrix\/vendor\/(?:v1)(?=\/|$)/, "/_matrix/vendor/{stable}");
    s = s.replace(/\$\{[^}]+\}/g, "{}");
    s = s.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, "{}");
    s = s.replace(/\{[^}]+\}/g, "{}");
    s = s.replace(/\/+/g, "/");
    return s;
}

function classifyRouteFamily(p) {
    if (typeof p !== "string") {
        return {
            family: "unknown",
            suffix: undefined,
        };
    }

    const normalizedPath = normalizePathForMatch(p);
    if (!normalizedPath) {
        return {
            family: "unknown",
            suffix: undefined,
        };
    }

    const matchers = [
        {
            family: "client-stable",
            regex: /^\/_matrix\/client\/(?:\{\}|\{stable\}|r0|v1|v3)(?=\/|$)/,
        },
        {
            family: "client-unstable",
            regex: /^\/_matrix\/client\/unstable\/[^/]+(?=\/|$)/,
        },
        {
            family: "vendor-stable",
            regex: /^\/_matrix\/vendor\/(?:\{\}|\{stable\}|v1)(?=\/|$)/,
        },
        {
            family: "media-stable",
            regex: /^\/_matrix\/media\/(?:\{\}|\{stable\}|r0|v1|v3)(?=\/|$)/,
        },
        {
            family: "identity-stable",
            regex: /^\/_matrix\/identity\/(?:\{\}|\{stable\}|v1|v2)(?=\/|$)/,
        },
        {
            family: "admin-v1",
            regex: /^\/_synapse\/admin\/v1(?=\/|$)/,
        },
        {
            family: "app-v1",
            regex: /^\/_matrix\/app\/v1(?=\/|$)/,
        },
    ];

    for (const matcher of matchers) {
        const matched = normalizedPath.match(matcher.regex);
        if (!matched) continue;
        const suffix = normalizedPath.slice(matched[0].length) || "/";
        return {
            family: matcher.family,
            suffix,
        };
    }

    return {
        family: "relative",
        suffix: normalizedPath,
    };
}

function contractPreferredRouteFamilies(contract) {
    const basename = String(contract ?? "")
        .replace(/\.md$/i, "")
        .toLowerCase();

    if (basename.includes("media")) {
        return new Set(["media-stable", "client-stable"]);
    }

    if (basename.includes("identity")) {
        return new Set(["identity-stable"]);
    }

    if (basename.includes("admin")) {
        return new Set(["admin-v1"]);
    }

    if (basename.includes("appservice")) {
        return new Set(["app-v1"]);
    }

    return new Set(["client-stable", "vendor-stable"]);
}

function buildRouteAliasGroups(contractRecords, requestRecords) {
    const requestByAliasKey = new Map();
    for (const record of requestRecords) {
        if (!record.route?.suffix || !record.route?.family || record.route.family === "relative") continue;
        const aliasKey = `${record.method} ${record.route.suffix}`;
        const existing = requestByAliasKey.get(aliasKey) ?? [];
        existing.push(record);
        requestByAliasKey.set(aliasKey, existing);
    }

    const groupedMissingKeys = new Set();
    const groupedExtraKeys = new Set();
    const aliasGroups = [];

    const ALIASABLE_CONTRACT_FAMILIES = new Set(["relative", "client-stable"]);

    for (const record of contractRecords) {
        if (!record.route?.suffix || !ALIASABLE_CONTRACT_FAMILIES.has(record.route?.family)) continue;
        if (requestRecords.some((item) => item.key === record.key)) continue;

        const aliasKey = `${record.method} ${record.route.suffix}`;
        const candidates = (requestByAliasKey.get(aliasKey) ?? []).filter((candidate) =>
            contractPreferredRouteFamilies(record.contract).has(candidate.route.family),
        );
        if (candidates.length === 0) continue;

        groupedMissingKeys.add(record.key);
        for (const candidate of candidates) {
            groupedExtraKeys.add(candidate.key);
        }

        aliasGroups.push({
            contract: record.contract,
            aliasRoute: record.key,
            canonicalRoutes: [...new Set(candidates.map((candidate) => candidate.key))].sort(),
        });
    }

    return {
        aliasGroups: aliasGroups.sort((a, b) => a.aliasRoute.localeCompare(b.aliasRoute)),
        groupedMissingKeys,
        groupedExtraKeys,
    };
}

function extractContractEndpoints(filePath) {
    const contract = path.basename(filePath);
    const endpointKeys = new Set();
    const endpoints = [];
    const content = fs.readFileSync(filePath, "utf8");
    const pushEndpoint = (method, endpointPath) => {
        const key = `${method} ${endpointPath}`;
        if (endpointKeys.has(key)) return;
        endpointKeys.add(key);
        endpoints.push({
            contract,
            method,
            path: endpointPath,
        });
    };
    let inCodeFence = false;
    for (const line of content.split(/\r?\n/)) {
        if (line.trimStart().startsWith("```")) {
            inCodeFence = !inCodeFence;
            continue;
        }

        const tableEndpoints = extractEndpointsFromTableLine(line, contract);
        if (tableEndpoints.length > 0) {
            for (const endpoint of tableEndpoints) {
                pushEndpoint(endpoint.method, endpoint.path);
            }
            continue;
        }

        if (!inCodeFence) continue;

        const codeBlockMatch = line.trim().match(/^([A-Z]+)\s+([/][^\s]*)$/);
        if (!codeBlockMatch) continue;

        pushEndpoint(codeBlockMatch[1], codeBlockMatch[2]);
    }
    return endpoints;
}

function getRequestCallMetadata(expression) {
    if (ts.isPropertyAccessExpression(expression)) {
        return {
            callee: expression.name.text,
            isPropertyCall: true,
        };
    }

    if (ts.isIdentifier(expression)) {
        return {
            callee: expression.text,
            isPropertyCall: false,
        };
    }

    return undefined;
}

function isTrackedRequestCall(callee) {
    return ["authedRequest", "request", "requestOtherUrl"].includes(callee);
}

function getRequestCallPrefixVariants(callee, args, sourceFile, node) {
    if (callee === "requestOtherUrl") {
        return [undefined];
    }

    return resolvePrefixVariants(args[4], sourceFile, node) ?? [undefined];
}

function scanSourceFile(filePath) {
    const source = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const requestCalls = [];
    const managerPrototypeMethods = [];

    function visit(node) {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.FirstAssignment) {
            const leftText = node.left.getText(sourceFile);
            const managerMatch = leftText.match(/MatrixClient\.prototype\.(get[A-Z][A-Za-z0-9]+Manager)$/);
            if (managerMatch) {
                managerPrototypeMethods.push(managerMatch[1]);
            }
        }

        if (ts.isCallExpression(node)) {
            const callMetadata = getRequestCallMetadata(node.expression);
            if (callMetadata && isTrackedRequestCall(callMetadata.callee)) {
                const args = node.arguments;
                const methods = resolveMethodVariants(args[0], sourceFile, node) ?? [];
                const requestPathExpr = args[1]?.getText(sourceFile);
                const requestPathVariants = (resolveStringVariants(args[1], sourceFile, node) ?? [])
                    .map(normalizePathLiteral)
                    .filter(Boolean);
                const prefixExprs = getRequestCallPrefixVariants(callMetadata.callee, args, sourceFile, node);

                for (const method of methods) {
                    for (const requestPath of requestPathVariants) {
                        for (const prefixExpr of prefixExprs) {
                            const pathIncludesAbsolutePrefix =
                                typeof requestPath === "string" && requestPath.startsWith("/_");
                            const prefix = resolvePrefix(prefixExpr);
                            const effectivePrefix =
                                prefix ??
                                (callMetadata.callee === "requestOtherUrl" || pathIncludesAbsolutePrefix
                                    ? undefined
                                    : PREFIX_MAP["ClientPrefix.V3"]);
                            if (
                                (effectivePrefix?.startsWith("/_matrix/media/") && requestPath.startsWith("/media/")) ||
                                (effectivePrefix?.startsWith("/_matrix/identity/") &&
                                    requestPath.startsWith("/_matrix/identity/"))
                            ) {
                                continue;
                            }
                            const fullPath = joinPrefixAndPath(effectivePrefix, requestPath);
                            const duplicatePrefix =
                                typeof requestPath === "string" &&
                                requestPath.startsWith("/_") &&
                                typeof effectivePrefix === "string" &&
                                effectivePrefix !== "";
                            requestCalls.push({
                                file: path.relative(repoRoot, filePath),
                                callee: callMetadata.callee,
                                method,
                                path: requestPathExpr,
                                normalizedPath: requestPath,
                                prefix: prefixExpr,
                                resolvedPrefix: prefix,
                                fullPath,
                                duplicatePrefix,
                            });
                        }
                    }
                }
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return { requestCalls, managerPrototypeMethods };
}

function scanManagerDeclarations() {
    const file = path.join(srcRoot, "matrix-client-extensions.ts");
    const content = fs.readFileSync(file, "utf8");
    return [...content.matchAll(/^\s*(get[A-Z][A-Za-z0-9]+Manager)\([\s\S]*?\):/gm)].map((match) => match[1]);
}

function scanDefaultManagerModules() {
    const file = path.join(srcRoot, "manager-extensions", "index.ts");
    const content = fs.readFileSync(file, "utf8");
    return [
        ...content.matchAll(
            /import\("\.\.\/([^"]+?)(?:\/index)?\.js"\)\.then\(\(m\)\s*=>\s*m\??\.extendMatrixClient\(\)\)/g,
        ),
    ].map((match) => match[1]);
}

function main() {
    const contractFileCandidates = walk(
        contractsRoot,
        (filePath) =>
            filePath.endsWith(".md") &&
            !["README.md", "CHANGELOG.md", "VERIFICATION_REPORT.md"].includes(path.basename(filePath)),
    );
    const contractFileSummaries = contractFileCandidates
        .map((filePath) => ({
            filePath,
            endpoints: extractContractEndpoints(filePath),
        }))
        .filter((item) => item.endpoints.length > 0);
    const contractFiles = contractFileSummaries.map((item) => item.filePath);
    const sourceFiles = walk(srcRoot, (filePath) => filePath.endsWith(".ts") || filePath.endsWith(".d.ts"));

    const contractEndpoints = contractFileSummaries.flatMap((item) => item.endpoints);
    const sourceScan = sourceFiles.map(scanSourceFile);
    const requestCalls = sourceScan.flatMap((item) => item.requestCalls);
    const implementedManagers = [...new Set(sourceScan.flatMap((item) => item.managerPrototypeMethods))].sort();
    const declaredManagers = [...new Set(scanManagerDeclarations())].sort();
    const defaultManagerModules = scanDefaultManagerModules();

    const duplicatePrefixCalls = requestCalls.filter((item) => item.duplicatePrefix);
    const declaredOnlyManagers = declaredManagers.filter((name) => !implementedManagers.includes(name));
    const implementedOnlyManagers = implementedManagers.filter((name) => !declaredManagers.includes(name));

    const contractKeys = new Set();
    const contractMatchKeys = new Set();
    const contractMatchRecords = [];
    for (const ep of contractEndpoints) {
        const method = canonicalizeMethod(ep.method);
        for (const p0 of expandContractPath(ep.path)) {
            for (const p of expandOptionalSegments(p0)) {
                contractKeys.add(`${method} ${p}`);
                const mp = normalizePathForMatch(p);
                if (mp) {
                    const key = `${method} ${mp}`;
                    contractMatchKeys.add(key);
                    contractMatchRecords.push({
                        key,
                        method,
                        contract: ep.contract,
                        path: p,
                        route: classifyRouteFamily(mp),
                    });
                }
            }
        }
    }

    const requestKeys = new Set();
    const requestMatchKeys = new Set();
    const requestMatchRecords = [];
    for (const rc of requestCalls) {
        if (typeof rc.fullPath !== "string" || typeof rc.method !== "string") continue;
        requestKeys.add(`${rc.method} ${rc.fullPath}`);
        const mp = normalizePathForMatch(rc.fullPath);
        if (mp) {
            const key = `${rc.method} ${mp}`;
            requestMatchKeys.add(key);
            requestMatchRecords.push({
                key,
                method: rc.method,
                path: rc.fullPath,
                file: rc.file,
                route: classifyRouteFamily(mp),
            });
        }
    }

    const rawMissingEndpoints = [...contractMatchKeys].filter((k) => !requestMatchKeys.has(k)).sort();
    const rawExtraEndpoints = [...requestMatchKeys].filter((k) => !contractMatchKeys.has(k)).sort();
    const { aliasGroups, groupedMissingKeys, groupedExtraKeys } = buildRouteAliasGroups(
        contractMatchRecords.filter((record) => rawMissingEndpoints.includes(record.key)),
        requestMatchRecords.filter((record) => rawExtraEndpoints.includes(record.key)),
    );
    const missingEndpoints = rawMissingEndpoints.filter((key) => !groupedMissingKeys.has(key));
    const extraEndpoints = rawExtraEndpoints.filter((key) => !groupedExtraKeys.has(key));

    const result = {
        generatedAt: new Date().toISOString(),
        contracts: {
            files: contractFiles.length,
            endpointRows: contractEndpoints.length,
            byFile: contractFileSummaries
                .map((item) => ({
                    file: path.basename(item.filePath),
                    endpoints: item.endpoints.length,
                }))
                .sort((a, b) => b.endpoints - a.endpoints),
        },
        source: {
            files: sourceFiles.length,
            requestCalls: requestCalls.length,
            duplicatePrefixCalls,
            coverage: {
                contractExpandedEndpoints: contractMatchKeys.size,
                matchedEndpoints: [...contractMatchKeys].filter((k) => requestMatchKeys.has(k)).length,
                aliasRouteGroupsCount: aliasGroups.length,
                aliasRouteGroups: aliasGroups.slice(0, 100),
                rawMissingEndpointsCount: rawMissingEndpoints.length,
                rawExtraEndpointsCount: rawExtraEndpoints.length,
                missingEndpointsCount: missingEndpoints.length,
                extraEndpointsCount: extraEndpoints.length,
                missingEndpoints: missingEndpoints.slice(0, 200),
                extraEndpoints: extraEndpoints.slice(0, 200),
            },
        },
        managers: {
            declaredCount: declaredManagers.length,
            implementedCount: implementedManagers.length,
            declaredOnlyManagers,
            implementedOnlyManagers,
            defaultManagerModules,
        },
    };

    console.log(JSON.stringify(result, null, 2));
}

main();
