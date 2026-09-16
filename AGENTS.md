# Repository Guidelines

## Project Purpose

This repository is a small, framework-agnostic TypeScript WebSocket client and
focused engineering sample. It should demonstrate a clear public API,
predictable connection lifecycle, resilient reconnect behavior, careful async
race handling, strong types, and deterministic tests. Keep solutions explicit
and avoid abstractions not justified by current requirements.

## Clean-Room Requirement

Implement the project independently. Do not copy, adapt, translate, or
mechanically rewrite proprietary code from any current or previous employer.
Do not introduce employer-specific APIs, event names, configuration, tests,
comments, business logic, or documentation. Rely only on this repository's
generic requirements and publicly available Web Platform behavior.

## Project Structure and Modules

- `src/websocket-client.ts` contains connection, retry, queue, and event logic.
- `src/types.ts` defines public options, states, results, and typed events.
- `src/index.ts` is the narrow TypeScript export surface.
- `test/websocket-client.test.ts` contains deterministic Vitest tests and the
  fake WebSocket implementation.
- `package.json` defines the ESM package entry points and npm scripts.
- `.github/workflows/ci.yml` runs checks, tests, and the build on Node.js 24.
- `dist/index.js` and `dist/index.d.ts` are the generated JavaScript and type
  entry points. The build also emits JavaScript, declarations, and source maps
  for the other source modules.
- `tsconfig.json` builds source; `tsconfig.test.json` also type-checks tests.
- `knip.json` configures unused-code and dependency checks.

The package is ESM-only and uses NodeNext module resolution. Include `.js` in
relative import specifiers in both source and tests so emitted ESM resolves
correctly. Put TypeScript implementation in `src/`, Vitest tests in `test/`,
and generated output in `dist/`. The `dist/` directory and TypeScript build
metadata are ignored; do not edit or commit generated artifacts.

## Scope and Non-Goals

Maintain explicit connect, disconnect, and reconnect operations; automatic
retries with capped exponential backoff and jitter; configurable retry limits;
a bounded FIFO send queue with observable drops; typed events and inspectable
state; and guards against obsolete socket events. Use the browser WebSocket
API and prefer zero runtime dependencies.

Unless explicitly requested, do not add framework integrations, state
management, authentication, persistence, heartbeats, JSON parsing, schema
validation, state-machine libraries, plugins, demos, or UI components.

## Build, Test, and Development Commands

- `npm ci`: install the exact dependency versions from `package-lock.json`, as
  CI does.
- `npm run build`: compile `src/**/*.ts` to ESM JavaScript, declarations,
  declaration maps, and source maps in `dist/`.
- `npm test`: type-check source and tests without emitting, then run Vitest once.
- `npm run type-check`: type-check only production source without emitting.
- `npm run lint` / `npm run lint:fix`: check or fix code with Oxlint.
- `npm run fmt:check` / `npm run fmt`: check or apply Oxfmt formatting.
- `npm run knip`: report unused files, exports, and dependencies.
- `npm run static-checks`: run type-check, lint, format check, and Knip.
- `npm run prepack`: run the production build used before package creation.
- `npm pack --dry-run`: build via `prepack` and inspect publish contents.

There is no watch mode or development server.

CI runs `npm ci`, `npm run static-checks`, `npm test`, and `npm run build` on
pull requests targeting `main`.

## Coding Style and Naming

Follow Oxfmt: two-space indentation, semicolons, double quotes, and trailing
commas in multiline constructs. Use strict TypeScript and preserve the checks
enabled in `tsconfig.json`. Name files in lowercase kebab-case, variables and
functions in `camelCase`, and classes, enums, and types in `PascalCase`. Keep
the public exports narrow and use `import type` for type-only imports. Oxlint
and Oxfmt currently use their defaults; there are no separate configuration
files for either tool.

## Testing Guidelines

Write Vitest tests as `test/*.test.ts`; do not use real network connections.
Use fake WebSockets and `vi.useFakeTimers()` for deterministic lifecycle and
retry behavior. Every behavior change should cover success, failure, and
relevant boundaries, especially retry timing and limits, timer cleanup, stale
events, queue capacity and FIFO order, message retention, manual shutdown, and
error propagation. Vitest currently runs without a separate configuration file,
and no coverage threshold is configured. Run `npm test` and
`npm run static-checks` before submitting.

## Commit and Pull Request Guidelines

History is short and uses concise, imperative-style subjects. Keep commits
focused; for example, `Add exponential reconnect backoff`. Pull requests should
explain behavior and motivation, link relevant issues, and list verification
commands and results. Include concise reproduction steps or logs for timing and
protocol bugs. Screenshots are only relevant if visual documentation is added.
