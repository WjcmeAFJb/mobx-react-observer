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

describe("memo", () => {
  test("observer wraps memo from the outside", () => {
    expect(
      run(`const Foo = memo((props) => <div>{props.x}</div>);`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(memo(props => <div>{props.x}</div>));`);
  });

  test("observer wraps memo+forwardRef combination from the outside", () => {
    expect(
      run(`const Foo = memo(forwardRef((props, ref) => <div ref={ref} />));`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(memo(forwardRef((props, ref) => <div ref={ref} />)));`);
  });

  test("observer wraps React.memo", () => {
    expect(
      run(`const Foo = React.memo((props) => <div>{props.x}</div>);`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = observer(React.memo(props => <div>{props.x}</div>));`);
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

describe("function expressions as HOC args", () => {
  test("wraps function expression inside a custom uppercase-named HOC result", () => {
    expect(
      run(`const Foo = withSomething(function Foo() { return <div />; });`),
    ).toBe(`import { observer } from "mobx-react-observer";
const Foo = withSomething(observer(function Foo() {
  return <div />;
}));`);
  });

  test("function expression inside forwardRef without a variable declarator still gets observed", () => {
    expect(
      run(`something(forwardRef((props, ref) => <div ref={ref} />));`),
    ).toBe(`import { observer } from "mobx-react-observer";
something(observer(forwardRef((props, ref) => <div ref={ref} />)));`);
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
