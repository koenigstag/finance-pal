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
  // Two keys on purpose: a refresh token can't be passed off as an access token or vice versa,
  // and either key can be rotated without touching the other kind of token.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  // Plain number of seconds, not a duration string like the access TTL above — this one is
  // used to compute refresh_tokens.expires_at ourselves, not just handed to a jwt library.
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  // Web Push. Optional as a set: without them the push endpoints report that push isn't set up
  // and the app hides the switch rather than offering one that could only fail. Generate a pair
  // with `npx web-push generate-vapid-keys` — see docs/push-notifications.md.
  //
  // The public key is not a secret (every subscribing device gets it), but the private one is,
  // and the pair can't be rotated freely: every device is registered against the public key it
  // subscribed with, and a new pair silently stops reaching all of them until they re-subscribe.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  // Where a push service can reach whoever runs this deployment if a notification misbehaves —
  // required by the VAPID spec, and passed on unchanged.
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:\/\/)\S+$/, 'VAPID_SUBJECT must be a mailto: or https:// URL')
    .optional(),
})
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
    path: ['JWT_REFRESH_SECRET'],
  })
  // Half a set is a misconfiguration, not a deployment without push: failing here beats starting
  // up with a switch that hands devices a key nothing can send to.
  .refine((env) => !env.VAPID_PUBLIC_KEY === !env.VAPID_PRIVATE_KEY, {
    message: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together',
    path: ['VAPID_PRIVATE_KEY'],
  })
  .refine((env) => !env.VAPID_PUBLIC_KEY || Boolean(env.VAPID_SUBJECT), {
    message: 'VAPID_SUBJECT is required when push notifications are configured',
    path: ['VAPID_SUBJECT'],
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  return envSchema.parse(raw);
}
