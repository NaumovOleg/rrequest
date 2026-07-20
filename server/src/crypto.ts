import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function keyOf(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(blob: string, secret: string): string {
  const [ivB64, tagB64, encB64] = blob.split(".");
  const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
}
