import { ConnectionState, ErrorOperation, SendResult } from "./types.js";
import type {
  OutgoingMessage,
  WebSocketClientEventListener,
  WebSocketClientEventMap,
  WebSocketClientEventName,
  WebSocketClientOptions,
} from "./types.js";

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_JITTER_RATIO = 0.2;
const DEFAULT_QUEUE_CAPACITY = 100;

type StoredListener = (event: unknown) => void;

export class ResilientWebSocketClient {
  private readonly url: string;
  private readonly protocols: string | string[] | undefined;
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly jitterRatio: number;
  private readonly queueCapacity: number;

  private currentState = ConnectionState.Idle;
  private socket: WebSocket | null = null;
  private socketGeneration = 0;
  private retryAttempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly outgoingQueue: OutgoingMessage[] = [];
  private readonly listeners = new Map<WebSocketClientEventName, Set<StoredListener>>();

  public constructor(options: WebSocketClientOptions) {
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const initialRetryDelayMs = options.initialRetryDelayMs ?? DEFAULT_INITIAL_RETRY_DELAY_MS;
    const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
    const queueCapacity = options.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;

    this.validateOptions({
      maxRetries,
      initialRetryDelayMs,
      maxRetryDelayMs,
      jitterRatio,
      queueCapacity,
    });

    this.url = options.url;
    this.protocols = options.protocols;
    this.maxRetries = maxRetries;
    this.initialRetryDelayMs = initialRetryDelayMs;
    this.maxRetryDelayMs = maxRetryDelayMs;
    this.jitterRatio = jitterRatio;
    this.queueCapacity = queueCapacity;
  }

  public get state(): ConnectionState {
    return this.currentState;
  }

  public get queuedMessageCount(): number {
    return this.outgoingQueue.length;
  }

  public connect(): void {
    if (
      this.currentState === ConnectionState.Connecting ||
      this.currentState === ConnectionState.Open ||
      this.currentState === ConnectionState.WaitingToReconnect
    ) {
      return;
    }

    this.retryAttempts = 0;
    this.startConnection();
  }

  public disconnect(code = 1000, reason?: string): void {
    this.clearRetryTimer();
    this.retryAttempts = 0;
    this.socketGeneration += 1;

    const socket = this.socket;
    this.socket = null;
    this.changeState(ConnectionState.Closed);

    if (socket === null) {
      return;
    }

    try {
      socket.close(code, reason);
    } catch (error) {
      try {
        socket.close();
      } catch {
        // The original close failure contains the caller's invalid input.
      }
      this.emit("error", { operation: ErrorOperation.Socket, error });
      throw error;
    }
  }

  public reconnect(): void {
    this.clearRetryTimer();
    this.retryAttempts = 0;
    this.socketGeneration += 1;

    const socket = this.socket;
    this.socket = null;

    if (socket !== null) {
      try {
        socket.close(1000, "Client reconnect");
      } catch (error) {
        this.emit("error", { operation: ErrorOperation.Socket, error });
      }
    }

    this.startConnection();
  }

  public send(message: OutgoingMessage): SendResult {
    if (this.currentState === ConnectionState.Open && this.socket !== null) {
      try {
        this.socket.send(message);
        return SendResult.Sent;
      } catch (error) {
        this.emit("error", { operation: ErrorOperation.Send, error });
        throw error;
      }
    }

    const droppedMessage =
      this.outgoingQueue.length === this.queueCapacity ? this.outgoingQueue.shift() : undefined;

    this.outgoingQueue.push(message);

    if (droppedMessage !== undefined) {
      this.emit("messageDropped", {
        message: droppedMessage,
        reason: "queue-overflow",
      });
    }

    return SendResult.Queued;
  }

  public on<EventName extends WebSocketClientEventName>(
    eventName: EventName,
    listener: WebSocketClientEventListener<EventName>,
  ): () => void {
    let eventListeners = this.listeners.get(eventName);
    if (eventListeners === undefined) {
      eventListeners = new Set<StoredListener>();
      this.listeners.set(eventName, eventListeners);
    }

    const storedListener: StoredListener = (event) => {
      listener(event as WebSocketClientEventMap[EventName]);
    };
    eventListeners.add(storedListener);

    return () => {
      eventListeners.delete(storedListener);
      if (eventListeners.size === 0) {
        this.listeners.delete(eventName);
      }
    };
  }

  private startConnection(): void {
    this.clearRetryTimer();
    const generation = this.socketGeneration + 1;
    this.socketGeneration = generation;

    let socket: WebSocket; // socket A !== null и ждет open
    try {
      socket =
        this.protocols === undefined
          ? new WebSocket(this.url)
          : new WebSocket(this.url, this.protocols);
    } catch (error) {
      this.handleConnectionFailure(generation, error);
      return;
    }

    this.socket = socket;
    socket.addEventListener("open", (event) => {
      this.handleOpen(generation, socket, event);
    });
    socket.addEventListener("message", (event) => {
      if (this.isCurrentSocket(generation, socket)) {
        this.emit("message", event);
      }
    });
    socket.addEventListener("error", (event) => {
      if (this.isCurrentSocket(generation, socket)) {
        this.emit("error", { operation: ErrorOperation.Socket, error: event });
      }
    });
    socket.addEventListener("close", (event) => {
      this.handleClose(generation, socket, event);
    });

    this.changeState(ConnectionState.Connecting);
  }

  private handleOpen(generation: number, socket: WebSocket, event: Event): void {
    if (!this.isCurrentSocket(generation, socket)) {
      return;
    }

    try {
      while (this.outgoingQueue.length > 0) {
        const message = this.outgoingQueue[0];
        if (message === undefined) {
          break;
        }

        socket.send(message);
        this.outgoingQueue.shift();
      }
    } catch (error) {
      try {
        socket.close();
      } catch {
        // The original send failure is the actionable error.
      }
      this.emit("error", { operation: ErrorOperation.Flush, error });
      return;
    }

    this.retryAttempts = 0;
    this.changeState(ConnectionState.Open);

    if (!this.isCurrentSocket(generation, socket)) {
      return;
    }

    this.emit("open", event);
  }

  private handleClose(generation: number, socket: WebSocket, event: CloseEvent): void {
    if (!this.isCurrentSocket(generation, socket)) {
      return;
    }

    this.socket = null;
    const retry = this.prepareRetry(generation);

    if (generation !== this.socketGeneration) {
      return;
    }

    this.emit("close", event);
    if (retry === null) {
      if (generation === this.socketGeneration && this.currentState === ConnectionState.Closed) {
        this.emit("retryExhausted", { attempts: this.retryAttempts });
      }
      return;
    }

    if (
      generation === this.socketGeneration &&
      this.currentState === ConnectionState.WaitingToReconnect
    ) {
      this.emit("reconnectScheduled", retry);
    }
  }

  private handleConnectionFailure(generation: number, error: unknown): void {
    if (generation !== this.socketGeneration) {
      return;
    }

    const retry = this.prepareRetry(generation);

    if (generation !== this.socketGeneration) {
      return;
    }

    this.emit("error", { operation: ErrorOperation.Connect, error });

    if (retry === null) {
      if (generation === this.socketGeneration && this.currentState === ConnectionState.Closed) {
        this.emit("retryExhausted", { attempts: this.retryAttempts });
      }
      return;
    }

    if (
      generation === this.socketGeneration &&
      this.currentState === ConnectionState.WaitingToReconnect
    ) {
      this.emit("reconnectScheduled", retry);
    }
  }

  private prepareRetry(generation: number): { attempt: number; delayMs: number } | null {
    if (this.retryAttempts >= this.maxRetries) {
      this.clearRetryTimer();
      this.changeState(ConnectionState.Closed);
      return null;
    }

    this.retryAttempts += 1;
    const attempt = this.retryAttempts;
    const delayMs = this.calculateRetryDelay(attempt);

    this.retryTimer = setTimeout(() => {
      if (
        generation !== this.socketGeneration ||
        this.currentState !== ConnectionState.WaitingToReconnect
      ) {
        return;
      }

      this.retryTimer = null;
      this.startConnection();
    }, delayMs);
    this.changeState(ConnectionState.WaitingToReconnect);

    return { attempt, delayMs };
  }

  private calculateRetryDelay(attempt: number): number {
    const exponentialDelay = this.initialRetryDelayMs * 2 ** (attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, this.maxRetryDelayMs);
    const minimumFactor = 1 - this.jitterRatio;
    const jitterRange = this.jitterRatio * 2;
    const jitteredDelay = cappedDelay * (minimumFactor + Math.random() * jitterRange);

    return Math.max(0, Math.min(this.maxRetryDelayMs, Math.round(jitteredDelay)));
  }

  private isCurrentSocket(generation: number, socket: WebSocket): boolean {
    return generation === this.socketGeneration && socket === this.socket;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) {
      return;
    }

    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private changeState(state: ConnectionState): void {
    if (state === this.currentState) {
      return;
    }

    const previousState = this.currentState;
    this.currentState = state;
    this.emit("stateChange", { previousState, state });
  }

  private emit<EventName extends WebSocketClientEventName>(
    eventName: EventName,
    event: WebSocketClientEventMap[EventName],
  ): void {
    const eventListeners = this.listeners.get(eventName);
    if (eventListeners === undefined) {
      return;
    }

    for (const listener of eventListeners) {
      listener(event);
    }
  }

  private validateOptions(options: {
    maxRetries: number;
    initialRetryDelayMs: number;
    maxRetryDelayMs: number;
    jitterRatio: number;
    queueCapacity: number;
  }): void {
    if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) {
      throw new RangeError("maxRetries must be a non-negative integer");
    }
    if (!Number.isFinite(options.initialRetryDelayMs) || options.initialRetryDelayMs <= 0) {
      throw new RangeError("initialRetryDelayMs must be greater than zero");
    }
    if (
      !Number.isFinite(options.maxRetryDelayMs) ||
      options.maxRetryDelayMs < options.initialRetryDelayMs
    ) {
      throw new RangeError("maxRetryDelayMs must be greater than or equal to initialRetryDelayMs");
    }
    if (
      !Number.isFinite(options.jitterRatio) ||
      options.jitterRatio < 0 ||
      options.jitterRatio > 1
    ) {
      throw new RangeError("jitterRatio must be between zero and one");
    }
    if (!Number.isInteger(options.queueCapacity) || options.queueCapacity < 1) {
      throw new RangeError("queueCapacity must be a positive integer");
    }
  }
}
