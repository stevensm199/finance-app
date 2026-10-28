# Finance Telegram Bot

A personal finance app that records expenses and income from Telegram messages. For example, a user can send `gaste 120000 en netflix`; the backend extracts the transaction, stores it in Supabase, and replies with a summary.

The MVP has no web interface or public user login. Telegram is the only user-facing client. Express exposes a private transaction API for the bot backend, and each transaction belongs to the internal user associated with the sender's Telegram ID.

## How a text message is processed

1. Telegram sends an update to the authenticated webhook.
2. The backend filters messages that do not look like transactions, then asks the configured DeepSeek model to extract the type, amount, and description.
3. The backend validates the extracted data and calls the transaction API with its service credential and the Telegram sender ID.
4. The API resolves the sender to an internal user, stores the transaction under that owner, and assigns its registration timestamp.
5. The bot replies with a localized summary or guidance when the message cannot be recorded.

An unknown Telegram ID is rejected until an administrator associates it with an internal user. Repeated delivery of the same Telegram update cannot create duplicate transactions.

## How an audio message is processed

The bot accepts Telegram voice notes and audio messages. It does not accept audio sent as a generic document. Audio must be no longer than 30 seconds, fit the configured size limit (at most 20 MB), and use a format enabled in configuration. The backend checks Telegram metadata before downloading, then checks the downloaded file signature before sending it to Groq.

Once the job is durably queued, the bot sends a configured “audio received” notice and acknowledges Telegram's webhook. A background worker then downloads and transcribes the audio in its spoken language with Groq Whisper. Empty or speech-free transcription is rejected. Usable text goes through the same transaction cue check, DeepSeek extraction, ownership resolution, and persistence as a text message. The bot sends the transaction summary only after Supabase confirms the transaction was saved.

The worker runs asynchronously in the backend process and stores queued job metadata in Supabase, not the audio bytes. Pending jobs survive backend restarts. Telegram update IDs prevent duplicate queueing and transaction creation. File and identity fields are cleared when a job reaches a terminal state; only the update ID remains until its configured deduplication window expires, when the row is deleted.

## Transaction API

All routes require both `Authorization: Bearer <BOT_SERVICE_TOKEN>` and `X-Telegram-User-Id`. The bot backend sets these headers after validating the Telegram webhook. The API resolves the Telegram ID to an internal owner UUID; callers cannot select an owner with `owner_id` in a body or query.

| Method and path | Behavior |
|---|---|
| `POST /api/transactions` | Create a transaction. Also requires `Idempotency-Key` with the Telegram update ID. |
| `PATCH /api/transactions/:id` | Update an owned transaction by UUID. |
| `DELETE /api/transactions/:id` | Delete an owned transaction by UUID. |
| `GET /api/transactions?page=1&pageSize=20` | Return the owner's transactions, newest first, with stable pagination. |

Create and update bodies accept `type` (`expense` or `income`), a positive decimal-string `amount`, and an optional `description`. A missing description defaults to the type. Registration time and owner are assigned by the backend and cannot be changed by a request.

Example create body:

```json
{
  "type": "expense",
  "amount": "120000",
  "description": "Netflix"
}
```

## Run locally

Local development uses Node.js, pnpm, Docker, the Supabase CLI, and Cloudflare Tunnel. The backend and Supabase run locally; Cloudflare Tunnel gives Telegram a temporary public HTTPS address for webhook delivery.

### 1. Install dependencies and create `.env`

```sh
pnpm install
cp .env.example .env
```

Only copy the example when `.env` does not already exist. Fill in the required values in `.env`:

- `SUPABASE_SERVICE_ROLE_KEY`: the local service role key shown by `supabase status -o env` after Supabase starts. Set `SUPABASE_URL` to the local `API_URL` (`http://127.0.0.1:55431`).
- `BOT_SERVICE_TOKEN`: generate a private service credential, for example with `openssl rand -hex 32`. Keep it in `.env`; do not put it in Telegram settings or messages.
- `TELEGRAM_BOT_TOKEN`: the token for your bot.
- `TELEGRAM_WEBHOOK_SECRET`: a random value containing only letters, numbers, `_`, or `-`.
- `LLM_API_KEY` and `LLM_MODEL`: your DeepSeek API key and model name.
- `GROQ_API_KEY`: your Groq API key for Whisper audio transcription.

The example file supplies local URLs, timeouts, audio limits and formats, worker retry settings, language, currency, prompt paths, and pagination defaults. `.env` is ignored by Git; never commit real credentials.

### 2. Start Supabase

```sh
supabase start
supabase status -o env
```

Use the local `API_URL` and `SERVICE_ROLE_KEY` from the status output in `.env`. The local Supabase API is `http://127.0.0.1:55431`, PostgreSQL is on port `55432`, and Studio is at `http://127.0.0.1:55433`.

Starting a fresh local stack applies the migrations. For an existing stack with pending migrations, run:

```sh
supabase migration up --local
```

The audio queue migrations must be applied before running the audio-enabled backend. Apply them to the production Supabase project before deploying the audio-enabled backend there.

### 3. Associate your Telegram account

The API does not create users automatically. Get your numeric Telegram user ID (the `Id` field; for example, with `@GetMyIDBot`), then open the Supabase Studio SQL Editor and insert it:

```sql
insert into public.users (telegram_user_id)
values (123456789)
on conflict (telegram_user_id) do nothing;
```

Replace the example number with your own ID. This association is required before the bot can save transactions for you.

### 4. Start the backend

```sh
pnpm dev
```

For a production-style local run:

```sh
pnpm build
pnpm start
```

Both commands load `.env`. Keep the backend running on port `3000`.

### 5. Give Telegram a public webhook URL

**This step is required for local testing.** The app uses webhooks and does not poll Telegram for updates. Telegram cannot send webhooks to `localhost`, so open another terminal and start a temporary HTTPS tunnel:

```sh
cloudflared tunnel --url http://127.0.0.1:3000
```

Keep this terminal open and copy the `https://...trycloudflare.com` URL it prints. In a third terminal, load `.env` and register the webhook. Replace the placeholder with the URL from Cloudflare:

```sh
cd /path/to/finance-app
set -a
source .env
set +a

PUBLIC_URL='https://<cloudflare-tunnel-host>'
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${PUBLIC_URL}/webhooks/telegram" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]'
```

Telegram should return `{"ok":true,"result":true}`. Verify the URL and delivery status with:

```sh
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Quick Tunnel URLs are temporary. If Cloudflare gives you a different URL after restarting the tunnel, run `setWebhook` again with the new URL. Keep both the backend and tunnel running while testing. Do not add `BOT_SERVICE_TOKEN` to the webhook request; it is only for bot-to-API calls.

### 6. Send a test message

Send `Hola` to the bot to receive usage guidance, then send a transaction such as `gaste 120000 en netflix`. If the account association is missing, the bot replies that the account is not enabled. If no reply arrives, inspect `last_error_message` and `pending_update_count` in `getWebhookInfo`.

To test audio, send a short Telegram voice note saying a transaction such as `Gasté 120000 en Netflix`. The bot should first confirm that it received the audio, then send the transaction summary after processing and persistence finish. An audio longer than 30 seconds, an unsupported format, silence, or speech without a transaction receives configured guidance. Do not send audio as a generic document; documents are not supported.

The worker starts automatically with `pnpm dev` or `pnpm start`; no separate worker command is needed. Check the backend's JSON logs for lifecycle events and error codes. Logs intentionally omit Telegram sender/chat identifiers, file references, audio, transcripts, and transaction details.

## Configuration and checks

Messages and transaction cues are in `config/messages.es.json` and `config/prompts/transaction-extraction.es.txt`. Provider credentials, model selection, audio formats and limits, worker behavior, database, locale, currency, and page limits are configured through `.env`.

Run the unit suite and TypeScript build with:

```sh
pnpm test
pnpm build
```
