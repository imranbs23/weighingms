/**
 * Compare the locale bundle with the keys the client actually asks for.
 *
 * The bundle is the fallback chain's end, so a key the client asks for and
 * the bundle does not hold renders as the KEY ITSELF on the operator's
 * screen — a screen of `weigh.title`. This checks the two sets against each
 * other and reports both directions.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const bundle = JSON.parse(
  readFileSync('src/006-ticket-printing/locales/en.json', 'utf8'),
);

const output = execSync('node scripts/collect-locale-keys.mjs').toString();
const literalBlock = output.split('=== LITERAL KEYS ===')[1].split('=== DYNAMIC')[0];
const literal = literalBlock
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('('));

const missing = literal.filter((key) => !(key in bundle));
const unused = Object.keys(bundle).filter((key) => !literal.includes(key));

console.log(`bundle keys: ${Object.keys(bundle).length}`);
console.log(`client literal keys: ${literal.length}`);
console.log(`\nclient keys MISSING from the bundle (${missing.length}):`);
for (const key of missing) console.log(`  ${key}`);
console.log(`\nbundle keys not asked for literally (${unused.length}):`);
for (const key of unused) console.log(`  ${key}`);
