import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Interface to bind; unset binds all of them. main.ts reads it (and CORS_ORIGINS) directly,
  // before this schema's ConfigModule exists — they're listed here so a typo still fails fast.
  HOST: z.string().min(1).optional(),
  // Comma-separated browser origins allowed to call the API, e.g. "https://koenigstag.github.io".
  CORS_ORIGINS: z
    .string()
    .optional()
    .refine(
      (value) =>
        !value ||
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
          .every((origin) => /^https?:\/\/[^/]+$/.test(origin)),
      'CORS_ORIGINS must be comma-separated origins like https://example.com, without paths',
    ),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  // Plain number of seconds, not a duration string like the access TTL above — this one is
  // used to compute refresh_tokens.expires_at ourselves, not just handed to a jwt library.
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  return envSchema.parse(raw);
}
