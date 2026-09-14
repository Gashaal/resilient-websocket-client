export enum ConnectionState {
  Idle = "idle",
  Connecting = "connecting",
  Open = "open",
  WaitingToReconnect = "waiting-to-reconnect",
  Closed = "closed",
}

export type OutgoingMessage = string | Blob | BufferSource;

export enum SendResult {
  Sent = "sent",
  Queued = "queued",
}

export interface WebSocketClientOptions {
  url: string;
  protocols?: string | string[];
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  jitterRatio?: number;
  queueCapacity?: number;
}

export interface StateChangeEvent {
  previousState: ConnectionState;
  state: ConnectionState;
}

export enum ErrorOperation {
  Connect = "connect",
  Socket = "socket",
  Send = "send",
  Flush = "flush",
}

export interface WebSocketClientErrorEvent {
  operation: ErrorOperation;
  error: unknown;
}

export interface ReconnectScheduledEvent {
  attempt: number;
  delayMs: number;
}

export interface RetryExhaustedEvent {
  attempts: number;
}

export interface MessageDroppedEvent {
  message: OutgoingMessage;
  reason: "queue-overflow";
}

export interface WebSocketClientEventMap {
  stateChange: StateChangeEvent;
  open: Event;
  message: MessageEvent<unknown>;
  close: CloseEvent;
  error: WebSocketClientErrorEvent;
  reconnectScheduled: ReconnectScheduledEvent;
  retryExhausted: RetryExhaustedEvent;
  messageDropped: MessageDroppedEvent;
}

export type WebSocketClientEventName = keyof WebSocketClientEventMap;

export type WebSocketClientEventListener<EventName extends WebSocketClientEventName> = (
  event: WebSocketClientEventMap[EventName],
) => void;
