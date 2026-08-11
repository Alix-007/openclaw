import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HELPERS = new Set([
  "assertOkOrThrowHttpError",
  "assertOkOrThrowProviderError",
  "createProviderHttpError",
  "throwWebSearchApiError",
]);
const WRAPPER = "createMSTeamsHttpError";
const ERROR_OWNER = "src/agents/provider-http-errors.ts";
const MSTEAMS_OWNER = "extensions/msteams/src/http-error.ts";
const HELPER_MODULE = /(?:^|\/)(?:provider-http(?:\.js)?|provider-http-errors\.js)$/u;
const VALUE_OWNERS = new Map([
  ["extensions/chutes/oauth.ts", "OAuth form body"],
  ["extensions/msteams/src/oauth.token.ts", "OAuth form body"],
  ["src/media-understanding/shared.ts#fetchProviderOperationResponse", "signed URL"],
]);

type SymbolRef = { name: string; module: string };
type SourceModel = {
  filePath: string;
  source: ts.SourceFile;
  named: Map<string, SymbolRef>;
  namespaces: Map<string, string>;
};
type Finding = { callsite: string; helper: string; owner: string; reason: string };

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function parseSource(filePath: string, text: string): SourceModel {
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const named = new Map<string, SymbolRef>();
  const namespaces = new Map<string, string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings
    ) {
      continue;
    }
    const module = statement.moduleSpecifier.text;
    const bindings = statement.importClause.namedBindings;
    if (ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        named.set(item.name.text, { name: item.propertyName?.text ?? item.name.text, module });
      }
    } else {
      namespaces.set(bindings.name.text, module);
    }
  }
  return { filePath, source, named, namespaces };
}

function symbolRef(expression: ts.Expression, model: SourceModel): SymbolRef | undefined {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    return model.named.get(current.text);
  }
  if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression)) {
    const module = model.namespaces.get(current.expression.text);
    return module ? { name: current.name.text, module } : undefined;
  }
  if (
    ts.isElementAccessExpression(current) &&
    ts.isIdentifier(current.expression) &&
    current.argumentExpression &&
    ts.isStringLiteralLike(current.argumentExpression)
  ) {
    const module = model.namespaces.get(current.expression.text);
    return module ? { name: current.argumentExpression.text, module } : undefined;
  }
  return undefined;
}

function canonicalHelper(expression: ts.Expression, model: SourceModel): string | undefined {
  const imported = symbolRef(expression, model);
  if (imported?.name === WRAPPER) {
    return /(?:^|\/)http-error\.js$/u.test(imported.module) ? WRAPPER : undefined;
  }
  if (imported) {
    return HELPERS.has(imported.name) && HELPER_MODULE.test(imported.module)
      ? imported.name
      : undefined;
  }
  const current = unwrap(expression);
  const local = ts.isIdentifier(current) ? current.text : undefined;
  if (model.filePath === ERROR_OWNER && local && HELPERS.has(local)) {
    return local;
  }
  return model.filePath === MSTEAMS_OWNER && local === WRAPPER ? WRAPPER : undefined;
}

function isFunctionOwner(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionLike(node) && "body" in node;
}

function nearestOwner(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (isFunctionOwner(current)) {
      return current;
    }
  }
  return undefined;
}

function ownerName(owner: ts.FunctionLikeDeclaration | undefined): string {
  if (!owner) {
    return "<module>";
  }
  if (owner.name) {
    return owner.name.getText();
  }
  return ts.isVariableDeclaration(owner.parent) ? owner.parent.name.getText() : "callback";
}

function localInitializer(identifier: ts.Identifier, from: ts.Node): ts.Expression | undefined {
  const owner = nearestOwner(from);
  if (!owner) {
    return undefined;
  }
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (node.getStart() >= from.getStart() || (node !== owner && isFunctionOwner(node))) {
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === identifier.text &&
      node.initializer
    ) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(owner, visit);
  return initializer;
}

function responseComesFromRawFetch(call: ts.CallExpression): boolean {
  const seen = new Set<ts.Node>();
  const visit = (expression: ts.Expression): boolean => {
    const current = unwrap(expression);
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);
    if (ts.isCallExpression(current)) {
      return visit(current.expression);
    }
    if (ts.isIdentifier(current)) {
      if (current.text === "fetch") {
        return true;
      }
      const initializer = localInitializer(current, call);
      return initializer ? visit(initializer) : false;
    }
    if (ts.isPropertyAccessExpression(current)) {
      if (
        current.name.text === "fetch" &&
        ts.isIdentifier(current.expression) &&
        ["globalThis", "window"].includes(current.expression.text)
      ) {
        return true;
      }
      return visit(current.expression);
    }
    if (ts.isElementAccessExpression(current)) {
      return visit(current.expression);
    }
    return false;
  };
  const response = call.arguments[0];
  return response ? visit(response) : false;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  return property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
    ? property.name.text
    : undefined;
}

function explicitContext(call: ts.CallExpression): Set<string> {
  const options = call.arguments[2] ? unwrap(call.arguments[2]) : undefined;
  if (!options || !ts.isObjectLiteralExpression(options)) {
    return new Set();
  }
  const fields = new Set<string>();
  for (const property of options.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      if (["requestHeaders", "sensitiveValues"].includes(property.name.text)) {
        fields.add(property.name.text);
      }
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const name = propertyName(property);
    const value = unwrap(property.initializer);
    if (name === "requestHeaders" && value.kind !== ts.SyntaxKind.NullKeyword) {
      fields.add(name);
    }
    if (
      name === "sensitiveValues" &&
      ((ts.isArrayLiteralExpression(value) && value.elements.length > 0) ||
        (ts.isCallExpression(value) &&
          ts.isPropertyAccessExpression(value.expression) &&
          value.expression.name.text === "flatMap"))
    ) {
      fields.add(name);
    }
  }
  return fields;
}

function productionFiles(repoRoot: string): string[] {
  const output = execFileSync(
    "git",
    [
      "grep",
      "-l",
      "-z",
      ...[...HELPERS, WRAPPER, "ProviderHttpError"].flatMap((name) => ["-e", name]),
      "--",
      "*.ts",
      "*.tsx",
    ],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return output
    .split("\0")
    .filter(
      (filePath) =>
        /^(?:extensions|packages|src)\//u.test(filePath) &&
        !/\.d\.[cm]?ts$/u.test(filePath) &&
        !/(?:^|\/)(?:__tests__|fixtures?|test-data)(?:\/|$)|\.(?:test|spec)\.[cm]?tsx?$/u.test(
          filePath,
        ),
    )
    .toSorted();
}

function lineOf(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function inventory(repoRoot: string): Finding[] {
  const findings: Finding[] = [];
  for (const filePath of productionFiles(repoRoot)) {
    const model = parseSource(filePath, readFileSync(path.join(repoRoot, filePath), "utf8"));
    const visit = (node: ts.Node) => {
      if (ts.isNewExpression(node)) {
        const constructor = symbolRef(node.expression, model);
        if (filePath !== ERROR_OWNER && constructor?.name === "ProviderHttpError") {
          findings.push({
            callsite: `${filePath}:${lineOf(node, model.source)}`,
            helper: "new ProviderHttpError",
            owner: ownerName(nearestOwner(node)),
            reason: "construction belongs to the canonical provider error owner",
          });
        }
      }
      if (!ts.isCallExpression(node)) {
        ts.forEachChild(node, visit);
        return;
      }
      const helper = canonicalHelper(node.expression, model);
      if (
        !helper ||
        filePath === ERROR_OWNER ||
        (filePath === MSTEAMS_OWNER && helper === "createProviderHttpError")
      ) {
        ts.forEachChild(node, visit);
        return;
      }
      const owner = ownerName(nearestOwner(node));
      const fields = explicitContext(node);
      const valueReason = VALUE_OWNERS.get(`${filePath}#${owner}`) ?? VALUE_OWNERS.get(filePath);
      const reason =
        valueReason && !fields.has("sensitiveValues")
          ? `missing statically non-empty sensitiveValues for ${valueReason}`
          : fields.size === 0 && responseComesFromRawFetch(node)
            ? "raw response lacks explicit request context"
            : undefined;
      if (reason) {
        findings.push({
          callsite: `${filePath}:${lineOf(node, model.source)}`,
          helper,
          owner,
          reason,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(model.source);
  }
  return findings;
}

describe("provider HTTP error callsite inventory", () => {
  it("requires context for raw responses even alongside guarded calls", () => {
    const model = parseSource(
      "src/inventory-fixture.ts",
      `
        import { createProviderHttpError } from "./provider-http-errors.js";
        import { fetchWithTimeoutGuarded } from "../plugin-sdk/provider-http.js";
        async function mixed() {
          const result = await fetchWithTimeoutGuarded("https://example.test", {}, 1, fetch);
          await createProviderHttpError(result.response, "guarded failed");
          const response = await fetch("https://example.test");
          await createProviderHttpError(response, "raw failed");
          const globalResponse = await globalThis.fetch("https://example.test");
          await createProviderHttpError(globalResponse, "global raw failed");
          const fetchFn = fetch;
          const aliasedResponse = await fetchFn("https://example.test");
          return createProviderHttpError(aliasedResponse, "aliased raw failed");
        }
      `,
    );
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && canonicalHelper(node.expression, model)) {
        calls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(model.source);

    expect(calls.map((call) => responseComesFromRawFetch(call))).toEqual([false, true, true, true]);
  });

  it("rejects bounded context gaps at canonical helper callsites", () => {
    const findings = inventory(process.cwd());

    expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
  });
});
