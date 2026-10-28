## 1. Telegram audio input and configuration

- [x] 1.1 Extend Telegram update validation for voice and audio metadata, and verify supported, unsupported, and malformed payload cases in unit tests.
- [x] 1.2 Add validated Groq, duration, size, speech, retry, polling, and retention settings plus configured Spanish audio responses; verify valid and invalid configuration and message files with unit tests.
- [x] 1.3 Add Telegram file metadata lookup and safe download adapters; verify supported file paths, size bounds, HTTP failures, and timeout handling with stubbed fetch tests.

## 2. Transcription and audio validation

- [x] 2.1 Implement Groq transcription with the configured multilingual Whisper model and verbose metadata; verify spoken-language text, empty output, no-speech metadata, malformed responses, provider errors, and timeout behavior with mocked SDK tests.
- [x] 2.2 Implement pre-download duration/size checks and post-download format/content validation; verify overlong, oversized, missing-metadata, unsupported-signature, and valid audio cases without sending invalid audio to Groq.
- [x] 2.3 Route usable transcripts through the existing cue check and capture use case with the original Telegram update ID; verify non-transaction speech skips DeepSeek and valid speech follows existing persistence and reply behavior.

## 3. Durable job processing

- [x] 3.1 Add a Supabase migration for uniquely keyed audio jobs, atomic leased job claims, bounded retry scheduling, metadata cleanup, indexes, and service-role-only access; verify migration applies and rolls back against local Supabase.
- [x] 3.2 Implement job enqueue, claim, completion, failure, and cleanup adapters; verify deduplication, lease recovery, transient retry, terminal cleanup, and persistence errors with repository unit tests.
- [x] 3.3 Implement the bounded asynchronous worker loop and terminal Telegram replies; verify pending jobs resume after worker restart, duplicate updates do not transcribe twice, and retry exhaustion does not create transactions.

## 4. Webhook integration and delivery

- [x] 4.1 Enqueue valid audio updates before acknowledging Telegram, send configured processing and validation messages, and preserve the existing text flow; verify accepted updates return promptly and failed enqueue requests are not acknowledged.
- [x] 4.2 Wire the Telegram file adapter, Groq transcriber, queue repository, and worker in the composition root; verify logs contain lifecycle outcomes without secrets, identifiers, audio, transcripts, or transaction fields.
- [x] 4.3 Document the new Groq environment variables, limits, queue migration, and local audio flow; verify `pnpm test`, `pnpm build`, and OpenSpec validation pass.
