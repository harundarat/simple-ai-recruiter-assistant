import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  requestId?: string;
  evaluationId?: number;
  jobId?: string;
  jobAttempt?: number;
}

const logContextStorage = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext | undefined {
  return logContextStorage.getStore();
}

export function runWithLogContext<T>(
  context: LogContext,
  operation: () => T,
): T {
  return logContextStorage.run(context, operation);
}
