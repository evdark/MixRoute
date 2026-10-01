import type { ProviderType } from "../types.js";
import type { ProviderAdapter } from "./types.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";
import { AnthropicAdapter } from "./anthropic.js";

/**
 * Provider Adapter System — the router contains zero provider-specific logic;
 * everything goes through the registry.
 *
 * Capability mapping (supported parameters per adapter):
 *   openai            : everything (tools, vision, json_mode, streaming, usage)
 *   openai-compatible : everything OpenAI-compatible providers expose
 *   gemini            : via Google's OpenAI-compatible endpoint
 *   anthropic         : tools + vision + streaming supported;
 *                       response_format (json_mode) is dropped, max_tokens defaults to 4096
 */

const adapters: Record<ProviderType, ProviderAdapter> = {
  openai: new OpenAICompatibleAdapter("openai", {
    defaultBaseUrl: "https://api.openai.com/v1",
    includeUsageOption: true,
  }),
  "openai-compatible": new OpenAICompatibleAdapter("openai-compatible"),
  gemini: new OpenAICompatibleAdapter("gemini", {
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  }),
  anthropic: new AnthropicAdapter(),
};

export function getAdapter(type: ProviderType): ProviderAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unknown provider type: ${type}`);
  return adapter;
}

export const PROVIDER_TYPES: ProviderType[] = ["openai", "anthropic", "openai-compatible", "gemini"];
