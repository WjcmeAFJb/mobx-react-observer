import { createRequire } from "node:module";

// Resolve the bundled wasm plugin. Using `createRequire(process.cwd() + "/")`
// works in both CJS and ESM emit because we don't touch `import.meta`.
// The wasm is compiled against the swc_core that ships with @swc/core ≥ 1.15,
// which is what @vitejs/plugin-react-swc 4.x (Vite 7/8) uses.
function resolveWasmPath(): string {
  const baseRequire =
    typeof require === "function"
      ? (require as NodeJS.Require)
      : createRequire(process.cwd() + "/");
  return baseRequire.resolve("mobx-react-observer/wasm/observer.wasm");
}

export default function plugin(
  options: { exclude?: string[]; stripAsMemo?: string[] } = {},
) {
  const { stripAsMemo, ...rest } = options;
  const config: Record<string, unknown> = {
    import_path: "mobx-react-observer",
    ...rest,
  };
  // swc plugin config uses snake_case field names (serde default).
  if (stripAsMemo && stripAsMemo.length > 0) {
    config.strip_as_memo = stripAsMemo;
  }
  return [resolveWasmPath(), config];
}
