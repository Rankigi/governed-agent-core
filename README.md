# Governed Agent Core

A minimal AI agent born inside the RANKIGI governed reality layer.

## What this is

This is a reference implementation of a governed AI agent. Every action this agent takes — every tool call, every LLM response, every input and output — is cryptographically recorded in a tamper-evident hash chain.

This agent cannot exist in an ungoverned state. It was born governed. That's the point.

## What it can do

- Search the web
- Perform calculations
- Summarize text
- Remember notes across a conversation
- Receive instructions via Telegram

## Supported LLM providers

This agent is model agnostic — matching RANKIGI's core principle.

| Provider  | Models | Setup |
|-----------|--------|-------|
| OpenAI    | GPT-4o, GPT-4o-mini | Add `OPENAI_API_KEY` |
| Anthropic | Claude Sonnet, Opus | Add `ANTHROPIC_API_KEY` |
| Ollama    | Llama 3.2, Mistral, any local model | Add `OLLAMA_BASE_URL` |

The reasoning loop is identical regardless of which provider runs it. The governance record is identical too.

A developer running Llama 3.2 locally on a Raspberry Pi 5 gets the same RANKIGI passport, the same hash chain, and the same trust score as someone running GPT-4o in the cloud.

That's the point.

## How governance works

Every agent action is observed by a passive RANKIGI sidecar. The sidecar:
- Hashes inputs and outputs (SHA-256)
- Submits events to the RANKIGI chain
- Never blocks agent execution
- Buffers events if RANKIGI is offline

The agent continues operating even if RANKIGI is down. The audit trail resumes when the connection restores.

## Quickstart

1. Clone this repo
2. Copy `.env.example` to `.env`
3. Add your API keys
4. Birth this agent in RANKIGI:
   [rankigi.com/dashboard/agents/new](https://rankigi.com/dashboard/agents/new)
   Paste this repo URL to get your `RANKIGI_AGENT_ID` and `RANKIGI_API_KEY`
5. `npm install && npm run start`

## The RANKIGI layer

This agent is governed by RANKIGI — the reality layer for autonomous AI agents. Runtime agnostic. Storage agnostic. Model agnostic.

[rankigi.com](https://rankigi.com)
