# mobx-react-observer

Automatic React observer for MobX.

Will wrap all components in your project (not libraries from `node_modules`) with `observer`, making observation completely transparent with MobX.

> This is a fork of [`christianalfoni/mobx-react-observer`](https://github.com/christianalfoni/mobx-react-observer) with fixes for `forwardRef`, `memo`, TypeScript function overloads and a rebuilt SWC plugin that works on Vite 7/8.

**BEFORE**

```tsx
import { observer } from "mobx-react-lite";
import { observable } from "mobx";

const counter = observable({
  count: 0,
  increase() {
    counter.count++;
  },
});

const Counter = observer(function Counter() {
  return (
    <button
      onClick={() => {
        counter.increase();
      }}
    >
      Count {counter.count}
    </button>
  );
});
```

**AFTER**

```tsx
import { observable } from "mobx";

const counter = observable({
  count: 0,
  increase() {
    counter.count++;
  },
});

function Counter() {
  return (
    <button
      onClick={() => {
        counter.increase();
      }}
    >
      Count {counter.count}
    </button>
  );
}
```

Other benefits:

- You can now export functions as normal and they show up with the correct name in React Devtools
- When exporting with `export const Comp = observer()` VSCode will read that as two definitions of the component, affecting "jump to definition". Now there is only one definition for every component
- Instead of having multiple ways to observe, just create smaller components to optimize rendering

Read more about automatic observation in [observing-components](https://github.com/christianalfoni/observing-components).

## Install

```sh
npm install mobx-react-observer
```

## SSR

If you do **server side rendering** (SSR), the plugins will still work, but as always you should use `enableStaticRendering`:

**App.tsx**

```ts
import { enableStaticRendering } from "mobx-react-observer";

enableStaticRendering(typeof window === "undefined");
```

## Configure

**Babel plugin example**

```ts
import observerPlugin from "mobx-react-observer/babel-plugin";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          observerPlugin(
            // optional
            { exclude: ["src/ui-components/**"] }
          ),
        ],
      },
    }),
  ],
});
```

**SWC plugin example**

```ts
import observerPlugin from "mobx-react-observer/swc-plugin";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [
    react({
      plugins: [
        observerPlugin(
          // optional
          { exclude: ["src/ui-components/**"] }
        ),
      ],
    }),
  ],
});
```

## What this fork fixes

### `forwardRef` components

The upstream plugins would wrap the inner render function instead of the outer `forwardRef(...)`, which broke ref forwarding because `observer` from `mobx-react-lite` expects a plain function component, not a `(props, ref) => …` render function.

This fork always wraps `observer` on the outside of `forwardRef`:

```tsx
// Source
const Field = forwardRef((props, ref) => <input ref={ref} {...props} />);
// After transform
const Field = observer(forwardRef((props, ref) => <input ref={ref} {...props} />));

// Named function expressions work the same way
const Field2 = forwardRef(function Field2(props, ref) { … });
// After transform
const Field2 = observer(forwardRef(function Field2(props, ref) { … }));
```

`React.forwardRef` is handled identically, as is `export default forwardRef(...)`.

### `memo` is always dropped

`observer` from `mobx-react-lite` already memoises, and more importantly it **cannot be applied on top of a memo() result**: observer calls the base as a render function, but a `memo(...)` return value is a React memo object (`$$typeof === react.memo`), not a function. This is also the reason upstream's `observer(memo(X))` silently broke at render time.

This fork removes every `memo(...)` / `React.memo(...)` wrapper encountered around a component:

```tsx
// Source                                     // After transform
const A = memo(() => <div />);                const A = observer(() => <div />);
const B = memo(function B() { … });           const B = observer(function B() { … });
const C = React.memo(() => <div />);          const C = observer(() => <div />);
const D = memo(forwardRef((p, ref) => …));    const D = observer(forwardRef((p, ref) => …));
const E = forwardRef(memo(fn));               const E = observer(forwardRef(fn));
const F = customHOC(memo(fn));                const F = observer(customHOC(fn));
```

The stripping is recursive: nested memo layers anywhere in the expression tree are removed, then the outermost chain is wrapped with `observer`. Components already wrapped in `observer(...)` are left alone, but any `memo(...)` that shows up inside them is still stripped.

### TypeScript function overloads

Previously, a component written with overload signatures would be transformed into a program where the overload signatures and the generated `const` redeclared the same name, which broke both type-checking and runtime:

```ts
function Foo(x: string): JSX.Element;
function Foo(x: number): JSX.Element;
function Foo(x: any): JSX.Element {
  return <div>{x}</div>;
}
```

The fork detects the preceding `TSDeclareFunction` overload siblings and drops them when rewriting the implementation into `const Foo = observer(function Foo(...) { … })` (the source code still type-checks against the original overloads; Babel-emitted JS is what is cleaned up). Exported overloads are handled as well (`export function …`). The SWC pipeline was already strip-types-first, but a test is included to make the behavior explicit.

### SWC plugin no longer crashes on Vite 8

Upstream's `swc-plugin-observing-components` was compiled against `swc_core` 13, which is ABI-incompatible with the `@swc/core` shipped by `@vitejs/plugin-react-swc` 4.x (Vite 7 and Vite 8). This fork rebuilds the wasm against `swc_core` 64.0.0 and ships it directly inside the package at `mobx-react-observer/wasm/observer.wasm`, so the SWC plugin works out-of-the-box on current Vite.

The `swc-plugin` entry resolves to that bundled wasm at runtime, so there is no separate `swc-plugin-observing-components` dependency anymore.

## Development

```sh
npm install
npm test          # babel transform tests + swc wasm integration tests
npm run build     # emits dist/esm + dist/cjs
```

The Rust sources for the SWC plugin live in `swc/` and are built with:

```sh
cd swc
cargo build --release -p swc_plugin_observing_components --target wasm32-wasip1
cp target/wasm32-wasip1/release/swc_plugin_observing_components.wasm ../wasm/observer.wasm
```
