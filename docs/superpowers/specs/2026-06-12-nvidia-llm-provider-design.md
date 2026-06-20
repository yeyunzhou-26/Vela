# NVIDIA LLM Provider Design

## Goal

Add NVIDIA NIM as a first-class LLM provider so users can choose NVIDIA in the LLM settings panel and save an NVIDIA API key without using the custom endpoint fields.

## Design

- Add a `nvidia` provider to the central provider registry in `src/config.js`.
- Use NVIDIA's OpenAI-compatible base URL: `https://integrate.api.nvidia.com/v1`.
- Use `NVIDIA_API_KEY` for environment-based activation.
- Expose a small curated model list, with `openai/gpt-oss-120b` as the default general chat model.
- Reuse the existing OpenAI SDK client and activation flow because NVIDIA NIM chat completions are OpenAI-compatible.
- Keep runtime requests compatible with NVIDIA's documented parameter surface by omitting OpenAI-specific `stream_options` and non-NVIDIA `thinking` payloads.
- Let the settings UI render NVIDIA automatically from `/settings`; no bespoke UI is needed.

## Error Handling

NVIDIA activation should use the existing provider validation path. Invalid keys return the existing provider-specific validation error, and transient endpoint errors keep the original message context.

## Testing

- Extend config-upgrade tests so `NVIDIA_API_KEY` does not leak from the environment.
- Add internal model exports for test visibility.
- Run config-upgrade tests and a syntax check for modified JavaScript.
