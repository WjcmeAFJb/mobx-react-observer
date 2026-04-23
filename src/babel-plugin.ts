import createPlugin from "./transform.js";

export default function plugin(
  options: { exclude?: string[]; stripAsMemo?: string[] } = {},
) {
  return createPlugin({
    importPath: "mobx-react-observer",
    ...options,
  });
}
