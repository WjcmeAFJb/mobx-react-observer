import { describe, test, expect } from "vitest";
import { transform } from "@swc/core";
import { resolve } from "node:path";

const wasmPath = resolve(__dirname, "..", "wasm", "observer.wasm");

async function runSwc(
  src: string,
  extraConfig: Record<string, unknown> = {},
): Promise<string> {
  const out = await transform(src, {
    filename: "/tmp/test.tsx",
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      experimental: {
        plugins: [
          [
            wasmPath,
            { import_path: "mobx-react-observer", ...extraConfig },
          ],
        ],
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

  test("wraps observer outside forwardRef (arrow)", async () => {
    const out = await runSwc(
      `const Foo = forwardRef((props, ref) => <div ref={ref} />);`,
    );
    expect(out).toMatch(/const Foo = observer\(forwardRef\(/);
    expect(out).not.toMatch(/memo/);
  });

  test("wraps observer outside forwardRef (named function expression)", async () => {
    const out = await runSwc(
      `const Component = forwardRef(function Component(props, ref) {
         return <div ref={ref} />;
       });`,
    );
    expect(out).toMatch(
      /const Component = observer\(forwardRef\(function Component\(/,
    );
  });

  test("memo wrappers are dropped: memo(arrow)", async () => {
    const out = await runSwc(`const Foo = memo(() => <div />);`);
    expect(out).toMatch(/const Foo = observer\(\(\)/);
    expect(out).not.toMatch(/memo/);
  });

  test("memo wrappers are dropped: memo(named function expression)", async () => {
    const out = await runSwc(
      `const Foo = memo(function Foo() { return <div />; });`,
    );
    expect(out).toMatch(/const Foo = observer\(function Foo\(/);
    expect(out).not.toMatch(/memo/);
  });

  test("memo wrappers are dropped: React.memo", async () => {
    const out = await runSwc(`const Foo = React.memo(() => <div />);`);
    expect(out).toMatch(/const Foo = observer\(/);
    expect(out).not.toMatch(/React\.memo/);
  });

  test("memo around forwardRef: memo(forwardRef(arrow)) -> observer(forwardRef(arrow))", async () => {
    const out = await runSwc(
      `const Foo = memo(forwardRef((props, ref) => <div ref={ref} />));`,
    );
    expect(out).toMatch(/const Foo = observer\(forwardRef\(/);
    expect(out).not.toMatch(/\bmemo\(/);
  });

  test("memo around forwardRef (named): memo(forwardRef(function Component(...) {...}))", async () => {
    const out = await runSwc(
      `const Component = memo(
         forwardRef(function Component(props, ref) {
           return <div ref={ref} />;
         }),
       );`,
    );
    expect(out).toMatch(
      /const Component = observer\(forwardRef\(function Component\(/,
    );
    expect(out).not.toMatch(/\bmemo\(/);
  });

  test("React.memo(React.forwardRef(...)) drops React.memo", async () => {
    const out = await runSwc(
      `const Foo = React.memo(React.forwardRef((props, ref) => <div ref={ref} />));`,
    );
    expect(out).toMatch(/const Foo = observer\(React\.forwardRef\(/);
    expect(out).not.toMatch(/React\.memo/);
  });

  test("forwardRef(memo(...)) also drops the inner memo", async () => {
    const out = await runSwc(
      `const Foo = forwardRef(memo(function Foo(props, ref) { return <div ref={ref} />; }));`,
    );
    expect(out).toMatch(
      /const Foo = observer\(forwardRef\(function Foo\(/,
    );
    expect(out).not.toMatch(/\bmemo\(/);
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

  test("already-observer wrap is left alone", async () => {
    const src = `const Foo = observer(() => <div />);`;
    const out = await runSwc(src);
    // Should still contain a single observer() call.
    const matches = out.match(/observer\(/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("observer(memo(fn)) has the memo layer stripped", async () => {
    // Even when the user manually wrote observer(memo(fn)), the memo is
    // removed because it's broken at runtime.
    const out = await runSwc(`const Foo = observer(memo(() => <div />));`);
    expect(out).toMatch(/const Foo = observer\(\(\)/);
    expect(out).not.toMatch(/\bmemo\(/);
  });

  test("memo(unknownHOC(function Component(){...})) keeps the HOC, drops memo, wraps observer outside", async () => {
    const out = await runSwc(
      `const Component = memo(withSomeHOCSome(function Component() { return <div />; }));`,
    );
    expect(out).toMatch(
      /const Component = observer\(withSomeHOCSome\(function Component\(/,
    );
    expect(out).not.toMatch(/\bmemo\(/);
  });

  test("unknownHOC(memo(fn)) drops inner memo, keeps the HOC", async () => {
    const out = await runSwc(
      `const Component = withSomeHOCSome(memo(function Component() { return <div />; }));`,
    );
    expect(out).toMatch(
      /const Component = observer\(withSomeHOCSome\(function Component\(/,
    );
    expect(out).not.toMatch(/\bmemo\(/);
  });

  test("custom memo-alias via strip_as_memo is stripped", async () => {
    const out = await runSwc(
      `const Component = withMemo(withSomeHOCSome(() => <div />));`,
      { strip_as_memo: ["withMemo"] },
    );
    expect(out).toMatch(
      /const Component = observer\(withSomeHOCSome\(\(\)/,
    );
    expect(out).not.toMatch(/withMemo\(/);
  });

  test("// @no-observer opt-out pragma skips the next statement", async () => {
    const out = await runSwc(
      `// @no-observer
const Foo = () => <div />;
const Bar = () => <div />;`,
    );
    // Foo must not be observer-wrapped.
    expect(out).toMatch(/const Foo = \(\)\s*=>/);
    expect(out).not.toMatch(/const Foo = observer\(/);
    // Bar still gets wrapped.
    expect(out).toMatch(/const Bar = observer\(/);
  });

  test("@no-observer on a function declaration is honoured", async () => {
    const out = await runSwc(
      `// @no-observer
function Foo() { return <div />; }`,
    );
    expect(out).not.toMatch(/observer\(/);
    expect(out).toMatch(/function Foo\(/);
  });

  test("@no-observer on export default is honoured", async () => {
    const out = await runSwc(
      `// @no-observer
export default () => <div />;`,
    );
    expect(out).not.toMatch(/observer\(/);
  });

  test("@no-observer works with block comments", async () => {
    const out = await runSwc(
      `/* @no-observer */
const Foo = memo(() => <div />);`,
    );
    // memo should ALSO be preserved (we leave the whole statement alone).
    expect(out).toMatch(/const Foo = memo\(/);
    expect(out).not.toMatch(/observer\(/);
  });
});
