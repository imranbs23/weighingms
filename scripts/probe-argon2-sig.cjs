/**
 * Determine the true argon2Sync parameter names.
 *
 * The function source names the fields it reads off `parameters`:
 *   message, nonce, parallelism, tagLength, memory, passes, secret,
 *   associatedData, type
 *
 * Those are the real parameter names — not the argon2-cffi names
 * (password/salt/memoryCost/timeCost/parallelism/hashLength/type) that
 * documentation for other libraries uses.
 */
const crypto = require('crypto');

function attempt(label, algorithm, params) {
  const t = Date.now();
  try {
    const h = crypto.argon2Sync(algorithm, params);
    const salt = params.nonce;
    const h2 = crypto.argon2Sync(algorithm, { ...params, nonce: salt });
    console.log(
      `${label}: OK len=${h.length} ms=${Date.now() - t} ` +
        `deterministic=${h2.equals(h)} buffer=${Buffer.isBuffer(h)}`
    );
    return h;
  } catch (e) {
    console.log(`${label}: FAILED - ${e.message}`);
    return null;
  }
}

const nonce = crypto.randomBytes(16);
const message = Buffer.from('secret');

console.log('--- RFC 9106 / OWASP argon2id profile: m=19456 KiB, t=2, p=1 ---');
const h = attempt('argon2id', 'argon2id', {
  message,
  nonce,
  memory: 19456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
  type: 2,
});

if (h) {
  // Salted: a different nonce must give a different hash.
  const other = attempt('argon2id (diff nonce)', 'argon2id', {
    message,
    nonce: crypto.randomBytes(16),
    memory: 19456,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
    type: 2,
  });
  console.log('salted (diff nonce -> diff hash):', other ? !other.equals(h) : 'n/a');

  // Wrong password must not verify.
  const wrong = crypto.argon2Sync('argon2id', {
    message: Buffer.from('wrong'),
    nonce,
    memory: 19456,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
    type: 2,
  });
  console.log('wrong password differs:', !wrong.equals(h));
  console.log('hex sample:', h.toString('hex').slice(0, 32), '...');
}
