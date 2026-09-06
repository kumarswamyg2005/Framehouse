import { hash, verify } from '@node-rs/argon2'

// argon2id at the OWASP-recommended floor (m=19 MiB, t=2, p=1). These are the
// library defaults; they are written out so the cost is reviewable rather than
// implied, and so raising them later is a one-line change with a visible diff.
// @node-rs/argon2 declares Algorithm as an ambient const enum, which TypeScript
// refuses to inline under isolatedModules. 2 is Algorithm.Argon2id.
const ARGON2ID = 2

const PARAMS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

/** Used for both account passwords and gallery PINs. Output is a PHC string. */
export function hashSecret(plain: string): Promise<string> {
  return hash(plain, PARAMS)
}

/**
 * Constant-time comparison is handled inside argon2. A malformed or corrupt
 * stored hash resolves to false rather than throwing, so a bad row cannot turn
 * a failed login into a 500 that distinguishes it from a good one.
 */
export async function verifySecret(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, PARAMS)
  } catch {
    return false
  }
}
