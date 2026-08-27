import { hashPassword } from "../security/password.js";

const plainText = process.argv[2];

if (!plainText || plainText.length < 12) {
  console.error("Usage: npm run hash-password -- \"your-long-password\"");
  process.exit(1);
}

const encodedHash = hashPassword(plainText);
console.log(encodedHash);
