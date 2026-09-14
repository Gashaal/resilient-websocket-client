import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  ConnectionState,
  ErrorOperation,
  ResilientWebSocketClient,
  SendResult,
} from "../src/index.js";
import type {
  MessageDroppedEvent,
  OutgoingMessage,
  ReconnectScheduledEvent,
  RetryExhaustedEvent,
  WebSocketClientErrorEvent,
  WebSocketClientOptions,
} from "../src/index.js";

type FakeEventListener = (event: Event) => void;

interface CloseCall {
  code: number | undefined;
  reason: string | undefined;
}

class FakeWebSocket {
  public static instances: FakeWebSocket[] = [];
  public static constructionErrors: unknown[] = [];

  public readonly url: string;
  public readonly protocols: string | string[] | undefined;
  public readyState = 0;
  public readonly sent: OutgoingMessage[] = [];
  public readonly closeCalls: CloseCall[] = [];
  public sendError: unknown | null = null;

  private readonly listeners = new Map<string, FakeEventListener[]>();

  public constructor(url: string, protocols?: string | string[]) {
    const constructionError = FakeWebSocket.constructionErrors.shift();
    if (constructionError !== undefined) {
      throw constructionError;
    }

    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  public addEventListener(eventName: string, listener: FakeEventListener): void {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  public send(message: OutgoingMessage): void {
    if (this.sendError !== null) {
      throw this.sendError;
    }

    this.sent.push(message);
  }

  public close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 2;
  }

  public open(): void {
    this.readyState = 1;
    this.emit("open", new Event("open"));
  }

  public receive(data: unknown): void {
    this.emit("message", new MessageEvent("message", { data }));
  }

  public fail(error: Event = new Event("error")): void {
    this.emit("error", error);
  }

  public serverClose(code = 1006, reason = "", wasClean = false): void {
    this.readyState = 3;
    this.emit("close", new CloseEvent("close", { code, reason, wasClean }));
  }

  private emit(eventName: string, event: Event): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(event);
    }
  }
}

function getSocket(index: number): FakeWebSocket {
  const socket = FakeWebSocket.instances[index];
  if (socket === undefined) {
    throw new Error(`Expected WebSocket instance at index ${index}`);
  }

  return socket;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeWebSocket.constructionErrors = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("starts explicitly and exposes typed lifecycle events", () => {
  const client = new ResilientWebSocketClient({ url: "wss://example.test" });
  const states: ConnectionState[] = [];
  const messages: unknown[] = [];
  let openCount = 0;

  client.on("stateChange", ({ state }) => states.push(state));
  const unsubscribe = client.on("message", ({ data }) => messages.push(data));
  client.on("open", () => (openCount += 1));

  expect(client.state).toBe(ConnectionState.Idle);
  expect(FakeWebSocket.instances).toHaveLength(0);

  client.connect();
  client.connect();
  const socket = getSocket(0);

  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(client.state).toBe(ConnectionState.Connecting);

  socket.open();
  socket.receive("first");
  unsubscribe();
  unsubscribe();
  socket.receive("ignored");

  expect(client.state).toBe(ConnectionState.Open);
  expect(openCount).toBe(1);
  expect(states).toEqual([ConnectionState.Connecting, ConnectionState.Open]);
  expect(messages).toEqual(["first"]);
});

test("drops the oldest queued message and flushes retained messages in FIFO order", () => {
  const client = new ResilientWebSocketClient({
    url: "wss://example.test",
    queueCapacity: 2,
  });
  const dropped: MessageDroppedEvent[] = [];

  client.on("messageDropped", (event) => dropped.push(event));
  expect(client.send("first")).toBe(SendResult.Queued);
  expect(client.send("second")).toBe(SendResult.Queued);
  expect(client.send("third")).toBe(SendResult.Queued);
  expect(client.queuedMessageCount).toBe(2);

  client.connect();
  const socket = getSocket(0);
  client.on("open", () => client.send("after-open"));
  socket.open();

  expect(dropped).toEqual([{ message: "first", reason: "queue-overflow" }]);
  expect(socket.sent).toEqual(["second", "third", "after-open"]);
  expect(client.queuedMessageCount).toBe(0);
});

test("manual disconnect stops retries and preserves the queue", () => {
  vi.useFakeTimers();
  const client = new ResilientWebSocketClient({
    url: "wss://example.test",
    initialRetryDelayMs: 10,
    jitterRatio: 0,
  });

  client.connect();
  const oldSocket = getSocket(0);
  client.send("preserved");
  client.disconnect(1000, "finished");
  oldSocket.serverClose();
  vi.advanceTimersByTime(100);

  expect(client.state).toBe(ConnectionState.Closed);
  expect(client.queuedMessageCount).toBe(1);
  expect(oldSocket.closeCalls).toEqual([{ code: 1000, reason: "finished" }]);
  expect(FakeWebSocket.instances).toHaveLength(1);

  client.connect();
  const newSocket = getSocket(1);
  newSocket.open();
  expect(newSocket.sent).toEqual(["preserved"]);
});

test("manual reconnect replaces the socket and ignores all stale events", () => {
  const client = new ResilientWebSocketClient({ url: "wss://example.test" });
  const messages: unknown[] = [];
  let closeCount = 0;

  client.on("message", ({ data }) => messages.push(data));
  client.on("close", () => (closeCount += 1));
  client.connect();
  const oldSocket = getSocket(0);

  client.reconnect();
  const newSocket = getSocket(1);
  oldSocket.open();
  oldSocket.receive("stale");
  oldSocket.fail();
  oldSocket.serverClose();
  newSocket.open();
  newSocket.receive("current");

  expect(oldSocket.closeCalls).toEqual([{ code: 1000, reason: "Client reconnect" }]);
  expect(client.state).toBe(ConnectionState.Open);
  expect(messages).toEqual(["current"]);
  expect(closeCount).toBe(0);
});

test("uses exponential backoff with jitter and caps the final delay", () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.75);
  const client = new ResilientWebSocketClient({
    url: "wss://example.test",
    initialRetryDelayMs: 100,
    maxRetryDelayMs: 150,
    jitterRatio: 0.2,
  });
  const retries: ReconnectScheduledEvent[] = [];
  client.on("reconnectScheduled", (event) => retries.push(event));

  client.connect();
  getSocket(0).serverClose();
  expect(retries).toEqual([{ attempt: 1, delayMs: 110 }]);

  vi.advanceTimersByTime(110);
  getSocket(1).serverClose();
  expect(retries).toEqual([
    { attempt: 1, delayMs: 110 },
    { attempt: 2, delayMs: 150 },
  ]);

  vi.advanceTimersByTime(150);
  expect(FakeWebSocket.instances).toHaveLength(3);
});

test("stops after the configured number of retries", () => {
  vi.useFakeTimers();
  const client = new ResilientWebSocketClient({
    url: "wss://example.test",
    maxRetries: 2,
    initialRetryDelayMs: 10,
    jitterRatio: 0,
  });
  const exhausted: RetryExhaustedEvent[] = [];
  client.on("retryExhausted", (event) => exhausted.push(event));

  client.connect();
  getSocket(0).serverClose();
  vi.advanceTimersByTime(10);
  getSocket(1).serverClose();
  vi.advanceTimersByTime(20);
  getSocket(2).serverClose();
  vi.advanceTimersByTime(1_000);

  expect(client.state).toBe(ConnectionState.Closed);
  expect(FakeWebSocket.instances).toHaveLength(3);
  expect(exhausted).toEqual([{ attempts: 2 }]);
});

test("a state listener can cancel a prepared reconnect timer", () => {
  vi.useFakeTimers();
  const client = new ResilientWebSocketClient({
    url: "wss://example.test",
    initialRetryDelayMs: 10,
    jitterRatio: 0,
  });
  const scheduled: ReconnectScheduledEvent[] = [];
  let closeCount = 0;

  client.on("stateChange", ({ state }) => {
    if (state === ConnectionState.WaitingToReconnect) {
      client.disconnect();
    }
  });
  client.on("reconnectScheduled", (event) => scheduled.push(event));
  client.on("close", () => (closeCount += 1));

  client.connect();
  getSocket(0).serverClose();
  vi.advanceTimersByTime(100);

  expect(client.state).toBe(ConnectionState.Closed);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(scheduled).toEqual([]);
  expect(closeCount).toBe(0);
});

test("an open-state listener can replace the socket without a stale open event", () => {
  const client = new ResilientWebSocketClient({ url: "wss://example.test" });
  let openCount = 0;

  client.on("stateChange", ({ state }) => {
    if (state === ConnectionState.Open) {
      client.reconnect();
    }
  });
  client.on("open", () => (openCount += 1));

  client.connect();
  getSocket(0).open();

  expect(FakeWebSocket.instances).toHaveLength(2);
  expect(client.state).toBe(ConnectionState.Connecting);
  expect(openCount).toBe(0);
});

test("retries synchronous WebSocket construction failures", () => {
  vi.useFakeTimers();
  FakeWebSocket.constructionErrors = [new Error("constructor failed")];
  const client = new ResilientWebSocketClient({
    url: "wss://example.test",
    initialRetryDelayMs: 10,
    jitterRatio: 0,
  });
  const errors: WebSocketClientErrorEvent[] = [];
  client.on("error", (event) => errors.push(event));

  client.connect();
  expect(client.state).toBe(ConnectionState.WaitingToReconnect);
  expect(FakeWebSocket.instances).toHaveLength(0);
  expect(errors[0]?.operation).toBe(ErrorOperation.Connect);

  vi.advanceTimersByTime(10);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(client.state).toBe(ConnectionState.Connecting);
});

test("reports and rethrows direct send failures without queueing", () => {
  const client = new ResilientWebSocketClient({ url: "wss://example.test" });
  const errors: WebSocketClientErrorEvent[] = [];
  client.on("error", (event) => errors.push(event));
  client.connect();
  const socket = getSocket(0);
  socket.open();
  socket.sendError = new Error("send failed");

  expect(() => client.send("message")).toThrow(/send failed/);
  expect(client.queuedMessageCount).toBe(0);
  expect(errors[0]?.operation).toBe(ErrorOperation.Send);
});

test("retains the queue head and reconnects after a flush failure", () => {
  vi.useFakeTimers();
  const client = new ResilientWebSocketClient({
    url: "wss://example.test",
    initialRetryDelayMs: 10,
    jitterRatio: 0,
  });
  const errors: WebSocketClientErrorEvent[] = [];
  client.on("error", (event) => errors.push(event));
  client.send("first");
  client.send("second");
  client.connect();

  const failedSocket = getSocket(0);
  failedSocket.sendError = new Error("flush failed");
  failedSocket.open();
  expect(client.queuedMessageCount).toBe(2);
  expect(errors[0]?.operation).toBe(ErrorOperation.Flush);
  expect(failedSocket.closeCalls).toEqual([{ code: undefined, reason: undefined }]);

  failedSocket.serverClose();
  vi.advanceTimersByTime(10);
  const recoveredSocket = getSocket(1);
  recoveredSocket.open();
  expect(recoveredSocket.sent).toEqual(["first", "second"]);
});

test("emits socket errors without starting a retry before close", () => {
  vi.useFakeTimers();
  const client = new ResilientWebSocketClient({
    url: "wss://example.test",
    initialRetryDelayMs: 10,
    jitterRatio: 0,
  });
  const errors: WebSocketClientErrorEvent[] = [];
  client.on("error", (event) => errors.push(event));
  client.connect();
  const socket = getSocket(0);

  socket.fail();
  vi.advanceTimersByTime(100);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(errors[0]?.operation).toBe(ErrorOperation.Socket);

  socket.serverClose();
  vi.advanceTimersByTime(10);
  expect(FakeWebSocket.instances).toHaveLength(2);
});

test("validates configuration boundaries", () => {
  const create = (options: Omit<WebSocketClientOptions, "url">) =>
    new ResilientWebSocketClient({
      url: "wss://example.test",
      ...options,
    });

  expect(() => create({ maxRetries: -1 })).toThrow(/maxRetries/);
  expect(() => create({ maxRetries: 1.5 })).toThrow(/maxRetries/);
  expect(() => create({ initialRetryDelayMs: 0 })).toThrow(/initialRetryDelayMs/);
  expect(() =>
    create({
      initialRetryDelayMs: 20,
      maxRetryDelayMs: 10,
    }),
  ).toThrow(/maxRetryDelayMs/);
  expect(() => create({ jitterRatio: 1.1 })).toThrow(/jitterRatio/);
  expect(() => create({ queueCapacity: 0 })).toThrow(/queueCapacity/);
});
