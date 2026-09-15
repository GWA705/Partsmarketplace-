import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Minimum a dealer password must clear. Deliberately about length, not
 *  character classes — length is what actually helps. */
export function passwordProblem(plain: string): string | null {
  if (plain.length < 12) return 'Use at least 12 characters.';
  if (/^\s|\s$/.test(plain)) return 'Remove the leading or trailing space.';
  return null;
}
