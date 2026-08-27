import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  PLAID_CLIENT_ID: z.string().min(1, "PLAID_CLIENT_ID is required."),
  PLAID_SECRET: z.string().min(1, "PLAID_SECRET is required."),
  PLAID_ENV: z.enum(["sandbox", "development", "production"]).default("sandbox"),
  PLAID_REDIRECT_URI: z.string().url().optional().or(z.literal("")),
  SESSION_SIGNING_SECRET: z
    .string()
    .min(32, "SESSION_SIGNING_SECRET must be at least 32 characters."),
  TOKEN_ENCRYPTION_KEY: z.string().min(1, "TOKEN_ENCRYPTION_KEY is required."),
  ADMIN_PASSWORD_HASH: z.string().min(1, "ADMIN_PASSWORD_HASH is required."),
  SESSION_TTL_MINUTES: z.coerce.number().int().min(15).max(1440).default(60)
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsedEnv.error.issues) {
    console.error(`- ${issue.path.join(".") || "env"}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsedEnv.data;

const tokenKey = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
if (tokenKey.length !== 32) {
  console.error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64).");
  process.exit(1);
}

if (env.PLAID_ENV === "production") {
  if (!env.PLAID_REDIRECT_URI) {
    console.error("PLAID_REDIRECT_URI is required when PLAID_ENV=production.");
    process.exit(1);
  }

  const redirectUriProtocol = new URL(env.PLAID_REDIRECT_URI).protocol;
  if (redirectUriProtocol !== "https:") {
    console.error("PLAID_REDIRECT_URI must use https:// in production.");
    process.exit(1);
  }
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  port: env.PORT,
  appOrigin: new URL(env.APP_ORIGIN).origin,
  plaidClientId: env.PLAID_CLIENT_ID,
  plaidSecret: env.PLAID_SECRET,
  plaidEnv: env.PLAID_ENV,
  plaidRedirectUri: env.PLAID_REDIRECT_URI || undefined,
  sessionSigningSecret: env.SESSION_SIGNING_SECRET,
  tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
  adminPasswordHash: env.ADMIN_PASSWORD_HASH,
  sessionTtlMs: env.SESSION_TTL_MINUTES * 60 * 1000
};
