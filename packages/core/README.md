# @open-adventure/core

Platform-agnostic game engine for Open Adventure — a JavaScript/TypeScript port of [Open Adventure](https://gitlab.com/esr/open-adventure), itself a forward-port of Colossal Cave Adventure 2.5 (Crowther & Woods, 1995).

This package contains the engine only: zero `node:*` imports, no I/O, no terminal handling. It is consumed by [`@open-adventure/cli`](https://www.npmjs.com/package/@open-adventure/cli) for terminal play and can also be embedded directly in browser hosts.

## Install

```bash
npm install @open-adventure/core
```

## Usage

The package exports a host-driven `runGame()` entry point along with factories and pure save helpers (`serializeGame`, `deserializeGame`, `summarizeSave`). See the [project README](https://github.com/gtritchie/open-adventure-ts#readme) for usage examples, including a browser hosting walkthrough.

## License

[BSD 2-Clause](./LICENSE). This project is a JavaScript port of Open Adventure (originally in C), licensed under the BSD 2-Clause License.
