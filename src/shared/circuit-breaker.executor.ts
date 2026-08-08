import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BrokenCircuitError,
  CircuitBreakerPolicy,
  ConsecutiveBreaker,
  circuitBreaker,
  handleWhen,
} from 'cockatiel';
import { isRateLimitError, isRetryableError } from './retry.utils';

export type ExternalServiceName = 'gemini' | 'chroma' | 's3' | 'redis';

interface CircuitOperationContext {
  operationName: string;
}

export class CircuitOpenError extends Error {
  readonly circuitState = 'open';

  constructor(
    readonly service: ExternalServiceName,
    readonly operationName: string,
    cause?: unknown,
  ) {
    super(`Circuit for ${service} is open during ${operationName}`, { cause });
    this.name = 'CircuitOpenError';
  }
}

@Injectable()
export class CircuitBreakerExecutor {
  private readonly logger = new Logger(CircuitBreakerExecutor.name);
  private readonly enabled: boolean;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly policies = new Map<
    ExternalServiceName,
    CircuitBreakerPolicy
  >();
  private readonly operationContext =
    new AsyncLocalStorage<CircuitOperationContext>();

  constructor(configService: ConfigService) {
    this.enabled =
      configService.get<boolean>('CIRCUIT_BREAKER_ENABLED') ?? true;
    this.failureThreshold =
      configService.get<number>('CIRCUIT_BREAKER_FAILURE_THRESHOLD') ?? 3;
    this.resetTimeoutMs =
      configService.get<number>('CIRCUIT_BREAKER_RESET_TIMEOUT_MS') ?? 30_000;
  }

  async execute<T>(
    service: ExternalServiceName,
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.enabled) {
      return operation();
    }

    const policy = this.getPolicy(service);
    try {
      return await this.operationContext.run({ operationName }, () =>
        policy.execute(operation),
      );
    } catch (error: unknown) {
      if (error instanceof BrokenCircuitError) {
        this.logger.warn(
          {
            event: 'circuit.short_circuited',
            circuitState: 'open',
            service,
            operationName,
          },
          'External service call short-circuited',
        );
        throw new CircuitOpenError(service, operationName, error);
      }
      throw error;
    }
  }

  private getPolicy(service: ExternalServiceName): CircuitBreakerPolicy {
    const existing = this.policies.get(service);
    if (existing) {
      return existing;
    }

    const policy = circuitBreaker(
      handleWhen(
        (error: unknown) => isRetryableError(error) && !isRateLimitError(error),
      ),
      {
        breaker: new ConsecutiveBreaker(this.failureThreshold),
        halfOpenAfter: this.resetTimeoutMs,
        halfOpenSampling: { calls: 1, threshold: 0 },
      },
    );

    policy.onBreak(() => this.logTransition(service, 'open'));
    policy.onHalfOpen(() => this.logTransition(service, 'half-open'));
    policy.onReset(() => this.logTransition(service, 'closed'));
    this.policies.set(service, policy);
    return policy;
  }

  private logTransition(
    service: ExternalServiceName,
    circuitState: 'open' | 'half-open' | 'closed',
  ): void {
    const context = this.operationContext.getStore();
    const details = {
      event:
        circuitState === 'open' ? 'circuit.opened' : 'circuit.state_changed',
      circuitState,
      service,
      operationName: context?.operationName ?? 'unknown',
    };

    if (circuitState === 'open') {
      this.logger.warn(details, 'External service circuit opened');
      return;
    }
    this.logger.log(details, 'External service circuit state changed');
  }
}
