import type {
  CanonicalRequest,
  OpenAIChunk,
  OpenAIResponse,
  ProviderType,
  ResolvedProvider,
  StreamResult,
} from "../types.js";

export interface TestResult {
  ok: boolean;
  latency_ms: number;
  model?: string;
  error?: string;
}

export interface ProviderAdapter {
  type: ProviderType;
  /** Non-streaming request; returns an OpenAI-compatible response. */
  send(
    provider: ResolvedProvider,
    req: CanonicalRequest,
    signal: AbortSignal
  ): Promise<OpenAIResponse>;
  /** Streaming request; yields OpenAI-compatible chunks and returns the final result. */
  stream(
    provider: ResolvedProvider,
    req: CanonicalRequest,
    signal: AbortSignal
  ): AsyncGenerator<OpenAIChunk, StreamResult, void>;
  /** Cheap round-trip used by "Test connection". */
  test(provider: ResolvedProvider, signal: AbortSignal): Promise<TestResult>;
  /** List model ids available on this upstream (for the provider form). */
  listModels(provider: ResolvedProvider, signal: AbortSignal): Promise<string[]>;
}
