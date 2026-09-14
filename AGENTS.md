# Repository Guidelines

## Project Purpose

This repository contains a small, framework-agnostic TypeScript WebSocket
client intended as a focused engineering sample.

The project should demonstrate clear API design, predictable connection
lifecycle, resilience to network failures, careful handling of asynchronous
race conditions, strong typing, and deterministic testing.

Keep the project deliberately small. Prefer explicit, readable solutions over
abstractions that are not justified by current requirements.

## Clean-room Requirement

This project must be implemented independently.

Do not copy, adapt, translate, or mechanically rewrite proprietary code from
any current or previous employer. Do not introduce employer-specific APIs,
event names, configuration values, tests, comments, business logic, or
documentation.

Implement functionality only from the generic requirements documented in this
repository and publicly available Web Platform behavior.

## Project Structure

Keep the public entry point small.

Suggested structure:

src/
websocket-client.ts
types.ts
index.ts

test/
websocket-client.test.ts

Place implementation under `src/` and tests under `test/`.

## Scope

The client should support:

- WebSocket connection and manual disconnect;
- manual reconnect;
- automatic reconnect after unexpected disconnect;
- exponential backoff with jitter;
- configurable retry limits;
- bounded FIFO outgoing message queue;
- observable dropped-message behavior;
- protection against events from obsolete WebSocket instances;
- typed events;
- inspection of connection state.

Use the standard browser WebSocket API.

## Non-goals

Do not add unless explicitly requested:

- React/Vue integrations;
- Redux, Reatom, RxJS, or other state-management layers;
- authentication;
- persistence;
- heartbeat protocols;
- automatic JSON parsing;
- schema validation;
- state-machine libraries;
- plugin systems;
- demo applications;
- UI components.

Prefer zero runtime dependencies.

## Build, Test, and Development Commands

- `npm install` installs dependencies and creates or updates the lockfile.
- `npm test` builds the package and runs the complete Node test suite.
- `npm run build` compiles TypeScript sources and declarations into `dist/`.
- `node index.js` runs the package entry point once it exists and is useful for basic local smoke checks.
- `npm pack --dry-run` previews the files that would be published without creating a release.

There is currently no lint, formatting, or development-server command. Add project scripts to `package.json` before relying on new tooling, and document them here.

## Coding Style & Naming Conventions

Use CommonJS modules (`require` and `module.exports`) to match the package's `"type": "commonjs"`. Follow the style of surrounding code; until automated formatting is configured, use two-space indentation, semicolons, single quotes, and trailing commas in multiline structures. Name files with lowercase kebab-case, variables and functions with `camelCase`, and constructors or classes with `PascalCase`. Keep the exported API narrow and separate connection, retry, and event-handling concerns into focused modules.

## Testing Guidelines

Add tests with every behavior change, especially for reconnection timing, retry limits, message ordering, clean shutdown, and error propagation. Name tests `*.test.js` and avoid real network dependencies where deterministic fake WebSocket implementations or timers suffice. Once a framework is selected, ensure `npm test` runs the complete suite and exits nonzero on failure. No coverage threshold is configured yet; new core logic should include success, failure, and boundary cases.

## Commit & Pull Request Guidelines

The history currently contains only `Initial commit`, so no established convention exists. Use short, imperative subjects such as `Add exponential reconnect backoff`, and keep each commit focused. Pull requests should explain the behavior and motivation, list verification commands and results, and link relevant issues. Include logs or concise reproduction steps for protocol and timing bugs; screenshots are only useful for changes that introduce visual documentation or demos.
