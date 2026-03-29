import { BaseLLMProvider } from "./base";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";

export function createProvider(): BaseLLMProvider {
  const requested = process.env.LLM_PROVIDER?.toLowerCase();

  const providers: Record<string, BaseLLMProvider> = {
    openai: new OpenAIProvider(),
    anthropic: new AnthropicProvider(),
    ollama: new OllamaProvider(),
  };

  // Use explicitly requested provider
  if (requested && providers[requested]) {
    if (!providers[requested].isAvailable()) {
      throw new Error(
        `Provider "${requested}" requested but not configured. Check your .env file.`,
      );
    }
    return providers[requested];
  }

  // Auto-detect from available API keys
  if (providers.openai.isAvailable()) return providers.openai;
  if (providers.anthropic.isAvailable()) return providers.anthropic;
  if (providers.ollama.isAvailable()) return providers.ollama;

  throw new Error(
    "No LLM provider configured. Add one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_BASE_URL to your .env file.",
  );
}

export type { BaseLLMProvider, LLMResponse, Message, ToolDefinition, ToolCall } from "./base";
