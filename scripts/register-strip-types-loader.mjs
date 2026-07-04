/* @Codex */
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const serverOnlyShimUrl = 'data:text/javascript,export%20%7B%7D%3B';

function candidatePaths(basePath) {
  const parsed = path.parse(basePath);
  const hasExtension = Boolean(parsed.ext);

  if (hasExtension) {
    return [basePath];
  }

  return [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
  ];
}

function resolveFilePath(basePath) {
  for (const candidate of candidatePaths(basePath)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href;
    }
  }

  return null;
}

function transpileTypeScript(url) {
  const filePath = fileURLToPath(url);
  const source = fs.readFileSync(filePath, 'utf8');
  const usesCommonJsRequire = /\brequire\s*\(/.test(source) || /\bmodule\.exports\b/.test(source);
  const usesEsmOnlyFeatures = /\bimport\.meta\b/.test(source)
    || /\bfrom\s+['"]\.{1,2}\/[^'"]+\.[cm]?tsx?['"]/.test(source)
    || /\bimport\s*\(\s*['"]\.{1,2}\/[^'"]+\.[cm]?tsx?['"]\s*\)/.test(source);
  const emitEsm = usesEsmOnlyFeatures && !usesCommonJsRequire;
  const moduleKind = emitEsm ? ts.ModuleKind.ES2022 : ts.ModuleKind.CommonJS;
  const result = ts.transpileModule(source, {
    fileName: filePath,
    compilerOptions: {
      esModuleInterop: true,
      isolatedModules: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: moduleKind,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });

  const outputText = emitEsm
    ? result.outputText
    : result.outputText.replace(
      /\bimport\.meta\.url\b/g,
      'require("node:url").pathToFileURL(__filename).href',
    );

  return {
    format: emitEsm ? 'module' : 'commonjs',
    shortCircuit: true,
    source: outputText,
  };
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return {
        shortCircuit: true,
        url: serverOnlyShimUrl,
      };
    }

    if (specifier.startsWith('@/')) {
      const aliasPath = path.join(repoRoot, specifier.slice(2));
      const resolved = resolveFilePath(aliasPath);
      if (resolved) {
        return {
          shortCircuit: true,
          url: resolved,
        };
      }
    }

    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
      const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);
      if (!isRelative || hasExtension) {
        throw error;
      }

      const parentPath = context.parentURL?.startsWith('file:')
        ? path.dirname(fileURLToPath(context.parentURL))
        : process.cwd();
      const resolved = resolveFilePath(path.resolve(parentPath, specifier));
      if (resolved) {
        return {
          shortCircuit: true,
          url: resolved,
        };
      }

      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url === serverOnlyShimUrl) {
      return {
        format: 'commonjs',
        shortCircuit: true,
        source: 'module.exports = {};\n',
      };
    }

    if (url.startsWith('file:') && /\.[cm]?tsx?$/.test(fileURLToPath(url))) {
      return transpileTypeScript(url);
    }

    return nextLoad(url, context);
  },
});
