/**
 * Collect every locale key the client uses.
 *
 * A throwaway diagnostic — it prints the keys the client asks for, so the
 * bundle can be checked against them. The DYNAMIC keys (the ones built by
 * a template literal) are listed separately, because they cannot be
 * found by a literal scan.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_ROOT = 'src/007-weighingms-ui';

function sources(directory = CLIENT_ROOT) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
      continue;
    }
    if (path.endsWith('.ts') || path.endsWith('.tsx')) found.push(path);
  }
  return found;
}

const literal = new Set();
const dynamic = new Set();

for (const path of sources()) {
  const text = readFileSync(path, 'utf8');

  for (const match of text.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) {
    literal.add(match[1]);
  }
  for (const match of text.matchAll(/\bt\(\s*"([^"]+)"\s*\)/g)) {
    literal.add(match[1]);
  }
  for (const match of text.matchAll(/\bt\(\s*`([^`]+)`\s*\)/g)) {
    dynamic.add(match[1]);
  }
}

console.log('=== LITERAL KEYS ===');
for (const key of [...literal].sort()) console.log(key);
console.log(`\n(${literal.size} literal keys)`);

console.log('\n=== DYNAMIC KEYS ===');
for (const key of [...dynamic].sort()) console.log(key);
