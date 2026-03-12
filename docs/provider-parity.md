# Provider and Parity Notes

## Initial provider decisions

- LLM: Gemini
- Streaming STT: Deepgram
- Ticket pipeline: Gemini generation plus Linear push

## Ticket-generation reference

The `ticket-generator/` directory is the reference implementation for:

- transcript condensation behavior
- JSON repair strategy
- ticket normalization and dedupe
- deterministic idempotency keys
- retry and timeout behavior
- idempotent Linear push handling

## Porting rule

Do not rewrite ticket generation in Rust until shared fixtures exist and the current reference behavior is frozen in tests.
