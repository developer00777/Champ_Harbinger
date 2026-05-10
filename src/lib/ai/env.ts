import { z } from 'zod';

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY is required'),
  HARBINGER_DEFAULT_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.6'),
});

export const aiEnv = schema.parse({
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  HARBINGER_DEFAULT_MODEL: process.env.HARBINGER_DEFAULT_MODEL,
});
