import type { NodePath, PluginObj, PluginPass } from "@babel/core";
import type {
  CallExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  ArrowFunctionExpression,
  TSDeclareFunction,
} from "@babel/types";
import {
  callExpression,
  exportDefaultDeclaration,
  exportNamedDeclaration,
  functionExpression,
  identifier,
  importDeclaration,
  importSpecifier,
  isCallExpression,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isImportSpecifier,
  isMemberExpression,
  isObjectProperty,
  isTSDeclareFunction,
  isVariableDeclarator,
  stringLiteral,
  variableDeclaration,
  variableDeclarator,
} from "@babel/types";
import { minimatch } from "minimatch";

export interface TransformOptions {
  importPath: string;
  importName?: string;
  exclude?: string[];
}

export interface TransformState extends PluginPass {
  opts: TransformOptions & { filename?: string };
}

type ComponentFunctionPath =
  | NodePath<FunctionDeclaration>
  | NodePath<FunctionExpression>
  | NodePath<ArrowFunctionExpression>;

const WRAPPER_NAMES = new Set([
  "forwardRef",
  "memo",
  "React.forwardRef",
  "React.memo",
]);

function calleeName(node: CallExpression): string | null {
  const callee = node.callee;
  if (isIdentifier(callee)) return callee.name;
  if (
    isMemberExpression(callee) &&
    isIdentifier(callee.object) &&
    isIdentifier(callee.property) &&
    !callee.computed
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return null;
}

function isWrapperOrObserverCall(
  node: CallExpression,
  observerName: string,
): boolean {
  const name = calleeName(node);
  if (!name) return false;
  return name === observerName || WRAPPER_NAMES.has(name);
}

function startsWithUppercase(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function hasJsx(path: NodePath): boolean {
  let found = false;
  path.traverse({
    JSX() {
      found = true;
    },
    Function(innerPath) {
      if (innerPath !== path) innerPath.skip();
    },
  });
  return found;
}

function findComponentName(path: ComponentFunctionPath): string | null {
  if (isFunctionDeclaration(path.node) && path.node.id) {
    return path.node.id.name;
  }

  let current: NodePath | null = path.parentPath;
  while (current) {
    const node = current.node;
    if (isObjectProperty(node)) return null;
    if (isVariableDeclarator(node) && isIdentifier(node.id)) return node.id.name;
    if (isCallExpression(node)) {
      current = current.parentPath;
      continue;
    }
    if (current.isStatement()) break;
    current = current.parentPath;
  }

  const node = path.node;
  if (!isFunctionDeclaration(node) && "id" in node && node.id) {
    return node.id.name;
  }

  return null;
}

function findOutermostWrapperCall(
  path: ComponentFunctionPath,
  observerName: string,
): NodePath<CallExpression> | null {
  let current: NodePath | null = path.parentPath;
  let outermost: NodePath<CallExpression> | null = null;

  while (current && isCallExpression(current.node)) {
    const name = calleeName(current.node as CallExpression);
    if (name === observerName) return null;
    if (!isWrapperOrObserverCall(current.node as CallExpression, observerName)) break;
    outermost = current as NodePath<CallExpression>;
    current = current.parentPath;
  }
  return outermost;
}

function isAlreadyObserved(
  path: ComponentFunctionPath,
  observerName: string,
): boolean {
  let current: NodePath | null = path.parentPath;
  while (current && isCallExpression(current.node)) {
    if (calleeName(current.node as CallExpression) === observerName) {
      return true;
    }
    current = current.parentPath;
  }
  return false;
}

function isInsideWrapperCall(path: ComponentFunctionPath): boolean {
  const parent = path.parent;
  if (!isCallExpression(parent)) return false;
  const name = calleeName(parent as CallExpression);
  return name !== null && WRAPPER_NAMES.has(name);
}

function collectOverloadSiblings(
  path: NodePath,
  name: string,
): NodePath[] {
  const results: NodePath[] = [];
  const key = Number(path.key);
  if (Number.isNaN(key)) return results;
  let sibling = path.getSibling(key - 1);
  while (sibling && sibling.node) {
    const node = sibling.node;
    let declNode: TSDeclareFunction | null = null;
    let target: NodePath = sibling;
    if (isTSDeclareFunction(node)) {
      declNode = node;
    } else if (
      (sibling.isExportNamedDeclaration() ||
        sibling.isExportDefaultDeclaration()) &&
      sibling.node.declaration &&
      isTSDeclareFunction(sibling.node.declaration)
    ) {
      declNode = sibling.node.declaration as TSDeclareFunction;
      target = sibling;
    }
    if (!declNode || !declNode.id || declNode.id.name !== name) break;
    results.unshift(target);
    sibling = sibling.getSibling(Number(sibling.key) - 1);
  }
  return results;
}

function buildObserverCall(
  observerName: string,
  arg: Expression,
): CallExpression {
  return callExpression(identifier(observerName), [arg]);
}

function wrapFunctionDeclarationWithObservers(
  path: NodePath<FunctionDeclaration>,
  observerName: string,
): boolean {
  const node = path.node;
  if (!node.id) return false;
  const name = node.id.name;

  const isExported =
    isExportNamedDeclaration(path.parent) ||
    isExportDefaultDeclaration(path.parent);
  const declPath: NodePath = isExported
    ? (path.parentPath as NodePath)
    : path;

  const overloads = collectOverloadSiblings(declPath, name);

  const fnExpr = functionExpression(
    node.id,
    node.params,
    node.body,
    node.generator,
    node.async,
  );
  fnExpr.returnType = node.returnType ?? null;
  fnExpr.typeParameters = node.typeParameters ?? null;

  const observerCall = buildObserverCall(observerName, fnExpr);

  if (isExportDefaultDeclaration(path.parent)) {
    for (const overload of overloads) overload.remove();
    (path.parentPath as NodePath).replaceWith(
      exportDefaultDeclaration(observerCall),
    );
    return true;
  }

  const declarator = variableDeclarator(identifier(name), observerCall);
  const decl = variableDeclaration("const", [declarator]);

  if (isExportNamedDeclaration(path.parent)) {
    for (const overload of overloads) overload.remove();
    (path.parentPath as NodePath).replaceWith(exportNamedDeclaration(decl, []));
  } else {
    for (const overload of overloads) overload.remove();
    path.replaceWith(decl);
  }
  return true;
}

function wrapExpressionFunctionWithObserver(
  path: NodePath<FunctionExpression> | NodePath<ArrowFunctionExpression>,
  observerName: string,
): boolean {
  const outer = findOutermostWrapperCall(path, observerName);

  if (outer) {
    const outerParent = outer.parentPath;
    if (
      outerParent &&
      isCallExpression(outerParent.node) &&
      calleeName(outerParent.node as CallExpression) === observerName
    ) {
      return false;
    }
    const observerCall = buildObserverCall(
      observerName,
      outer.node as Expression,
    );
    outer.replaceWith(observerCall);
    return true;
  }

  if (isInsideWrapperCall(path)) return false;

  const parent = path.parent;
  if (
    isCallExpression(parent) &&
    calleeName(parent as CallExpression) === observerName
  ) {
    return false;
  }

  const observerCall = buildObserverCall(observerName, path.node as Expression);
  path.replaceWith(observerCall);
  return true;
}

function shouldProcessFile(
  filename: string | undefined,
  excludePatterns: string[] | undefined,
): boolean {
  if (!filename) return true;
  if (filename.includes("node_modules")) return false;
  const cwd = process.cwd();
  const isProjectFile = filename.startsWith(cwd);
  if (!isProjectFile) return false;
  if (excludePatterns && excludePatterns.length > 0) {
    const relativePath = filename.substring(cwd.length + 1);
    for (const pattern of excludePatterns) {
      if (minimatch(relativePath, pattern)) return false;
    }
  }
  return true;
}

export const transform: PluginObj<TransformState> = {
  name: "mobx-react-observer/wrap-with-observer",
  visitor: {
    Program(path, state) {
      const filename = state.filename || (state.opts as any).filename;
      const IMPORT_PATH = state.opts.importPath;
      const IMPORT_NAME = state.opts.importName || "observer";
      const EXCLUDE_PATTERNS = state.opts.exclude;

      if (!shouldProcessFile(filename, EXCLUDE_PATTERNS)) return;

      let hasObserverImport = false;
      let transformed = false;

      path.traverse({
        ImportDeclaration(importPath) {
          if (importPath.node.source.value === IMPORT_PATH) {
            const hasSpec = importPath.node.specifiers.some(
              (s) =>
                isImportSpecifier(s) &&
                isIdentifier(s.imported) &&
                s.imported.name === IMPORT_NAME,
            );
            if (!hasSpec) {
              importPath.node.specifiers.push(
                importSpecifier(identifier(IMPORT_NAME), identifier(IMPORT_NAME)),
              );
            }
            hasObserverImport = true;
          }
        },
      });

      const tryWrap = (fnPath: ComponentFunctionPath) => {
        if (isObjectProperty(fnPath.parent)) return;
        if (!hasJsx(fnPath)) return;
        if (isAlreadyObserved(fnPath, IMPORT_NAME)) return;

        const insideWrapper = isInsideWrapperCall(fnPath);
        const componentName = findComponentName(fnPath);

        if (!insideWrapper && !componentName) return;
        if (componentName && !startsWithUppercase(componentName)) return;

        let didWrap = false;
        if (fnPath.isFunctionDeclaration()) {
          didWrap = wrapFunctionDeclarationWithObservers(fnPath, IMPORT_NAME);
        } else {
          didWrap = wrapExpressionFunctionWithObserver(
            fnPath as NodePath<FunctionExpression> | NodePath<ArrowFunctionExpression>,
            IMPORT_NAME,
          );
        }
        if (didWrap) {
          transformed = true;
          fnPath.skip();
        }
      };

      path.traverse({
        FunctionDeclaration(fnPath) {
          tryWrap(fnPath);
        },
        FunctionExpression(fnPath) {
          tryWrap(fnPath);
        },
        ArrowFunctionExpression(fnPath) {
          tryWrap(fnPath);
        },
      });

      if (!hasObserverImport && transformed) {
        const importDecl = importDeclaration(
          [importSpecifier(identifier(IMPORT_NAME), identifier(IMPORT_NAME))],
          stringLiteral(IMPORT_PATH),
        );
        path.unshiftContainer("body", importDecl);
      }
    },
  },
};

export default function createPlugin(options: TransformOptions) {
  return [
    transform,
    {
      importPath: options.importPath,
      importName: options.importName || "observer",
      exclude: options.exclude || [],
    },
  ];
}
