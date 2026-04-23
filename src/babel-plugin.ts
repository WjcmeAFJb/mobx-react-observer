import createPlugin from "./transform";

export default function plugin(options: { exclude?: string[] } = {}) {
  return createPlugin({
    importPath: "mobx-react-observer",
    ...options,
  });
}
