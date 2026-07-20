#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const projectRoot = process.cwd();
const docsRoot = path.join(projectRoot, "docs", "api-contract");
const srcRoot = path.join(projectRoot, "src");
const synapseRoot = path.resolve(projectRoot, "..", "synapse-rust");
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
const PREFIX_MAP = {
    "ClientPrefix.V1": "/_matrix/client/v1",
    "ClientPrefix.V3": "/_matrix/client/v3",
    "ClientPrefix.Unstable": "/_matrix/client/unstable",
    "AdminPrefix.V1": "/_synapse/admin/v1",
    "MediaPrefix.V1": "/_matrix/media/v1",
    "MediaPrefix.V3": "/_matrix/media/v3",
    "IdentityPrefix.V2": "/_matrix/identity/v2",
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

function splitTableCells(line) {
    if (!line.trim().startsWith("|")) return [];
    return line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
}

function isDividerRow(cells) {
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function extractInlineCode(cell) {
    const matches = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
    if (matches.length > 0) return matches[0];
    return cell.replace(/\*\*/g, "").trim();
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

function upperFirst(text) {
    return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function normalizeOwner(rawOwner) {
    const owner = rawOwner.trim();
    if (!owner || owner === "-") return null;
    if (owner === "client" || owner === "Client" || owner === "MatrixClient") return "MatrixClient";

    const getterMatch = owner.match(/get([A-Z][A-Za-z0-9]+Manager)$/);
    if (getterMatch) return getterMatch[1];

    const clientGetterMatch = owner.match(/client\.get([A-Z][A-Za-z0-9]+Manager)\(\)$/);
    if (clientGetterMatch) return clientGetterMatch[1];

    if (/^[a-z][A-Za-z0-9]+Manager$/.test(owner)) {
        return upperFirst(owner);
    }

    if (/^[A-Z][A-Za-z0-9]+Manager$/.test(owner) || /^[A-Z][A-Za-z0-9]+Client$/.test(owner)) {
        return owner;
    }

    return owner;
}

function normalizeMethod(rawMethod) {
    const method = rawMethod.trim();
    if (!method || method === "-") return null;

    const directMatch = method.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (directMatch) return directMatch[1];

    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method)) return method;

    return null;
}

function parseSdkReferenceFromCell(cell) {
    const value = extractInlineCode(cell);
    if (!value || value === "-") return null;

    const clientGetterMatch = value.match(
        /(?:^|[\s(])client\.get([A-Z][A-Za-z0-9]+Manager)\(\)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/,
    );
    if (clientGetterMatch) {
        return {
            owner: clientGetterMatch[1],
            method: clientGetterMatch[2],
            raw: value,
        };
    }

    const directMatch = value.match(/([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (directMatch) {
        return {
            owner: normalizeOwner(directMatch[1]),
            method: directMatch[2],
            raw: value,
        };
    }

    return null;
}

function addMethod(methodIndex, owner, methodName, filePath) {
    if (!owner || !methodName) return;
    const owners = methodIndex.get(owner) ?? new Map();
    const files = owners.get(methodName) ?? new Set();
    files.add(path.relative(projectRoot, filePath));
    owners.set(methodName, files);
    methodIndex.set(owner, owners);
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

function findFunctionDeclaration(name, fromNode) {
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

    let current = fromNode;
    while (current) {
        const statements = getStatements(current);
        for (let i = statements.length - 1; i >= 0; i -= 1) {
            const statement = statements[i];
            if (statement.pos >= fromNode.pos) continue;
            if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
                return statement;
            }
        }
        current = current.parent;
    }

    return undefined;
}

function getReturnedExpression(functionDeclaration) {
    if (!functionDeclaration.body) return undefined;
    if (ts.isBlock(functionDeclaration.body)) {
        for (const statement of functionDeclaration.body.statements) {
            if (ts.isReturnStatement(statement) && statement.expression) {
                return statement.expression;
            }
        }
    }
    return undefined;
}

function resolveStringVariants(node, sourceFile, fromNode, seen = new Set(), bindings = new Map()) {
    if (!node) return undefined;

    const cacheKey = `${node.pos}:${node.end}`;
    if (seen.has(cacheKey)) return undefined;
    seen.add(cacheKey);

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return [node.text];
    }

    if (ts.isParenthesizedExpression(node)) {
        return resolveStringVariants(node.expression, sourceFile, fromNode, seen, bindings);
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
        const whenTrue = resolveStringVariants(node.whenTrue, sourceFile, fromNode, seen, bindings) ?? [];
        const whenFalse = resolveStringVariants(node.whenFalse, sourceFile, fromNode, seen, bindings) ?? [];
        const merged = [...new Set([...whenTrue, ...whenFalse])];
        return merged.length > 0 ? merged : undefined;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = resolveStringVariants(node.left, sourceFile, fromNode, seen, bindings);
        const right = resolveStringVariants(node.right, sourceFile, fromNode, seen, bindings);
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
        if (bindings.has(node.text)) {
            return resolveStringVariants(bindings.get(node.text), sourceFile, fromNode, new Set(seen), bindings);
        }
        const initializer = findVariableInitializer(node.text, fromNode, sourceFile);
        return initializer ? resolveStringVariants(initializer, sourceFile, initializer, seen, bindings) : undefined;
    }

    if (ts.isPropertyAccessExpression(node)) {
        const base = ts.isIdentifier(node.expression)
            ? findVariableInitializer(node.expression.text, fromNode, sourceFile)
            : undefined;
        const propertyInitializer = extractPropertyFromObjectLiteral(base, node.name.text);
        if (propertyInitializer) {
            return resolveStringVariants(propertyInitializer, sourceFile, propertyInitializer, seen, bindings);
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

        if (calleeName === "encodeUri" || calleeName === "spacePath") {
            return resolveStringVariants(node.arguments[0], sourceFile, fromNode, seen, bindings);
        }

        if (expressionText.endsWith(".getUrl")) {
            return resolveStringVariants(node.arguments[0], sourceFile, fromNode, seen, bindings);
        }

        if (calleeName && ts.isIdentifier(node.expression)) {
            const declaration = findFunctionDeclaration(calleeName, fromNode);
            const returnedExpression = declaration ? getReturnedExpression(declaration) : undefined;
            if (returnedExpression) {
                const functionBindings = new Map(bindings);
                declaration.parameters.forEach((parameter, index) => {
                    if (ts.isIdentifier(parameter.name) && node.arguments[index]) {
                        functionBindings.set(parameter.name.text, node.arguments[index]);
                    }
                });
                return resolveStringVariants(
                    returnedExpression,
                    sourceFile,
                    returnedExpression,
                    new Set(),
                    functionBindings,
                );
            }
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

function normalizePathForMatch(input) {
    if (typeof input !== "string") return undefined;
    let normalized = input.trim();
    if (!normalized.startsWith("/")) return undefined;
    normalized = normalized.split("?")[0];
    normalized = normalized.replace(/^\/_matrix\/client\/\{[^}]+\}(?=\/|$)/, "/_matrix/client/{stable}");
    normalized = normalized.replace(/^\/_matrix\/client\/(?:r0|v1|v3)(?=\/|$)/, "/_matrix/client/{stable}");
    normalized = normalized.replace(/^\/_matrix\/media\/\{[^}]+\}(?=\/|$)/, "/_matrix/media/{stable}");
    normalized = normalized.replace(/^\/_matrix\/media\/(?:r0|v1|v3)(?=\/|$)/, "/_matrix/media/{stable}");
    normalized = normalized.replace(/^\/_matrix\/identity\/\{[^}]+\}(?=\/|$)/, "/_matrix/identity/{stable}");
    normalized = normalized.replace(/^\/_matrix\/identity\/(?:v1|v2)(?=\/|$)/, "/_matrix/identity/{stable}");
    normalized = normalized.replace(/\$\{[^}]+\}/g, "{}");
    normalized = normalized.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, "{}");
    normalized = normalized.replace(/\{[^}]+\}/g, "{}");
    normalized = normalized.replace(/\/+/g, "/");
    return normalized;
}

function isWildcardSegment(segment) {
    return segment === "{}" || segment === "{stable}";
}

function splitPathSegments(routePath) {
    return routePath.split("/").filter(Boolean);
}

function pathsMatchWithWildcards(leftPath, rightPath) {
    const left = normalizePathForMatch(leftPath);
    const right = normalizePathForMatch(rightPath);
    if (!left || !right) return false;

    const leftSegments = splitPathSegments(left);
    const rightSegments = splitPathSegments(right);
    if (leftSegments.length !== rightSegments.length) return false;

    return leftSegments.every((segment, index) => {
        const other = rightSegments[index];
        return segment === other || isWildcardSegment(segment) || isWildcardSegment(other);
    });
}

function pathEndsWithPattern(fullPath, suffixPath) {
    const full = normalizePathForMatch(fullPath);
    const suffix = normalizePathForMatch(suffixPath);
    if (!full || !suffix) return false;

    const fullSegments = splitPathSegments(full);
    const suffixSegments = splitPathSegments(suffix);
    if (suffixSegments.length > fullSegments.length) return false;

    const offset = fullSegments.length - suffixSegments.length;
    return suffixSegments.every((segment, index) => {
        const target = fullSegments[offset + index];
        return segment === target || isWildcardSegment(segment) || isWildcardSegment(target);
    });
}

function getRequestCallMetadata(expression) {
    if (ts.isPropertyAccessExpression(expression)) {
        return {
            callee: expression.name.text,
        };
    }

    if (ts.isIdentifier(expression)) {
        return {
            callee: expression.text,
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

/**
 * Extracts method, path, and prefix from a tracked request call,
 * supporting BOTH calling conventions:
 *
 * 1. Positional: authedRequest(method, path, opts, body, prefix)
 *    args[0]=method, args[1]=path, args[4]=prefix
 *
 * 2. Object literal (BaseManager pattern): this.request({ method, path, prefix, ... })
 *    args[0] is an ObjectLiteralExpression; properties are extracted by name.
 *
 * Returns { methods, requestPathVariants, prefixExprs } or null if unrecognised.
 */
function extractRequestCallInfo(args, sourceFile, node) {
    if (args.length === 0) return null;

    // Pattern 2: single object-literal argument (BaseManager this.request({...}))
    if (ts.isObjectLiteralExpression(args[0])) {
        let methodNode = null;
        let pathNode = null;
        let prefixNode = null;
        for (const prop of args[0].properties) {
            let propName = null;
            let initializer = null;
            if (ts.isPropertyAssignment(prop)) {
                propName = ts.isIdentifier(prop.name)
                    ? prop.name.text
                    : ts.isStringLiteral(prop.name)
                      ? prop.name.text
                      : null;
                initializer = prop.initializer;
            } else if (ts.isShorthandPropertyAssignment(prop)) {
                // Shorthand: `{ path }` is equivalent to `{ path: path }`
                propName = ts.isIdentifier(prop.name) ? prop.name.text : null;
                initializer = prop.name; // the identifier itself
            }
            if (propName === "method") methodNode = initializer;
            else if (propName === "path") pathNode = initializer;
            else if (propName === "prefix") prefixNode = initializer;
        }
        if (!methodNode || !pathNode) return null;

        const methods = resolveMethodVariants(methodNode, sourceFile, node) ?? [];
        const requestPathVariants = (resolveStringVariants(pathNode, sourceFile, node) ?? [])
            .map(normalizePathLiteral)
            .filter(Boolean);
        const prefixExprs = prefixNode
            ? (resolvePrefixVariants(prefixNode, sourceFile, node) ?? [undefined])
            : [undefined];
        return { methods, requestPathVariants, prefixExprs };
    }

    // Pattern 1: positional args (authedRequest/request with separate arguments)
    if (args.length < 2) return null;
    const methods = resolveMethodVariants(args[0], sourceFile, node) ?? [];
    const requestPathVariants = (resolveStringVariants(args[1], sourceFile, node) ?? [])
        .map(normalizePathLiteral)
        .filter(Boolean);
    const prefixExprs =
        args.length > 4 ? (resolvePrefixVariants(args[4], sourceFile, node) ?? [undefined]) : [undefined];
    return { methods, requestPathVariants, prefixExprs };
}

function scanSourceRequestCalls(filePath) {
    const source = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const requestCalls = [];

    function visit(node) {
        if (ts.isCallExpression(node)) {
            const callMetadata = getRequestCallMetadata(node.expression);
            if (callMetadata && isTrackedRequestCall(callMetadata.callee)) {
                const args = node.arguments;
                const info = extractRequestCallInfo(args, sourceFile, node);
                if (info) {
                    const { methods, requestPathVariants, prefixExprs } = info;
                    const requestPathExpr = ts.isObjectLiteralExpression(args[0])
                        ? args[0].getText(sourceFile)
                        : args[1]?.getText(sourceFile);

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
                                const fullPath = joinPrefixAndPath(effectivePrefix, requestPath);

                                requestCalls.push({
                                    file: path.relative(projectRoot, filePath),
                                    callee: callMetadata.callee,
                                    method,
                                    pathExpr: requestPathExpr,
                                    path: requestPath,
                                    fullPath,
                                });
                            }
                        }
                    }
                }
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return requestCalls;
}

function resolveImportTarget(fromFile, specifier) {
    if (!specifier.startsWith(".")) return null;

    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.mjs`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
        path.join(base, "index.js"),
        path.join(base, "index.mjs"),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }

    return null;
}

function collectTraceIndex(files) {
    const fileContexts = new Map();
    const classIndex = new Map();

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, "utf8");
        const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
        const imports = new Map();
        const functions = new Map();
        const reExports = new Map();

        function addClassMethod(owner, methodName, node) {
            const owners = classIndex.get(owner) ?? new Map();
            owners.set(methodName, { filePath, node, sourceFile });
            classIndex.set(owner, owners);
        }

        for (const statement of sourceFile.statements) {
            if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
                const resolved = resolveImportTarget(filePath, statement.moduleSpecifier.text);
                if (!resolved || !statement.importClause) continue;

                if (statement.importClause.name) {
                    imports.set(statement.importClause.name.text, { filePath: resolved, exportedName: "default" });
                }

                const namedBindings = statement.importClause.namedBindings;
                if (namedBindings && ts.isNamedImports(namedBindings)) {
                    for (const element of namedBindings.elements) {
                        imports.set(element.name.text, {
                            filePath: resolved,
                            exportedName: element.propertyName?.text ?? element.name.text,
                        });
                    }
                }
            }

            if (
                ts.isExportDeclaration(statement) &&
                statement.exportClause &&
                ts.isNamedExports(statement.exportClause) &&
                statement.moduleSpecifier &&
                ts.isStringLiteral(statement.moduleSpecifier)
            ) {
                const resolved = resolveImportTarget(filePath, statement.moduleSpecifier.text);
                if (!resolved) continue;
                for (const element of statement.exportClause.elements) {
                    reExports.set(element.name.text, {
                        filePath: resolved,
                        exportedName: element.propertyName?.text ?? element.name.text,
                    });
                }
            }

            if (ts.isFunctionDeclaration(statement) && statement.name?.text) {
                functions.set(statement.name.text, statement);
            }

            if (ts.isClassDeclaration(statement) && statement.name?.text) {
                const owner = statement.name.text;
                for (const member of statement.members) {
                    if (!ts.isMethodDeclaration(member) && !ts.isGetAccessorDeclaration(member)) continue;
                    if (!member.name || !ts.isIdentifier(member.name)) continue;
                    addClassMethod(owner, member.name.text, member);
                }
            }
        }

        fileContexts.set(filePath, {
            filePath,
            sourceFile,
            imports,
            functions,
            reExports,
        });
    }

    return {
        fileContexts,
        classIndex,
    };
}

function resolveExportedFunctionReference(filePath, exportedName, traceIndex, visited = new Set()) {
    const key = `${filePath}:${exportedName}`;
    if (visited.has(key)) return null;
    visited.add(key);

    const fileContext = traceIndex.fileContexts.get(filePath);
    if (!fileContext) return null;

    const localFunction = fileContext.functions.get(exportedName);
    if (localFunction) {
        return {
            fileContext,
            node: localFunction,
            ownerKey: `fn:${filePath}:${exportedName}`,
        };
    }

    const reExport = fileContext.reExports.get(exportedName);
    if (!reExport) return null;

    return resolveExportedFunctionReference(reExport.filePath, reExport.exportedName, traceIndex, visited);
}

function collectMethodIndex() {
    const methodIndex = new Map();
    const files = walk(srcRoot, (filePath) => filePath.endsWith(".ts") && !filePath.endsWith(".d.ts"));

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, "utf8");
        const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

        function visit(node) {
            if (ts.isClassDeclaration(node) && node.name?.text) {
                const owner = node.name.text;
                for (const member of node.members) {
                    if (!ts.isMethodDeclaration(member) && !ts.isGetAccessorDeclaration(member)) continue;
                    if (!member.name || !ts.isIdentifier(member.name)) continue;
                    addMethod(methodIndex, owner, member.name.text, filePath);
                }
            }

            if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.FirstAssignment) {
                const leftText = node.left.getText(sourceFile);
                const prototypeMatch = leftText.match(
                    /^([A-Za-z_$][A-Za-z0-9_$]*)\.prototype\.([A-Za-z_$][A-Za-z0-9_$]*)$/,
                );
                if (prototypeMatch) {
                    addMethod(methodIndex, prototypeMatch[1], prototypeMatch[2], filePath);
                }
            }

            ts.forEachChild(node, visit);
        }

        visit(sourceFile);
    }

    return methodIndex;
}

function traceRequestsFromCallable(node, fileContext, traceIndex, ownerKey, visited = new Set()) {
    if (!node || visited.has(ownerKey)) return [];
    visited.add(ownerKey);

    const requestCalls = [];

    function traceImportedFunction(localName, currentFileContext) {
        const importRef = currentFileContext.imports.get(localName);
        if (!importRef) return [];

        const resolved = resolveExportedFunctionReference(importRef.filePath, importRef.exportedName, traceIndex);
        if (!resolved) return [];

        return traceRequestsFromCallable(resolved.node, resolved.fileContext, traceIndex, resolved.ownerKey, visited);
    }

    function traceClassMethod(owner, methodName) {
        const ownerMethods = traceIndex.classIndex.get(owner);
        const target = ownerMethods?.get(methodName);
        if (!target) return [];
        return traceRequestsFromCallable(
            target.node,
            traceIndex.fileContexts.get(target.filePath),
            traceIndex,
            `method:${owner}.${methodName}`,
            visited,
        );
    }

    function collectDirectRequest(nodeToScan) {
        if (!ts.isCallExpression(nodeToScan)) return;
        const callMetadata = getRequestCallMetadata(nodeToScan.expression);
        if (!callMetadata || !isTrackedRequestCall(callMetadata.callee)) return;

        const args = nodeToScan.arguments;
        const info = extractRequestCallInfo(args, fileContext.sourceFile, nodeToScan);
        if (!info) return;
        const { methods, requestPathVariants, prefixExprs } = info;

        for (const method of methods) {
            for (const requestPath of requestPathVariants) {
                for (const prefixExpr of prefixExprs) {
                    const pathIncludesAbsolutePrefix = typeof requestPath === "string" && requestPath.startsWith("/_");
                    const prefix = resolvePrefix(prefixExpr);
                    const effectivePrefix =
                        prefix ??
                        (callMetadata.callee === "requestOtherUrl" || pathIncludesAbsolutePrefix
                            ? undefined
                            : PREFIX_MAP["ClientPrefix.V3"]);
                    const fullPath = joinPrefixAndPath(effectivePrefix, requestPath);
                    requestCalls.push({
                        method,
                        path: requestPath,
                        fullPath,
                        file: path.relative(projectRoot, fileContext.filePath),
                    });
                }
            }
        }
    }

    function visit(current) {
        if (ts.isCallExpression(current)) {
            collectDirectRequest(current);

            if (ts.isPropertyAccessExpression(current.expression)) {
                if (ts.isThis(current.expression.expression)) {
                    requestCalls.push(
                        ...traceClassMethod(
                            ownerKey.replace(/^method:/, "").split(".")[0],
                            current.expression.name.text,
                        ),
                    );
                } else if (
                    ts.isPropertyAccessExpression(current.expression.expression) &&
                    ts.isThis(current.expression.expression.expression) &&
                    current.expression.expression.name.text === "client"
                ) {
                    requestCalls.push(...traceClassMethod("MatrixClient", current.expression.name.text));
                } else if (
                    ts.isCallExpression(current.expression.expression) &&
                    ts.isPropertyAccessExpression(current.expression.expression.expression) &&
                    ts.isThis(current.expression.expression.expression.expression) &&
                    current.expression.expression.expression.name.text.startsWith("get") &&
                    current.expression.expression.expression.name.text.endsWith("Manager")
                ) {
                    const getterName = current.expression.expression.expression.name.text;
                    const managerName = getterName.replace(/^get/, "");
                    requestCalls.push(...traceClassMethod(managerName, current.expression.name.text));
                }
            } else if (ts.isIdentifier(current.expression)) {
                requestCalls.push(...traceImportedFunction(current.expression.text, fileContext));

                const localFn = fileContext.functions.get(current.expression.text);
                if (localFn) {
                    requestCalls.push(
                        ...traceRequestsFromCallable(
                            localFn,
                            fileContext,
                            traceIndex,
                            `fn:${fileContext.filePath}:${current.expression.text}`,
                            visited,
                        ),
                    );
                }
            }
        }

        ts.forEachChild(current, visit);
    }

    if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isFunctionDeclaration(node)) {
        if (node.body) {
            visit(node.body);
        }
    } else {
        visit(node);
    }

    return requestCalls;
}

function traceRequestsForReference(reference, traceIndex) {
    if (!reference?.owner || !reference?.method) return [];

    const ownerMethods = traceIndex.classIndex.get(reference.owner);
    const target = ownerMethods?.get(reference.method);
    if (!target) return [];

    const fileContext = traceIndex.fileContexts.get(target.filePath);
    if (!fileContext) return [];

    const requests = traceRequestsFromCallable(
        target.node,
        fileContext,
        traceIndex,
        `method:${reference.owner}.${reference.method}`,
    );

    const unique = new Map();
    for (const request of requests) {
        const key = `${request.method} ${request.fullPath}`;
        if (!request.method || !request.fullPath || unique.has(key)) continue;
        unique.set(key, request);
    }
    return [...unique.values()];
}

function parseHeaderIndices(headerCells) {
    const normalized = headerCells.map((cell) => cell.replace(/[`*\s]/g, ""));
    const endpointIndex = normalized.findIndex((cell) => cell === "后端端点" || cell.endsWith("后端端点"));
    const statusIndex = normalized.findIndex((cell) => cell.includes("状态"));
    const methodIndex = normalized.findIndex((cell) => cell === "SDK方法" || cell.endsWith("SDK方法"));
    const managerIndex = normalized.findIndex((cell) => cell === "SDKManager" || cell.endsWith("SDKManager"));

    if (statusIndex === -1) return null;
    if (endpointIndex === -1) return null;
    if (methodIndex === -1 && managerIndex === -1) return null;

    return {
        endpointIndex,
        statusIndex,
        methodIndex,
        managerIndex,
    };
}

function parseEndpointReference(cell) {
    const value = extractInlineCode(cell);
    if (!value || value === "-") return null;

    const match = value.match(/^([A-Z]+)\s+(.+)$/);
    if (!match) return null;

    const method = canonicalizeMethod(match[1]);
    const routePath = normalizePathLiteral(match[2]);
    if (!method || !routePath || !routePath.startsWith("/")) return null;

    return {
        method,
        path: routePath,
        raw: value,
    };
}

function parseSdkAlignedRows(filePath) {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    const rows = [];
    let inSdkSection = false;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const headingMatch = line.match(/^(#{2,3})\s+(.*)$/);
        if (headingMatch) {
            const heading = headingMatch[2].trim();
            if (heading.includes("SDK 对齐状态")) {
                inSdkSection = true;
                continue;
            }
            if (inSdkSection && headingMatch[1].length <= 2) {
                inSdkSection = false;
            }
        }

        if (!inSdkSection || !line.trim().startsWith("|")) continue;

        const headerCells = splitTableCells(line);
        const headerIndices = parseHeaderIndices(headerCells);
        if (!headerIndices) continue;

        for (let j = i + 1; j < lines.length; j += 1) {
            const rowLine = lines[j];
            if (!rowLine.trim().startsWith("|")) {
                i = j - 1;
                break;
            }

            const rowCells = splitTableCells(rowLine);
            if (isDividerRow(rowCells)) continue;
            if (rowCells.length <= headerIndices.statusIndex) continue;

            const status = rowCells[headerIndices.statusIndex] ?? "";
            if (!status.includes("✅")) continue;

            const endpointCell = rowCells[headerIndices.endpointIndex] ?? "";
            const managerCell = headerIndices.managerIndex >= 0 ? (rowCells[headerIndices.managerIndex] ?? "") : "";
            const methodCell = headerIndices.methodIndex >= 0 ? (rowCells[headerIndices.methodIndex] ?? "") : "";

            let reference = null;
            if (headerIndices.managerIndex >= 0 && headerIndices.methodIndex >= 0) {
                const owner = normalizeOwner(extractInlineCode(managerCell));
                const method = normalizeMethod(extractInlineCode(methodCell));
                if (owner && method) {
                    reference = {
                        owner,
                        method,
                        raw: `${owner}.${method}()`,
                    };
                }
            } else if (headerIndices.methodIndex >= 0) {
                reference = parseSdkReferenceFromCell(methodCell);
            }

            rows.push({
                file: path.relative(projectRoot, filePath),
                line: j + 1,
                status,
                endpointCell,
                managerCell,
                methodCell,
                reference,
                endpoint: parseEndpointReference(endpointCell),
            });
        }
    }

    return rows;
}

function parseDocumentedEndpoints(filePath) {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    const endpoints = [];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const match = line.match(/\*\*路径\*\*:\s*`([A-Z]+)\s+([^`]+)`/);
        if (!match) continue;

        const method = canonicalizeMethod(match[1]);
        const routePath = normalizePathLiteral(match[2]);
        if (!method || !routePath || !routePath.startsWith("/")) continue;

        endpoints.push({
            file: path.relative(projectRoot, filePath),
            line: index + 1,
            method,
            path: routePath,
        });
    }

    return endpoints;
}

function parseBackendCodePath(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/^>\s*后端代码:\s*`([^`]+)`/m);
    if (!match) return undefined;

    const rawPath = match[1].trim();
    if (path.isAbsolute(rawPath)) return rawPath;
    if (rawPath.startsWith("synapse-rust/")) {
        return path.resolve(projectRoot, "..", rawPath);
    }
    return path.resolve(path.dirname(filePath), rawPath);
}

function findMatchingDelimiter(input, openIndex, openChar = "(", closeChar = ")") {
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let index = openIndex; index < input.length; index += 1) {
        const char = input[index];

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === "\\") {
                escaped = true;
                continue;
            }
            if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (char === openChar) {
            depth += 1;
            continue;
        }

        if (char === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function splitTopLevelArgs(input) {
    let depthParen = 0;
    let depthBrace = 0;
    let depthBracket = 0;
    let quote = null;
    let escaped = false;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === "\\") {
                escaped = true;
                continue;
            }
            if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (char === "(") depthParen += 1;
        else if (char === ")") depthParen -= 1;
        else if (char === "{") depthBrace += 1;
        else if (char === "}") depthBrace -= 1;
        else if (char === "[") depthBracket += 1;
        else if (char === "]") depthBracket -= 1;
        else if (char === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
            return [input.slice(0, index).trim(), input.slice(index + 1).trim()];
        }
    }

    return [input.trim(), ""];
}

function parseRustStringLiteral(input) {
    const trimmed = input.trim();
    const match = trimmed.match(/^"([^"]*)"$/s);
    return match ? match[1] : undefined;
}

function parseRustRouterFunctions(filePath) {
    const source = fs.readFileSync(filePath, "utf8");
    const functions = new Map();
    const fnPattern = /(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([\s\S]*?\)\s*->\s*Router(?:<[^>]+>)?\s*\{/g;
    let match;

    while ((match = fnPattern.exec(source)) !== null) {
        const name = match[1];
        const braceIndex = source.indexOf("{", match.index);
        if (braceIndex === -1) continue;
        const endIndex = findMatchingDelimiter(source, braceIndex, "{", "}");
        if (endIndex === -1) continue;

        functions.set(name, {
            body: source.slice(braceIndex + 1, endIndex),
            isPublic: match[0].includes("pub fn"),
        });
        fnPattern.lastIndex = endIndex;
    }

    return functions;
}

function extractRustLocalBindings(body) {
    const bindings = new Map();
    const pattern = /let(?:\s+mut)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/g;
    let match;

    while ((match = pattern.exec(body)) !== null) {
        bindings.set(match[1], match[2].trim());
    }

    return bindings;
}

function findRustMethodCalls(body, methodName) {
    const calls = [];
    const token = `.${methodName}(`;
    let index = 0;

    while ((index = body.indexOf(token, index)) !== -1) {
        const openIndex = index + token.length - 1;
        const closeIndex = findMatchingDelimiter(body, openIndex, "(", ")");
        if (closeIndex === -1) break;
        calls.push(body.slice(openIndex + 1, closeIndex));
        index = closeIndex + 1;
    }

    return calls;
}

function parseRustRouterReference(expression, bindings) {
    let current = expression.trim();
    let safetyCounter = 0;

    while (bindings.has(current) && safetyCounter < 10) {
        current = bindings.get(current);
        safetyCounter += 1;
    }

    const cloneMatch = current.match(/^([A-Za-z_][A-Za-z0-9_]*)\.clone\(\)$/);
    if (cloneMatch) {
        return parseRustRouterReference(cloneMatch[1], bindings);
    }

    const callMatch = current.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (callMatch) return callMatch[1];

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(current) && bindings.has(current)) {
        return parseRustRouterReference(bindings.get(current), bindings);
    }

    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(current) ? current : undefined;
}

function joinRustRoutePrefix(prefix, routePath) {
    if (!prefix) return routePath;
    if (!routePath) return prefix;
    return `${prefix.replace(/\/$/, "")}/${routePath.replace(/^\//, "")}`;
}

function extractRustRoutesFromFunction(functionName, functions, visited = new Set()) {
    if (!functionName || visited.has(functionName)) return [];
    visited.add(functionName);

    const entry = functions.get(functionName);
    if (!entry) return [];

    const bindings = extractRustLocalBindings(entry.body);
    const routes = [];

    for (const call of findRustMethodCalls(entry.body, "route")) {
        const [pathArg, handlerArg] = splitTopLevelArgs(call);
        const routePath = parseRustStringLiteral(pathArg);
        if (!routePath) continue;

        const methods = [...handlerArg.matchAll(/\b(get|post|put|delete|patch)\s*\(/g)].map((item) =>
            item[1].toUpperCase(),
        );
        for (const method of methods) {
            routes.push({ method, path: routePath });
        }
    }

    for (const call of findRustMethodCalls(entry.body, "nest")) {
        const [prefixArg, routerArg] = splitTopLevelArgs(call);
        const prefix = parseRustStringLiteral(prefixArg);
        const routerFn = parseRustRouterReference(routerArg, bindings);
        if (!prefix || !routerFn) continue;

        const nestedRoutes = extractRustRoutesFromFunction(routerFn, functions, new Set(visited));
        for (const route of nestedRoutes) {
            routes.push({
                method: route.method,
                path: joinRustRoutePrefix(prefix, route.path),
            });
        }
    }

    return routes;
}

function extractBackendRoutesFromFile(filePath) {
    if (!filePath.startsWith(synapseRoot)) {
        return { ok: false, reason: "backend file is outside synapse-rust workspace", routes: [] };
    }

    const functions = parseRustRouterFunctions(filePath);
    const rootName =
        [...functions.entries()].find(([name, value]) => value.isPublic && /^create_.*router$/.test(name))?.[0] ??
        [...functions.entries()].find(([_, value]) => value.isPublic)?.[0];

    if (!rootName) {
        return { ok: false, reason: "no public router factory found", routes: [] };
    }

    const routes = extractRustRoutesFromFunction(rootName, functions);
    const unique = new Map();

    for (const route of routes) {
        if (!route.method || !route.path) continue;
        unique.set(`${route.method} ${route.path}`, route);
    }

    return {
        ok: true,
        rootName,
        routes: [...unique.values()],
    };
}

function resolveDocumentedCandidates(row, documentedEndpoints) {
    if (!row.endpoint) return [];

    return documentedEndpoints.filter(
        (endpoint) => endpoint.method === row.endpoint.method && pathEndsWithPattern(endpoint.path, row.endpoint.path),
    );
}

function writeSummary({
    ok,
    checkedRows,
    parseFailures,
    missingMethods,
    pathParseFailures,
    unresolvedRows,
    missingPaths,
    unresolvedAttributions = [],
    attributedMismatches = [],
    backendParseFailures = [],
    missingBackendRoutes = [],
}) {
    if (!stepSummaryPath) return;

    const lines = [];
    lines.push("## SDK Contract Alignment Gate");
    lines.push("");
    lines.push(`- Status: ${ok ? "PASS" : "FAIL"}`);
    lines.push(`- Checked aligned rows: ${checkedRows}`);
    lines.push(`- Parse failures: ${parseFailures.length}`);
    lines.push(`- Missing methods: ${missingMethods.length}`);
    lines.push(`- Path parse failures: ${pathParseFailures.length}`);
    lines.push(`- Unresolved documented endpoints: ${unresolvedRows.length}`);
    lines.push(`- Missing endpoint coverage: ${missingPaths.length}`);
    lines.push(`- Unresolved method attributions: ${unresolvedAttributions.length}`);
    lines.push(`- Method-path mismatches: ${attributedMismatches.length}`);
    lines.push(`- Backend route parse failures: ${backendParseFailures.length}`);
    lines.push(`- Missing backend route coverage: ${missingBackendRoutes.length}`);
    lines.push("");

    if (!ok) {
        lines.push("### Failure Checklist");
        lines.push("");
        lines.push(`- [ ] Fix parse failures: ${parseFailures.length}`);
        lines.push(`- [ ] Fix missing methods: ${missingMethods.length}`);
        lines.push(`- [ ] Fix path parse failures: ${pathParseFailures.length}`);
        lines.push(`- [ ] Fix unresolved documented endpoints: ${unresolvedRows.length}`);
        lines.push(`- [ ] Fix missing endpoint coverage: ${missingPaths.length}`);
        lines.push(`- [ ] Fix unresolved method attributions: ${unresolvedAttributions.length}`);
        lines.push(`- [ ] Fix method-path mismatches: ${attributedMismatches.length}`);
        lines.push(`- [ ] Fix backend route parse failures: ${backendParseFailures.length}`);
        lines.push(`- [ ] Fix missing backend route coverage: ${missingBackendRoutes.length}`);
        lines.push("");
    }

    fs.appendFileSync(stepSummaryPath, `${lines.join("\n")}\n`);
}

if (!fs.existsSync(docsRoot)) {
    console.error(`[sdk-contract-alignment] docs root not found: ${docsRoot}`);
    process.exit(1);
}

if (!fs.existsSync(srcRoot)) {
    console.error(`[sdk-contract-alignment] src root not found: ${srcRoot}`);
    process.exit(1);
}

const methodIndex = collectMethodIndex();
const sourceFiles = walk(srcRoot, (filePath) => filePath.endsWith(".ts") && !filePath.endsWith(".d.ts"));
const traceIndex = collectTraceIndex(sourceFiles);
const docFiles = walk(
    docsRoot,
    (filePath) =>
        filePath.endsWith(".md") &&
        !filePath.includes(`${path.sep}history${path.sep}`) &&
        !["README.md", "CHANGELOG.md", "VERIFICATION_REPORT.md", "THROW_ON_ERROR_MIGRATION.md"].includes(
            path.basename(filePath),
        ),
);

const alignedRows = docFiles.flatMap((filePath) => parseSdkAlignedRows(filePath));
const documentedEndpointsByFile = new Map(
    docFiles.map((filePath) => [path.relative(projectRoot, filePath), parseDocumentedEndpoints(filePath)]),
);
const requestCalls = sourceFiles
    .flatMap((filePath) => scanSourceRequestCalls(filePath))
    .filter((item) => item.fullPath);
const parseFailures = [];
const missingMethods = [];
const pathParseFailures = [];
const unresolvedRows = [];
const missingPaths = [];
const unresolvedAttributions = [];
const attributedMismatches = [];
const backendParseFailures = [];
const missingBackendRoutes = [];

for (const row of alignedRows) {
    if (!row.reference) {
        parseFailures.push({
            file: row.file,
            line: row.line,
            raw: row.methodCell || row.managerCell || row.status,
        });
        continue;
    }

    const ownerMethods = methodIndex.get(row.reference.owner);
    const fileHits = ownerMethods?.get(row.reference.method);
    if (!fileHits || fileHits.size === 0) {
        missingMethods.push({
            file: row.file,
            line: row.line,
            reference: `${row.reference.owner}.${row.reference.method}()`,
        });
    }

    if (!row.endpoint) {
        pathParseFailures.push({
            file: row.file,
            line: row.line,
            raw: row.endpointCell,
        });
        continue;
    }

    const documentedEndpoints = documentedEndpointsByFile.get(row.file) ?? [];
    const candidates = resolveDocumentedCandidates(row, documentedEndpoints);
    if (candidates.length === 0) {
        unresolvedRows.push({
            file: row.file,
            line: row.line,
            endpoint: `${row.endpoint.method} ${row.endpoint.path}`,
        });
        continue;
    }

    const matchedRequest = requestCalls.find(
        (request) =>
            request.method === row.endpoint.method &&
            candidates.some((candidate) => pathsMatchWithWildcards(request.fullPath, candidate.path)),
    );

    if (!matchedRequest) {
        missingPaths.push({
            file: row.file,
            line: row.line,
            endpoint: `${row.endpoint.method} ${row.endpoint.path}`,
            reference: `${row.reference.owner}.${row.reference.method}()`,
            candidates: candidates.map((candidate) => candidate.path),
        });
    }

    const attributedRequests = traceRequestsForReference(row.reference, traceIndex);
    if (attributedRequests.length === 0) {
        unresolvedAttributions.push({
            file: row.file,
            line: row.line,
            endpoint: `${row.endpoint.method} ${row.endpoint.path}`,
            reference: `${row.reference.owner}.${row.reference.method}()`,
        });
        continue;
    }

    const attributedMatch = attributedRequests.find(
        (request) =>
            request.method === row.endpoint.method &&
            candidates.some((candidate) => pathsMatchWithWildcards(request.fullPath, candidate.path)),
    );

    if (!attributedMatch) {
        attributedMismatches.push({
            file: row.file,
            line: row.line,
            endpoint: `${row.endpoint.method} ${row.endpoint.path}`,
            reference: `${row.reference.owner}.${row.reference.method}()`,
            tracedRequests: attributedRequests.map((request) => `${request.method} ${request.fullPath}`),
        });
    }
}

const synapseRootAvailable = fs.existsSync(synapseRoot);
if (!synapseRootAvailable) {
    console.warn(
        `[sdk-contract-alignment] synapse-rust not found at ${synapseRoot}, skipping backend route validation`,
    );
} else {
    const docsWithAlignedRows = [...new Set(alignedRows.map((row) => row.file))];
    for (const relativeDocPath of docsWithAlignedRows) {
        const absoluteDocPath = path.join(projectRoot, relativeDocPath);
        const backendFilePath = parseBackendCodePath(absoluteDocPath);
        if (!backendFilePath || !fs.existsSync(backendFilePath)) {
            backendParseFailures.push({
                file: relativeDocPath,
                reason: "backend code path missing or file not found",
            });
            continue;
        }

        const extracted = extractBackendRoutesFromFile(backendFilePath);
        if (!extracted.ok) {
            backendParseFailures.push({
                file: relativeDocPath,
                reason: extracted.reason,
                backendFile: path.relative(projectRoot, backendFilePath),
            });
            continue;
        }

        const documentedEndpoints = documentedEndpointsByFile.get(relativeDocPath) ?? [];
        for (const endpoint of documentedEndpoints) {
            const matched = extracted.routes.find(
                (route) => route.method === endpoint.method && pathsMatchWithWildcards(route.path, endpoint.path),
            );

            if (!matched) {
                missingBackendRoutes.push({
                    file: relativeDocPath,
                    line: endpoint.line,
                    endpoint: `${endpoint.method} ${endpoint.path}`,
                    backendFile: path.relative(projectRoot, backendFilePath),
                });
            }
        }
    }
}

if (
    parseFailures.length ||
    missingMethods.length ||
    pathParseFailures.length ||
    unresolvedRows.length ||
    missingPaths.length ||
    attributedMismatches.length ||
    backendParseFailures.length ||
    missingBackendRoutes.length
) {
    console.error("[sdk-contract-alignment] contract alignment check failed");
    if (parseFailures.length) {
        console.error("[sdk-contract-alignment] unable to parse aligned SDK references:");
        for (const item of parseFailures) {
            console.error(`- ${item.file}:${item.line} -> ${item.raw}`);
        }
    }
    if (missingMethods.length) {
        console.error("[sdk-contract-alignment] missing SDK methods referenced by docs:");
        for (const item of missingMethods) {
            console.error(`- ${item.file}:${item.line} -> ${item.reference}`);
        }
    }
    if (pathParseFailures.length) {
        console.error("[sdk-contract-alignment] unable to parse aligned endpoint references:");
        for (const item of pathParseFailures) {
            console.error(`- ${item.file}:${item.line} -> ${item.raw}`);
        }
    }
    if (unresolvedRows.length) {
        console.error("[sdk-contract-alignment] unable to resolve aligned rows to documented endpoint details:");
        for (const item of unresolvedRows) {
            console.error(`- ${item.file}:${item.line} -> ${item.endpoint}`);
        }
    }
    if (missingPaths.length) {
        console.error("[sdk-contract-alignment] aligned endpoints not covered by SDK request paths:");
        for (const item of missingPaths) {
            console.error(`- ${item.file}:${item.line} -> ${item.endpoint} via ${item.reference}`);
        }
    }
    if (attributedMismatches.length) {
        console.error(
            "[sdk-contract-alignment] documented method-to-endpoint mappings do not match traced request paths:",
        );
        for (const item of attributedMismatches) {
            console.error(`- ${item.file}:${item.line} -> ${item.endpoint} via ${item.reference}`);
            for (const tracedRequest of item.tracedRequests.slice(0, 3)) {
                console.error(`  traced: ${tracedRequest}`);
            }
        }
    }
    if (backendParseFailures.length) {
        console.error("[sdk-contract-alignment] unable to parse backend route files referenced by docs:");
        for (const item of backendParseFailures) {
            console.error(`- ${item.file} -> ${item.reason}`);
        }
    }
    if (missingBackendRoutes.length) {
        console.error("[sdk-contract-alignment] documented endpoints not found in referenced backend route files:");
        for (const item of missingBackendRoutes) {
            console.error(`- ${item.file}:${item.line} -> ${item.endpoint} (${item.backendFile})`);
        }
    }
    console.error("[sdk-contract-alignment] remediation hints:");
    console.error(
        "- keep `SDK 对齐状态` tables using either `Owner.method()` or split `SDK Manager` / `SDK 方法` columns",
    );
    console.error("- keep `后端端点` rows in `METHOD /path` format and ensure they map to a detailed `**路径**` entry");
    console.error("- update docs when the source symbol name changes");
    console.error("- update docs when a method is implemented via a different backend route than documented");
    console.error("- keep doc `> 后端代码:` pointers pointing at concrete synapse-rust route files");
    console.error("- re-run: pnpm quality:sdk-contracts");
    writeSummary({
        ok: false,
        checkedRows: alignedRows.length,
        parseFailures,
        missingMethods,
        pathParseFailures,
        unresolvedRows,
        missingPaths,
        unresolvedAttributions,
        attributedMismatches,
        backendParseFailures,
        missingBackendRoutes,
    });
    process.exit(1);
}

console.log(
    `[sdk-contract-alignment] ok (${alignedRows.length} aligned rows checked, ${unresolvedAttributions.length} unresolved attributions)`,
);
if (unresolvedAttributions.length) {
    console.warn("[sdk-contract-alignment] unresolved method attributions:");
    for (const item of unresolvedAttributions) {
        console.warn(`- ${item.file}:${item.line} -> ${item.endpoint} via ${item.reference}`);
    }
}
writeSummary({
    ok: true,
    checkedRows: alignedRows.length,
    parseFailures: [],
    missingMethods: [],
    pathParseFailures: [],
    unresolvedRows: [],
    missingPaths: [],
    unresolvedAttributions,
    attributedMismatches: [],
    backendParseFailures: [],
    missingBackendRoutes: [],
});
