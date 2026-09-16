# Resilient WebSocket Client

A small, framework-agnostic TypeScript client for the browser WebSocket API.
It provides explicit lifecycle control, bounded outgoing buffering, and
configurable reconnect behavior without runtime dependencies.

## What it solves

The WebSocket API exposes transport events but leaves connection ownership,
retry timing, outgoing buffering, and obsolete-event handling to the caller.
This library keeps those concerns in one typed client while leaving message
encoding and application state to the consuming application.

## Usage

```ts
import { ResilientWebSocketClient, SendResult } from "resilient-websocket-client";

const client = new ResilientWebSocketClient({
  url: "wss://example.com/socket",
  maxRetries: 5,
  queueCapacity: 100,
});

const unsubscribe = client.on("message", (event) => {
  console.log(event.data);
});

client.on("messageDropped", ({ message }) => {
  console.warn("Outgoing queue was full:", message);
});

client.connect();
const result = client.send("hello");
if (result === SendResult.Queued) {
  console.log("Message will be sent when the connection opens");
}

unsubscribe();
```

Construction does not open a connection. Call `connect()` to start one.
Calling it again while connecting, open, or awaiting a retry has no effect.

`disconnect()` stops retries and closes the current socket. Buffered messages
are preserved for a later `connect()` or `reconnect()`. `reconnect()` cancels
the current attempt or retry, resets the retry budget, and opens a fresh socket
immediately.

## Options

| Option                |     Default | Meaning                                               |
| --------------------- | ----------: | ----------------------------------------------------- |
| `url`                 |  (required) | WebSocket URL                                         |
| `protocols`           | `undefined` | Subprotocol or ordered list of subprotocols           |
| `maxRetries`          |         `5` | Reconnect attempts after a failed connection sequence |
| `initialRetryDelayMs` |      `1000` | Base delay for the first retry                        |
| `maxRetryDelayMs`     |     `30000` | Maximum delay after backoff and jitter                |
| `jitterRatio`         |       `0.2` | Random variation around each exponential delay        |
| `queueCapacity`       |       `100` | Maximum buffered outgoing messages                    |

Numeric options are validated at construction: retry counts are non-negative
integers, delays are positive with the maximum at least the initial delay,
`jitterRatio` is between `0` and `1`, and queue capacity is a positive integer.

## Reconnect Exceptions

When the current socket closes, retries use capped exponential backoff with
configurable jitter. Synchronous WebSocket construction failures use the same
retry path. A socket `error` event is observable but does not independently
schedule a retry; the following `close` event normally does that.

Once a socket opens and its queued messages flush successfully, the retry
counter resets. `disconnect()` cancels the retry timer and prevents further
automatic attempts. `reconnect()` cancels any timer, invalidates the current
socket, resets the retry counter, and starts a new connection immediately.
Exhausting `maxRetries` moves the client to `closed` and emits
`retryExhausted`.

## Connection generations and lifecycle races

Each connection attempt receives a monotonically increasing generation. Event
handlers act only when both their generation and socket still match the active
connection, so late `open`, `message`, `error`, or `close` events from a
replaced socket cannot change state or schedule retries.

Generation checks also protect synchronous event-listener races. A listener
may call `disconnect()` or `reconnect()` during a state change; the interrupted
handler rechecks ownership before emitting later lifecycle events. Retry timers
are cleared on explicit lifecycle operations and verify generation and state
again before opening a socket.

The lifecycle is small and its transitions, ownership checks, and timer cleanup
fit in one class. A state-machine library would add another abstraction without
removing the generation and socket-identity checks required at WebSocket event
boundaries.

## Outgoing queue

`send()` writes immediately while the connection is open and otherwise adds the
message to a bounded queue. If the queue is full, the oldest message is removed
and reported through `messageDropped` with reason `queue-overflow`. Retained
messages flush in FIFO order when a connection opens.

Messages are removed only after `WebSocket.send()` succeeds. If flushing fails,
the failing message remains at the head of the queue for the next connection,
and an `error` event reports the `flush` operation. A direct send failure is
reported as a `send` error and rethrown rather than queued.

## Public API

The client exposes `connect()`, `disconnect()`, `reconnect()`, `send()`, and
typed `on()` subscriptions. It emits `stateChange`, `open`, `message`, `close`,
`error`, `reconnectScheduled`, `retryExhausted`, and `messageDropped` events.
The current lifecycle state and buffered message count are available through
`state` and `queuedMessageCount`.

## Testing

The Vitest suite replaces the browser API with an in-memory fake WebSocket and
uses fake timers and controlled randomness for deterministic retry assertions.
It covers lifecycle transitions, retry timing and exhaustion, construction and
send failures, queue overflow and FIFO flushing, stale socket events, timer
cancellation, and listeners that reconnect or disconnect during transitions.
No test opens a real network connection.

## Development

Install the locked development dependencies with `npm ci`.

| Command                 | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `npm run build`         | Compile ESM JavaScript, declarations, and maps    |
| `npm test`              | Type-check source and tests, then run Vitest once |
| `npm run type-check`    | Type-check production source without emitting     |
| `npm run lint`          | Check source with Oxlint                          |
| `npm run lint:fix`      | Apply Oxlint fixes                                |
| `npm run fmt:check`     | Check formatting with Oxfmt                       |
| `npm run fmt`           | Apply Oxfmt formatting                            |
| `npm run knip`          | Check unused files, exports, and dependencies     |
| `npm run static-checks` | Run type-check, lint, format check, and Knip      |
| `npm run prepack`       | Build the package before packing                  |

## License

This project is available under the [MIT License](./LICENSE).
