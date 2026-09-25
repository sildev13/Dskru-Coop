import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [algorithm, n, r, p, salt, key] = hash.split("$");
  if (
    algorithm !== "scrypt" ||
    n !== "131072" ||
    r !== "8" ||
    p !== "1" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(key || "")
  )
    return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(key, "hex"));
}
export const dummyHash = `scrypt$131072$8$1$${"0".repeat(32)}$${"0".repeat(128)}`;
