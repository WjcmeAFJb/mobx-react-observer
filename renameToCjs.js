import fs from "node:fs";
import path from "node:path";

// tsc emits `.js` files into dist/cjs, but the package-level `"type": "module"`
// tells Node to treat them as ESM. We override it locally by dropping a
// `package.json` with `"type": "commonjs"` inside dist/cjs, and renaming the
// files to `.cjs` so that the user-facing entry points still resolve to a
// CJS-looking filename.
//
// The previous approach (rename .js to .cjs) broke relative imports like
// `require("./transform.js")` produced by tsc, because the target file on
// disk was now `./transform.cjs`. Keeping both steps AND rewriting the
// require strings keeps the file names consistent and the requires working.

function walk(dir, fn) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      walk(full, fn);
    } else {
      fn(full);
    }
  }
}

const cjsRoot = "dist/cjs";

// 1. Rewrite relative require("./x.js") -> require("./x.cjs") in every emitted JS file.
walk(cjsRoot, (file) => {
  if (!file.endsWith(".js")) return;
  const original = fs.readFileSync(file, "utf8");
  const rewritten = original.replace(
    /require\(("|')(\.\.?\/[^"']+?)\.js\1\)/g,
    (_m, q, p) => `require(${q}${p}.cjs${q})`,
  );
  if (rewritten !== original) fs.writeFileSync(file, rewritten);
});

// 2. Rename .js -> .cjs (including sourcemaps that reference the .js files).
walk(cjsRoot, (file) => {
  if (file.endsWith(".js")) {
    fs.renameSync(file, file.replace(/\.js$/, ".cjs"));
  }
});

// 3. Drop a package.json so Node reads .cjs (and any stray .js) as CJS.
fs.writeFileSync(
  path.join(cjsRoot, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2),
);

console.log("Wrote dist/cjs as CommonJS (.cjs files + type: commonjs)");
