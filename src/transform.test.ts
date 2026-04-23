import { describe, test, expect } from "vitest";
import { transformSync } from "@babel/core";
import createPlugin from "./transform";

function run(input: string, opts: { ts?: boolean } = {}): string {
  const result = transformSync(input, {
    babelrc: false,
    configFile: false,
    filename: opts.ts ? "test.tsx" : "test.jsx",
    plugins: [
      opts.ts
        ? ["@babel/plugin-syntax-typescript", { isTSX: true }]
        : "@babel/plugin-syntax-jsx",
      createPlugin({ importPath: "mobx-react-observer" }),
    ],
  });
  return result?.code ?? "";
}

describe("base transform (parity with upstream)", () => {
  test("does not transform a function without JSX", () => {
    expect(
      run(`const Counter = () => {
  return;
};`),
    ).toBe(`const Counter = () => {
  return;
};`);
  });

  test("wraps uppercase arrow component", () => {
    expect(
      run(`const Counter = () => {
  return <h1>hi</h1>;
};`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Counter = observer(() => {
  return <h1>hi</h1>;
});`);
  });

  test("wraps uppercase function declaration", () => {
    expect(run(`function Counter() { return <h1>hi</h1>; }`)).toBe(
      `import { observer } from "mobx-react-observer";
const Counter = observer(function Counter() {
  return <h1>hi</h1>;
});`,
    );
  });

  test("does not transform lowercase-named components", () => {
    expect(
      run(`const counter = () => <div />;
function counter2() { return <div />; }`),
    ).toBe(`const counter = () => <div />;
function counter2() {
  return <div />;
}`);
  });

  test("does not transform components declared in object literals", () => {
    expect(
      run(`const components = { Foo: () => <div /> };`),
    ).toBe(`const components = {
  Foo: () => <div />
};`);
  });

  test("leaves already-observed components alone", () => {
    expect(
      run(`const Counter = observer(() => <h1>hi</h1>);`),
    ).toBe(`const Counter = observer(() => <h1>hi</h1>);`);
  });

  test("reuses an existing observer import instead of adding a new one", () => {
    const out = run(
      `import { observer } from "mobx-react-observer";
const Counter = () => <h1>hi</h1>;`,
    );
    expect(out.match(/observer/g)?.length).toBeGreaterThanOrEqual(2);
    expect(
      out.split("\n").filter((l) => l.includes(`from "mobx-react-observer"`)).length,
    ).toBe(1);
  });
});

describe("forwardRef", () => {
  test("observer wraps forwardRef from the outside (anonymous arrow)", () => {
    expect(
      run(`const Foo = forwardRef((props, ref) => <div ref={ref} />);`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(forwardRef((props, ref) => <div ref={ref} />));`);
  });

  test("observer wraps forwardRef from the outside (named function expression)", () => {
    expect(
      run(`const Foo = forwardRef(function Foo(props, ref) { return <div ref={ref} />; });`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(forwardRef(function Foo(props, ref) {
  return <div ref={ref} />;
}));`);
  });

  test("observer wraps React.forwardRef", () => {
    expect(
      run(`const Foo = React.forwardRef((props, ref) => <div ref={ref} />);`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(React.forwardRef((props, ref) => <div ref={ref} />));`);
  });

  test("observer wraps forwardRef in an export default", () => {
    expect(
      run(`export default forwardRef((props, ref) => <div ref={ref} />);`),
    ).toBe(`import { observer } from "mobx-react-observer";
export default observer(forwardRef((props, ref) => <div ref={ref} />));`);
  });

  test("already-observed forwardRef is not re-wrapped", () => {
    const src = `const Foo = observer(forwardRef((props, ref) => <div ref={ref} />));`;
    expect(run(src)).toBe(src);
  });

  test("forwardRef(observer(fn)) is left alone (the inner fn is already observed)", () => {
    const src = `const Foo = forwardRef(observer((props, ref) => <div ref={ref} />));`;
    expect(run(src)).toBe(src);
  });
});

describe("memo is dropped", () => {
  // observer from mobx-react-lite already memoises and cannot wrap a memo
  // component (it tries to invoke the base as a render function). So memo
  // layers are removed during the transform.

  test("memo(arrow) becomes observer(arrow)", () => {
    expect(
      run(`const Foo = memo((props) => <div>{props.x}</div>);`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(props => <div>{props.x}</div>);`);
  });

  test("memo(forwardRef(fn)) becomes observer(forwardRef(fn))", () => {
    expect(
      run(`const Foo = memo(forwardRef((props, ref) => <div ref={ref} />));`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(forwardRef((props, ref) => <div ref={ref} />));`);
  });

  test("memo(named function expression) becomes observer(named fn)", () => {
    expect(
      run(`const Foo = memo(function Foo(props) { return <div>{props.x}</div>; });`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(function Foo(props) {
  return <div>{props.x}</div>;
});`);
  });

  test("React.memo is dropped the same way", () => {
    expect(
      run(`const Foo = React.memo((props) => <div>{props.x}</div>);`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(props => <div>{props.x}</div>);`);
  });

  test("React.memo(React.forwardRef(fn)) becomes observer(React.forwardRef(fn))", () => {
    expect(
      run(
        `const Foo = React.memo(React.forwardRef((props, ref) => <div ref={ref} />));`,
      ),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(React.forwardRef((props, ref) => <div ref={ref} />));`);
  });

  test("forwardRef(memo(fn)) drops the inner memo", () => {
    // forwardRef+memo in this order is unusual but still gets stripped so
    // observer sees a plain render function.
    expect(
      run(
        `const Foo = forwardRef((props, ref) => <div ref={ref} />);
const Bar = forwardRef(memo(function Bar(props, ref) { return <div ref={ref} />; }));`,
      ),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(forwardRef((props, ref) => <div ref={ref} />));
const Bar = observer(forwardRef(function Bar(props, ref) {
  return <div ref={ref} />;
}));`);
  });

  test("memo+memo is collapsed", () => {
    expect(
      run(`const Foo = memo(memo((props) => <div>{props.x}</div>));`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(props => <div>{props.x}</div>);`);
  });

  test("memo(forwardRef(named)) export default", () => {
    expect(
      run(
        `export default memo(forwardRef((props, ref) => <div ref={ref} />));`,
      ),
    ).toBe(`import { observer } from "mobx-react-observer";
export default observer(forwardRef((props, ref) => <div ref={ref} />));`);
  });
});

describe("TypeScript overloads", () => {
  test("implementation-signature is wrapped; overload signatures are dropped", () => {
    const input = `function Foo(x: string): JSX.Element;
function Foo(x: number): JSX.Element;
function Foo(x: any): JSX.Element {
  return <div>{x}</div>;
}`;
    const out = run(input, { ts: true });
    expect(out).not.toMatch(/function Foo\(x: string\)/);
    expect(out).not.toMatch(/function Foo\(x: number\)/);
    expect(out).toMatch(/const Foo = observer\(function Foo\(x: any\)/);
    expect(out).toMatch(/from "mobx-react-observer"/);
  });

  test("exported overloads are also handled", () => {
    const input = `export function Foo(x: string): JSX.Element;
export function Foo(x: number): JSX.Element;
export function Foo(x: any): JSX.Element {
  return <div>{x}</div>;
}`;
    const out = run(input, { ts: true });
    expect(out).toMatch(/export const Foo = observer\(function Foo\(x: any\)/);
    expect(out).not.toMatch(/export function Foo\(x: string\)/);
    expect(out).not.toMatch(/export function Foo\(x: number\)/);
  });
});

describe("@no-observer opt-out pragma", () => {
  test("skips const arrow with leading line comment", () => {
    expect(
      run(`// @no-observer
const Foo = () => <div />;`),
    ).toBe(`// @no-observer
const Foo = () => <div />;`);
  });

  test("skips function declaration with leading line comment", () => {
    expect(
      run(`// @no-observer
function Foo() { return <div />; }`),
    ).toBe(`// @no-observer
function Foo() {
  return <div />;
}`);
  });

  test("skips export default with leading line comment", () => {
    expect(
      run(`// @no-observer
export default () => <div />;`),
    ).toBe(`// @no-observer
export default () => <div />;`);
  });

  test("skips export named function with leading line comment", () => {
    expect(
      run(`// @no-observer
export function Foo() { return <div />; }`),
    ).toBe(`// @no-observer
export function Foo() {
  return <div />;
}`);
  });

  test("supports block comment pragma", () => {
    expect(
      run(`/* @no-observer */
const Foo = () => <div />;`),
    ).toBe(`/* @no-observer */
const Foo = () => <div />;`);
  });

  test("inline block comment on the arrow expression still opts out", () => {
    const out = run(`const Foo = /* @no-observer */ () => <div />;`);
    expect(out).toContain("@no-observer");
    expect(out).not.toMatch(/observer\(/);
  });

  test("pragma on one statement does not leak to the next", () => {
    const out = run(`// @no-observer
const Foo = () => <div />;
const Bar = () => <div />;`);
    expect(out).toMatch(/const Foo = \(\) => <div \/>;/);
    expect(out).toMatch(/const Bar = observer\(\(\) => <div \/>\);/);
  });

  test("pragma skips memo + unknown HOC case too", () => {
    expect(
      run(
        `// @no-observer
const Component = memo(withSomeHOCSome(function Component() { return <div />; }));`,
      ),
    ).toBe(`// @no-observer
const Component = memo(withSomeHOCSome(function Component() {
  return <div />;
}));`);
  });
});

describe("memo around unknown HOCs", () => {
  test("memo(unknownHOC(fn)) drops memo, keeps unknown HOC, wraps observer outside", () => {
    expect(
      run(
        `const Component = memo(withSomeHOCSome(function Component() { return <div />; }));`,
      ),
    ).toBe(`import { observer } from "mobx-react-observer";
const Component = observer(withSomeHOCSome(function Component() {
  return <div />;
}));`);
  });

  test("unknownHOC(memo(fn)) drops inner memo, keeps unknown HOC, wraps observer outside", () => {
    expect(
      run(
        `const Component = withSomeHOCSome(memo(function Component() { return <div />; }));`,
      ),
    ).toBe(`import { observer } from "mobx-react-observer";
const Component = observer(withSomeHOCSome(function Component() {
  return <div />;
}));`);
  });

  test("export default memo(unknownHOC(fn)) drops memo without requiring uppercase variable", () => {
    expect(
      run(
        `export default memo(withSomeHOCSome(function Component() { return <div />; }));`,
      ),
    ).toBe(`import { observer } from "mobx-react-observer";
export default observer(withSomeHOCSome(function Component() {
  return <div />;
}));`);
  });

  test("memo(unknownA(unknownB(fn))) drops memo, keeps both unknowns", () => {
    expect(
      run(
        `const Component = memo(unknownA(unknownB(() => <div />)));`,
      ),
    ).toBe(`import { observer } from "mobx-react-observer";
const Component = observer(unknownA(unknownB(() => <div />)));`);
  });

  test("custom memo aliases via stripAsMemo are also stripped", () => {
    const src = `const Component = withMemo(withSomeHOCSome(function Component() { return <div />; }));`;
    const out = transformSync(src, {
      babelrc: false,
      configFile: false,
      filename: "test.tsx",
      plugins: [
        ["@babel/plugin-syntax-typescript", { isTSX: true }],
        createPlugin({
          importPath: "mobx-react-observer",
          stripAsMemo: ["withMemo"],
        }),
      ],
    })!.code!;
    expect(out).toContain(`observer(withSomeHOCSome(function Component()`);
    expect(out).not.toMatch(/withMemo\(/);
  });
});

describe("function expressions as HOC args", () => {
  test("wraps observer outside an unknown uppercase-named HOC result", () => {
    // For an unknown HOC, observer wraps the whole HOC call so that the
    // HOC sees a plain render function (and any observable reads inside
    // the function re-render via observer's outer subscription).
    expect(
      run(`const Foo = withSomething(function Foo() { return <div />; });`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(withSomething(function Foo() {
  return <div />;
}));`);
  });

  test("wraps observer outside forwardRef nested in unknown HOCs with uppercase name", () => {
    expect(
      run(`const Foo = withSomething(forwardRef((props, ref) => <div ref={ref} />));`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(withSomething(forwardRef((props, ref) => <div ref={ref} />)));`);
  });
});

describe("export default function", () => {
  test("converts export default function Foo() to export default observer(...)", () => {
    expect(
      run(`export default function Foo() { return <div />; }`),
    ).toBe(`import { observer } from "mobx-react-observer";
export default observer(function Foo() {
  return <div />;
});`);
  });
});
