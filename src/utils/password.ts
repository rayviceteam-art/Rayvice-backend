import argon2 from 'argon2';

/**
 * Password hashing.
 *
 * Note: BACKEND-01/BACKEND-03 reference bcrypt as the baseline hashing
 * algorithm; this implementation follows the explicitly specified tech
 * stack for this task (Argon2id), which is a stronger, memory-hard KDF
 * and a strict superset of the security requirement in BACKEND-03 §2
 * ("Secure Password Hashing") and GLOBAL-RULES §9 ("Hash passwords securely").
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MB, OWASP-recommended minimum for argon2id
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return argon2.hash(plainTextPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plainTextPassword: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainTextPassword);
  } catch {
    // Malformed hash or verification failure — treat as invalid credentials, never throw.
    return false;
  }
}
