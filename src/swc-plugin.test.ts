import { describe, test, expect } from "vitest";
import { transform } from "@swc/core";
import { resolve } from "node:path";

const wasmPath = resolve(__dirname, "..", "wasm", "observer.wasm");

async function runSwc(src: string): Promise<string> {
  const out = await transform(src, {
    filename: "/tmp/test.tsx",
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      experimental: {
        plugins: [[wasmPath, { import_path: "mobx-react-observer" }]],
      },
    },
  });
  return out.code;
}

describe("swc wasm plugin (against the @swc/core that ships with Vite 7/8)", () => {
  test("plugin loads and transforms a basic arrow component", async () => {
    const out = await runSwc(`const Foo = () => <div>hi</div>;`);
    expect(out).toMatch(/from "mobx-react-observer"/);
    expect(out).toMatch(/const Foo = observer\(/);
  });

  test("wraps observer outside forwardRef", async () => {
    const out = await runSwc(
      `const Foo = forwardRef((props, ref) => <div ref={ref} />);`,
    );
    expect(out).toMatch(/const Foo = observer\(forwardRef\(/);
  });

  test("wraps observer outside memo", async () => {
    const out = await runSwc(`const Foo = memo(() => <div />);`);
    expect(out).toMatch(/const Foo = observer\(memo\(/);
  });

  test("typescript overloads do not break the transform", async () => {
    const out = await runSwc(
      `function Foo(x: string): JSX.Element;
       function Foo(x: number): JSX.Element;
       function Foo(x: any): JSX.Element { return <div>{x}</div>; }`,
    );
    expect(out).toMatch(/const Foo = observer\(function Foo/);
    expect(out).not.toMatch(/function Foo\(x: string\)/);
  });

  test("lowercase functions are not wrapped with observer(...)", async () => {
    const out = await runSwc(`const counter = () => <div />;`);
    expect(out).not.toMatch(/observer\(/);
  });
});
