import type {
  GeminiClient,
  GeminiGenerationOperation,
  GeminiOperation,
} from '../../src/shared/gemini-client';

export type FakeGeminiMode =
  | 'success'
  | 'transient'
  | 'rate-limited'
  | 'persistent-transient'
  | 'empty'
  | 'malformed-json'
  | 'schema-invalid';

interface Behavior {
  mode: FakeGeminiMode;
  failuresRemaining: number;
}

const successPayloads: Record<GeminiGenerationOperation, unknown> = {
  CV_EVALUATION: {
    technical_skills_score: 5,
    technical_skills_reasoning: 'Deterministic technical evidence',
    experience_score: 4,
    experience_reasoning: 'Deterministic relevant experience',
    achievements_score: 4,
    achievements_reasoning: 'Deterministic measurable achievements',
    cultural_fit_score: 5,
    cultural_fit_reasoning: 'Deterministic collaboration evidence',
    cv_match_rate: 0.88,
    cv_feedback: 'Deterministic CV feedback',
  },
  PROJECT_EVALUATION: {
    correctness_score: 5,
    correctness_reasoning: 'Deterministic requirements coverage',
    code_quality_score: 4,
    code_quality_reasoning: 'Deterministic code quality',
    resilience_score: 4,
    resilience_reasoning: 'Deterministic resilience',
    documentation_score: 5,
    documentation_reasoning: 'Deterministic documentation',
    creativity_score: 4,
    creativity_reasoning: 'Deterministic useful additions',
    project_score: 4.4,
    project_feedback: 'Deterministic project feedback',
  },
  FINAL_SYNTHESIS: {
    overall_summary: 'Deterministic recommendation: proceed to interview',
    key_strengths: ['Backend engineering', 'Clear communication'],
    areas_for_improvement: ['Production scale discussion'],
    hiring_recommendation: 'hire',
    confidence_level: 5,
    confidence_reasoning: 'Deterministic evidence is consistent',
    interview_focus_areas: ['System design'],
    role_fit_percentage: 88,
    next_steps: 'Proceed to technical interview',
  },
};

export class FakeGeminiClient implements GeminiClient {
  private readonly behaviors = new Map<GeminiOperation, Behavior>();
  private readonly attempts = new Map<GeminiOperation, number>();

  reset(): void {
    this.behaviors.clear();
    this.attempts.clear();
  }

  setBehavior(
    operation: GeminiOperation,
    mode: FakeGeminiMode,
    transientFailures = 1,
  ): void {
    this.behaviors.set(operation, {
      mode,
      failuresRemaining: transientFailures,
    });
    this.attempts.set(operation, 0);
  }

  getAttemptCount(operation: GeminiOperation): number {
    return this.attempts.get(operation) ?? 0;
  }

  async generateContent(
    operation: GeminiGenerationOperation,
  ): Promise<{ text?: string }> {
    await Promise.resolve();
    const mode = this.recordAttempt(operation);
    if (mode === 'empty') {
      return { text: '' };
    }
    if (mode === 'malformed-json') {
      return { text: '{not-json' };
    }
    if (mode === 'schema-invalid') {
      return { text: JSON.stringify({ unexpected: true }) };
    }
    return { text: JSON.stringify(successPayloads[operation]) };
  }

  async embed(texts: string[]): Promise<number[][]> {
    await Promise.resolve();
    this.recordAttempt('EMBEDDING');
    return texts.map((text) => deterministicVector(text));
  }

  private recordAttempt(operation: GeminiOperation): FakeGeminiMode {
    this.attempts.set(operation, this.getAttemptCount(operation) + 1);
    const behavior = this.behaviors.get(operation) ?? {
      mode: 'success' as const,
      failuresRemaining: 0,
    };

    if (behavior.mode === 'persistent-transient') {
      throw transientError(operation);
    }
    if (behavior.mode === 'transient' && behavior.failuresRemaining > 0) {
      behavior.failuresRemaining -= 1;
      this.behaviors.set(operation, behavior);
      throw transientError(operation);
    }
    if (behavior.mode === 'rate-limited' && behavior.failuresRemaining > 0) {
      behavior.failuresRemaining -= 1;
      this.behaviors.set(operation, behavior);
      throw rateLimitError(operation);
    }
    return behavior.mode;
  }
}

function transientError(operation: GeminiOperation): Error {
  return Object.assign(new Error(`Fake transient ${operation} failure`), {
    status: 503,
    code: 'ECONNRESET',
  });
}

function rateLimitError(operation: GeminiOperation): Error {
  return Object.assign(
    new Error(
      JSON.stringify({
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: `Fake rate limit for ${operation}`,
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.RetryInfo',
              retryDelay: '0.005s',
            },
          ],
        },
      }),
    ),
    { status: 429 },
  );
}

export function deterministicVector(text: string): number[] {
  const vector = Array.from<number>({ length: 8 }).fill(0);
  const bytes = Buffer.from(text.normalize('NFKC').toLowerCase());
  for (let index = 0; index < bytes.length; index += 1) {
    vector[index % vector.length] += (bytes[index] + 1) / 256;
  }
  const magnitude = Math.sqrt(
    vector.reduce((total, value) => total + value * value, 0),
  );
  return vector.map((value, index) =>
    magnitude === 0 ? (index === 0 ? 1 : 0) : value / magnitude,
  );
}
