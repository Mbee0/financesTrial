import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { config } from "./config.js";
import {
  buildPlaidClient,
  createPlaidLinkToken,
  exchangePublicToken,
  fetchAccountBalances,
  removePlaidItem
} from "./plaidClient.js";
import { createSessionId, decryptSecret, encryptSecret } from "./security/crypto.js";
import { verifyPassword } from "./security/password.js";

const app = express();
const plaidClient = buildPlaidClient(config);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const SESSION_COOKIE_NAME = "secure_budget_sid";
const sessionStore = new Map();

const cookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: "lax",
  signed: true,
  path: "/",
  maxAge: config.sessionTtlMs
};

const loginBodySchema = z.object({
  password: z.string().min(12).max(256)
});

const exchangeBodySchema = z.object({
  publicToken: z.string().min(1).max(512)
});

app.disable("x-powered-by");
if (config.isProduction) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://cdn.plaid.com"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'", "https://*.plaid.com"],
        "frame-src": ["https://cdn.plaid.com", "https://*.plaid.com"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"]
      }
    },
    referrerPolicy: {
      policy: "no-referrer"
    }
  })
);
app.use((_, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(cookieParser(config.sessionSigningSecret));
app.use(express.json({ limit: "10kb" }));

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});
const plaidWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api", apiRateLimiter);
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const requestOrigin = req.get("origin");
  if (!requestOrigin || requestOrigin !== config.appOrigin) {
    return res.status(403).json({ error: "Invalid request origin." });
  }

  return next();
});

function createFreshSession() {
  const sessionId = createSessionId();
  const now = Date.now();
  const session = {
    id: sessionId,
    authenticated: false,
    encryptedAccessToken: undefined,
    itemId: undefined,
    createdAt: now,
    expiresAt: now + config.sessionTtlMs
  };
  sessionStore.set(sessionId, session);
  return session;
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    signed: true,
    path: "/"
  });
}

function getOrCreateSession(req, res) {
  const now = Date.now();
  const sessionId = req.signedCookies[SESSION_COOKIE_NAME];
  const existingSession = sessionId ? sessionStore.get(sessionId) : undefined;

  if (!existingSession || existingSession.expiresAt <= now) {
    if (existingSession?.id) {
      sessionStore.delete(existingSession.id);
    }
    const newSession = createFreshSession();
    res.cookie(SESSION_COOKIE_NAME, newSession.id, cookieOptions);
    return newSession;
  }

  existingSession.expiresAt = now + config.sessionTtlMs;
  res.cookie(SESSION_COOKIE_NAME, existingSession.id, cookieOptions);
  return existingSession;
}

function destroySession(req, res) {
  const sessionId = req.signedCookies[SESSION_COOKIE_NAME];
  if (sessionId) {
    sessionStore.delete(sessionId);
  }
  clearSessionCookie(res);
}

function rotateSessionForLogin(req, res) {
  const currentSessionId = req.signedCookies[SESSION_COOKIE_NAME];
  if (currentSessionId) {
    sessionStore.delete(currentSessionId);
  }

  const newSession = createFreshSession();
  newSession.authenticated = true;
  newSession.expiresAt = Date.now() + config.sessionTtlMs;
  res.cookie(SESSION_COOKIE_NAME, newSession.id, cookieOptions);
  req.sessionData = newSession;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessionStore.entries()) {
    if (session.expiresAt <= now) {
      sessionStore.delete(id);
    }
  }
}

setInterval(cleanupExpiredSessions, 5 * 60 * 1000).unref();

function withSession(req, res, next) {
  req.sessionData = getOrCreateSession(req, res);
  next();
}

function requireAuth(req, res, next) {
  if (!req.sessionData.authenticated) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return next();
}

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function parsePlaidError(error) {
  const plaidStatus = error?.response?.status;
  const plaidCode = error?.response?.data?.error_code;
  if (plaidStatus || plaidCode) {
    console.error("Plaid API error:", { plaidStatus, plaidCode });
  } else {
    console.error("Unexpected server error:", {
      name: error?.name,
      message: error?.message
    });
  }
  return { message: "Unable to complete this request safely right now." };
}

app.use("/api", withSession);

app.get("/api/auth/session", (req, res) => {
  res.json({
    authenticated: req.sessionData.authenticated,
    connected: Boolean(req.sessionData.encryptedAccessToken)
  });
});

app.post(
  "/api/auth/login",
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid login request." });
    }

    const validPassword = verifyPassword(parsed.data.password, config.adminPasswordHash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    rotateSessionForLogin(req, res);

    return res.json({
      authenticated: true
    });
  })
);

app.post("/api/auth/logout", requireAuth, (req, res) => {
  destroySession(req, res);
  return res.json({ authenticated: false });
});

app.get(
  "/api/plaid/link-token",
  requireAuth,
  asyncHandler(async (req, res) => {
    const linkToken = await createPlaidLinkToken(plaidClient, {
      userId: req.sessionData.id,
      redirectUri: config.plaidRedirectUri
    });

    return res.json({ linkToken });
  })
);

app.post(
  "/api/plaid/exchange-public-token",
  requireAuth,
  plaidWriteLimiter,
  asyncHandler(async (req, res) => {
    const parsed = exchangeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid token exchange payload." });
    }

    const { accessToken, itemId } = await exchangePublicToken(plaidClient, parsed.data.publicToken);
    req.sessionData.encryptedAccessToken = encryptSecret(accessToken, config.tokenEncryptionKey);
    req.sessionData.itemId = itemId;

    return res.json({ connected: true });
  })
);

app.post(
  "/api/plaid/disconnect",
  requireAuth,
  plaidWriteLimiter,
  asyncHandler(async (req, res) => {
    if (!req.sessionData.encryptedAccessToken) {
      return res.json({ connected: false });
    }

    const accessToken = decryptSecret(req.sessionData.encryptedAccessToken, config.tokenEncryptionKey);
    try {
      await removePlaidItem(plaidClient, accessToken);
    } catch (error) {
      parsePlaidError(error);
    }

    req.sessionData.encryptedAccessToken = undefined;
    req.sessionData.itemId = undefined;
    return res.json({ connected: false });
  })
);

app.get(
  "/api/dashboard",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.sessionData.encryptedAccessToken) {
      return res.json({ connected: false, accounts: [] });
    }

    const accessToken = decryptSecret(req.sessionData.encryptedAccessToken, config.tokenEncryptionKey);
    const accounts = await fetchAccountBalances(plaidClient, accessToken);

    return res.json({
      connected: true,
      accounts,
      syncedAt: new Date().toISOString()
    });
  })
);

app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

app.use(express.static(publicDir));

app.use((err, _req, res, _next) => {
  parsePlaidError(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(config.port, () => {
  console.log(`Secure budget dashboard running on ${config.appOrigin}`);
});
