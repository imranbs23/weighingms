/**
 * Probe the Node crypto KDFs available in this environment.
 *
 * Why this exists
 * ---------------
 * The tech stack says "password hashing with a memory-hard KDF" but does not
 * name one. Stage 2 of bolt 001 has to pick. Rather than pick from memory,
 * this probes what the installed Node actually supports — the API shapes have
 * changed across Node majors, and "the function exists" is not the same as
 * "the call works".
 *
 * Run: node scripts/probe-kdf.cjs
 */
const crypto = require('crypto');

function probeArgon2() {
  const out = { available: false };
  if (typeof crypto.argon2Sync !== 'function') {
    out.reason = 'crypto.argon2Sync is not a function';
    return out;
  }
  out.available = true;
  out.signature = 'argon2Sync(algorithm, password, options)';

  try {
    const salt = crypto.randomBytes(16);
    const t = Date.now();
    const hash = crypto.argon2Sync('argon2id', 'secret', {
      m: 19456, // KiB
      t: 2,
      p: 1,
      dkLen: 32,
      salt,
    });
    out.hashLength = hash.length;
    out.isBuffer = Buffer.isBuffer(hash);
    out.ms = Date.now() - t;

    const again = crypto.argon2Sync('argon2id', 'secret', {
      m: 19456,
      t: 2,
      p: 1,
      dkLen: 32,
      salt,
    });
    out.deterministic = again.equals(hash);

    // A different salt must yield a different hash — this is what stops a
    // precomputed table from applying to every credential at once.
    const otherSalt = crypto.randomBytes(16);
    const other = crypto.argon2Sync('argon2id', 'secret', {
      m: 19456,
      t: 2,
      p: 1,
      dkLen: 32,
      salt: otherSalt,
    });
    out.salted = !other.equals(hash);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

function probeScrypt() {
  const out = { available: false };
  if (typeof crypto.scryptSync !== 'function') {
    out.reason = 'crypto.scryptSync is not a function';
    return out;
  }
  out.available = true;
  try {
    const salt = crypto.randomBytes(16);
    const t = Date.now();
    const hash = crypto.scryptSync('secret', salt, 32, { N: 16384, r: 8, p: 1 });
    out.hashLength = hash.length;
    out.ms = Date.now() - t;
    out.memoryCostKiB = 16384 * 8 * 128; // N * r * 128 bytes
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

console.log('node', process.version);
console.log('argon2id:', JSON.stringify(probeArgon2(), null, 2));
console.log('scrypt:', JSON.stringify(probeScrypt(), null, 2));
