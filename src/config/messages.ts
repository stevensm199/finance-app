import { readFileSync } from 'node:fs';
import { z } from 'zod';

const messageSchema = z.object({
  success: z.string().min(1),
  usage: z.string().min(1),
  temporaryFailure: z.string().min(1),
  unsupported: z.string().min(1),
  audioProcessing: z.string().min(1),
  audioTooLong: z.string().min(1),
  audioUnsupported: z.string().min(1),
  audioNoSpeech: z.string().min(1),
  unlinkedAccount: z.string().min(1),
  typeLabels: z.object({ expense: z.string().min(1), income: z.string().min(1) }),
  httpErrors: z.object({
    validation: z.string().min(1),
    unauthorized: z.string().min(1),
    forbidden: z.string().min(1),
    not_found: z.string().min(1),
    conflict: z.string().min(1),
    provider: z.string().min(1),
    persistence: z.string().min(1),
    internal: z.string().min(1)
  })
});

export type Messages = z.infer<typeof messageSchema>;

export const loadMessages = (path: string): Messages =>
  messageSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
