import { BaseLLMProvider } from "./base";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";

export function createProvider(): BaseLLMProvider {
  const requested = process.env.LLM_PROVIDER?.toLowerCase();

  // Only instantiate the requested provider
  if (requested === "anthropic") {
    const p = new AnthropicProvider();
    if (!p.isAvailable()) throw new Error('Provider "anthropic" requested but ANTHROPIC_API_KEY not set.');
    return p;
  }
  if (requested === "ollama") {
    const p = new OllamaProvider();
    if (!p.isAvailable()) throw new Error('Provider "ollama" requested but OLLAMA_BASE_URL not set.');
    return p;
  }
  if (requested === "openai") {
    const p = new OpenAIProvider();
    if (!p.isAvailable()) throw new Error('Provider "openai" requested but OPENAI_API_KEY not set.');
    return p;
  }

  // Auto-detect — only instantiate one at a time
  const openai = new OpenAIProvider();
  if (openai.isAvailable()) return openai;

  const anthropic = new AnthropicProvider();
  if (anthropic.isAvailable()) return anthropic;

  const ollama = new OllamaProvider();
  if (ollama.isAvailable()) return ollama;

  throw new Error(
    "No LLM provider configured. Add one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_BASE_URL to your .env file.",
  );
}

export type { BaseLLMProvider, LLMResponse, Message, ToolDefinition, ToolCall } from "./base";
