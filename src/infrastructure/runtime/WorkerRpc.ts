export interface WorkerRpcEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: EventListener,
  ): void;
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: EventListener,
  ): void;
  terminate?(): void;
  close?(): void;
}

export interface WorkerRpcFailure {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

interface WorkerRpcRequestMessage {
  readonly type: 'request';
  readonly requestId: number;
  readonly method: string;
  readonly payload: unknown;
}

interface WorkerRpcCancelMessage {
  readonly type: 'cancel';
  readonly requestId: number;
}

interface WorkerRpcDisposeMessage {
  readonly type: 'dispose';
}

type WorkerRpcClientMessage =
  WorkerRpcRequestMessage | WorkerRpcCancelMessage | WorkerRpcDisposeMessage;

interface WorkerRpcResultMessage {
  readonly type: 'result';
  readonly requestId: number;
  readonly value: unknown;
}

interface WorkerRpcFailureMessage {
  readonly type: 'failure';
  readonly requestId: number;
  readonly failure: WorkerRpcFailure;
}

interface WorkerRpcEventMessage {
  readonly type: 'event';
  readonly name: string;
  readonly payload: unknown;
}

type WorkerRpcServerMessage =
  WorkerRpcResultMessage | WorkerRpcFailureMessage | WorkerRpcEventMessage;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  readonly signal: AbortSignal | undefined;
  readonly handleAbort: () => void;
}

export interface WorkerRpcTransferResult {
  readonly value: unknown;
  readonly transfer: readonly Transferable[];
}

export interface WorkerRpcRequestContext {
  readonly requestId: number;
  readonly signal: AbortSignal;
}

export type WorkerRpcHandler = (
  payload: unknown,
  context: WorkerRpcRequestContext,
) => unknown;

export class WorkerRpcRemoteError extends Error {
  public readonly code: string | undefined;

  public constructor(failure: WorkerRpcFailure) {
    super(failure.message);
    this.name = failure.name;
    this.code = failure.code;
  }
}

export class WorkerRpcTransportError extends Error {
  public constructor(message = 'The worker transport failed.') {
    super(message);
    this.name = 'WorkerRpcTransportError';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isFailure(value: unknown): value is WorkerRpcFailure {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.message === 'string' &&
    (value.code === undefined || typeof value.code === 'string')
  );
}

function parseServerMessage(value: unknown): WorkerRpcServerMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (
    value.type === 'result' &&
    typeof value.requestId === 'number' &&
    'value' in value
  ) {
    return { type: 'result', requestId: value.requestId, value: value.value };
  }
  if (
    value.type === 'failure' &&
    typeof value.requestId === 'number' &&
    isFailure(value.failure)
  ) {
    return { type: 'failure', requestId: value.requestId, failure: value.failure };
  }
  if (value.type === 'event' && typeof value.name === 'string' && 'payload' in value) {
    return { type: 'event', name: value.name, payload: value.payload };
  }
  return null;
}

function parseClientMessage(value: unknown): WorkerRpcClientMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (
    value.type === 'request' &&
    typeof value.requestId === 'number' &&
    typeof value.method === 'string' &&
    'payload' in value
  ) {
    return {
      type: 'request',
      requestId: value.requestId,
      method: value.method,
      payload: value.payload,
    };
  }
  if (value.type === 'cancel' && typeof value.requestId === 'number') {
    return { type: 'cancel', requestId: value.requestId };
  }
  return value.type === 'dispose' ? { type: 'dispose' } : null;
}

function abortError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new DOMException('Worker request canceled.', 'AbortError');
}

/** Correlates typed wrapper requests over any Worker-like message endpoint. */
export class WorkerRpcClient {
  readonly #pending = new Map<number, PendingRequest>();
  readonly #eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  readonly #transportFailureListeners = new Set<
    (error: WorkerRpcTransportError) => void
  >();
  #nextRequestId = 1;
  #disposed = false;
  #transportFailed = false;

  public constructor(private readonly endpoint: WorkerRpcEndpoint) {
    endpoint.addEventListener('message', this.handleMessage);
    endpoint.addEventListener('error', this.handleTransportFailure);
    endpoint.addEventListener('messageerror', this.handleTransportFailure);
  }

  public request<TResult>(
    method: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<TResult> {
    if (this.#disposed || this.#transportFailed) {
      return Promise.reject(
        new WorkerRpcTransportError('The worker channel is unavailable.'),
      );
    }
    if (signal?.aborted === true) return Promise.reject(abortError(signal.reason));
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    return new Promise<TResult>((resolve, reject) => {
      const handleAbort = () => {
        this.endpoint.postMessage({
          type: 'cancel',
          requestId,
        } satisfies WorkerRpcCancelMessage);
        this.releaseRequest(requestId);
        reject(abortError(signal?.reason));
      };
      this.#pending.set(requestId, {
        resolve: (value) => {
          resolve(value as TResult);
        },
        reject,
        signal,
        handleAbort,
      });
      signal?.addEventListener('abort', handleAbort, { once: true });
      this.endpoint.postMessage({
        type: 'request',
        requestId,
        method,
        payload,
      } satisfies WorkerRpcRequestMessage);
    });
  }

  public subscribeEvent(
    name: string,
    listener: (payload: unknown) => void,
  ): () => void {
    const listeners = this.#eventListeners.get(name) ?? new Set();
    listeners.add(listener);
    this.#eventListeners.set(name, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#eventListeners.delete(name);
    };
  }

  public subscribeTransportFailure(
    listener: (error: WorkerRpcTransportError) => void,
  ): () => void {
    this.#transportFailureListeners.add(listener);
    return () => {
      this.#transportFailureListeners.delete(listener);
    };
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (!this.#transportFailed) this.endpoint.postMessage({ type: 'dispose' });
    this.rejectPending(new WorkerRpcTransportError('The worker channel was disposed.'));
    this.removeListeners();
    this.endpoint.terminate?.();
    this.#eventListeners.clear();
    this.#transportFailureListeners.clear();
  }

  private readonly handleMessage: EventListener = (event): void => {
    if (!(event instanceof MessageEvent)) {
      this.failTransport(
        new WorkerRpcTransportError('The worker sent an invalid message event.'),
      );
      return;
    }
    const message = parseServerMessage(event.data);
    if (message === null) {
      this.failTransport(
        new WorkerRpcTransportError('The worker sent an invalid message.'),
      );
      return;
    }
    if (message.type === 'event') {
      for (const listener of this.#eventListeners.get(message.name) ?? []) {
        listener(message.payload);
      }
      return;
    }
    const pending = this.#pending.get(message.requestId);
    if (pending === undefined) return;
    this.releaseRequest(message.requestId);
    if (message.type === 'result') pending.resolve(message.value);
    else pending.reject(new WorkerRpcRemoteError(message.failure));
  };

  private readonly handleTransportFailure: EventListener = (): void => {
    this.failTransport(new WorkerRpcTransportError());
  };

  private failTransport(error: WorkerRpcTransportError): void {
    if (this.#disposed || this.#transportFailed) return;
    this.#transportFailed = true;
    this.rejectPending(error);
    this.removeListeners();
    for (const listener of this.#transportFailureListeners) listener(error);
  }

  private rejectPending(error: WorkerRpcTransportError): void {
    for (const [requestId, pending] of this.#pending) {
      this.releaseRequest(requestId);
      pending.reject(error);
    }
  }

  private releaseRequest(requestId: number): PendingRequest | undefined {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return undefined;
    pending.signal?.removeEventListener('abort', pending.handleAbort);
    this.#pending.delete(requestId);
    return pending;
  }

  private removeListeners(): void {
    this.endpoint.removeEventListener('message', this.handleMessage);
    this.endpoint.removeEventListener('error', this.handleTransportFailure);
    this.endpoint.removeEventListener('messageerror', this.handleTransportFailure);
  }
}

function normalizeFailure(error: unknown): WorkerRpcFailure {
  if (error instanceof DOMException) {
    return { name: error.name, message: error.message };
  }
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: 'The worker request failed.' };
}

function isTransferResult(value: unknown): value is WorkerRpcTransferResult {
  return isRecord(value) && Array.isArray(value.transfer) && 'value' in value;
}

/** Owns worker-side request cancellation, dispatch, events, and deterministic shutdown. */
export class WorkerRpcServer {
  readonly #requests = new Map<number, AbortController>();
  #disposed = false;

  public constructor(
    private readonly endpoint: WorkerRpcEndpoint,
    private readonly handlers: Readonly<Record<string, WorkerRpcHandler>>,
    private readonly onDispose: () => void = () => undefined,
  ) {
    endpoint.addEventListener('message', this.handleMessage);
  }

  public publishEvent(name: string, payload: unknown): void {
    if (this.#disposed) return;
    this.endpoint.postMessage({
      type: 'event',
      name,
      payload,
    } satisfies WorkerRpcEventMessage);
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const controller of this.#requests.values()) {
      controller.abort(new DOMException('Worker RPC server disposed.', 'AbortError'));
    }
    this.#requests.clear();
    this.endpoint.removeEventListener('message', this.handleMessage);
    this.onDispose();
    this.endpoint.close?.();
  }

  private readonly handleMessage: EventListener = (event): void => {
    if (!(event instanceof MessageEvent)) return;
    const message = parseClientMessage(event.data);
    if (message === null || this.#disposed) return;
    if (message.type === 'dispose') {
      this.dispose();
      return;
    }
    if (message.type === 'cancel') {
      this.#requests
        .get(message.requestId)
        ?.abort(new DOMException('Worker request canceled.', 'AbortError'));
      return;
    }
    const handler = this.handlers[message.method];
    if (handler === undefined) {
      this.postFailure(message.requestId, new Error('Unknown worker RPC method.'));
      return;
    }
    const controller = new AbortController();
    this.#requests.set(message.requestId, controller);
    void Promise.resolve()
      .then(() =>
        handler(message.payload, {
          requestId: message.requestId,
          signal: controller.signal,
        }),
      )
      .then(
        (result) => {
          if (this.#requests.get(message.requestId) !== controller) return;
          this.#requests.delete(message.requestId);
          if (controller.signal.aborted) return;
          if (isTransferResult(result)) {
            this.endpoint.postMessage(
              {
                type: 'result',
                requestId: message.requestId,
                value: result.value,
              } satisfies WorkerRpcResultMessage,
              [...result.transfer],
            );
            return;
          }
          this.endpoint.postMessage({
            type: 'result',
            requestId: message.requestId,
            value: result,
          } satisfies WorkerRpcResultMessage);
        },
        (error: unknown) => {
          if (this.#requests.get(message.requestId) !== controller) return;
          this.#requests.delete(message.requestId);
          this.postFailure(message.requestId, error);
        },
      );
  };

  private postFailure(requestId: number, error: unknown): void {
    this.endpoint.postMessage({
      type: 'failure',
      requestId,
      failure: normalizeFailure(error),
    } satisfies WorkerRpcFailureMessage);
  }
}
