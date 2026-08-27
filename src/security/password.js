import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024;
const SCRYPT_PARAMS = {
  N: 2 ** 15,
  r: 8,
  p: 1
};

export function hashPassword(plainText) {
  const salt = randomBytes(16);
  const hash = scryptSync(plainText, salt, KEY_LENGTH, {
    ...SCRYPT_PARAMS,
    maxmem: SCRYPT_MAX_MEMORY
  });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(plainText, encodedHash) {
  const [algorithm, n, r, p, saltB64, hashB64] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltB64 || !hashB64) {
    return false;
  }

  const params = {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false;
  }

  const salt = Buffer.from(saltB64, "base64");
  const expectedHash = Buffer.from(hashB64, "base64");
  const computedHash = scryptSync(plainText, salt, expectedHash.length, {
    ...params,
    maxmem: SCRYPT_MAX_MEMORY
  });

  if (computedHash.length !== expectedHash.length) {
    return false;
  }

  return timingSafeEqual(computedHash, expectedHash);
}
