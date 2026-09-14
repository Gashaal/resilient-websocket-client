# Resilient WebSocket Client

A small, framework-agnostic TypeScript WebSocket client with explicit lifecycle
control, bounded outgoing buffering, and predictable reconnect behavior.

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
the current attempt or retry, resets the retry limit, and opens a fresh socket
immediately.

## Options

| Option                | Default | Meaning                                               |
| --------------------- | ------: | ----------------------------------------------------- |
| `maxRetries`          |     `5` | Reconnect attempts after a failed connection sequence |
| `initialRetryDelayMs` |  `1000` | Base delay for the first retry                        |
| `maxRetryDelayMs`     | `30000` | Maximum delay after backoff and jitter                |
| `jitterRatio`         |   `0.2` | Random variation around each exponential delay        |
| `queueCapacity`       |   `100` | Maximum buffered outgoing messages                    |

When the queue is full, the oldest message is removed and a
`messageDropped` event is emitted. Retained messages are sent in FIFO order
when the connection opens.

Automatic retries occur only after an unexpected close or a synchronous
connection-construction failure. An `error` event alone is observable but does
not start another connection because browsers normally follow it with a close
event.

The client also emits `stateChange`, `open`, `message`, `close`, `error`,
`reconnectScheduled`, and `retryExhausted` events. The current lifecycle state
and queue size are available through `state` and `queuedMessageCount`.
