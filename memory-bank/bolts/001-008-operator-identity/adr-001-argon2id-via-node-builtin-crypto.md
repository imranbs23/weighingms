---
bolt: 001-008-operator-identity
created: 2026-10-30T12:00:00Z
status: accepted
superseded_by: null
---

# ADR-001: Use Argon2id from Node's built-in `crypto` for credential hashing

## Context

The project tech stack (`memory-bank/standards/tech-stack.md`) states that the
credential store uses "**password hashing with a memory-hard KDF**" — but it
does not name a specific algorithm, and it does not specify which
implementation. The tech stack is therefore silent on a decision that lands
directly on the credential path, which is the compliance-critical surface of
the whole product (BRD NFR-12: "credentials never shared between roles").

This is not a decision the standards already cover; it is a gap in them. It
also has to satisfy several constraints at once:

- The KDF must be **memory-hard**. A fast general-purpose hash (SHA-256,
  MD5) is trivially brute-forced from a stolen credential table, so the
  story and the unit brief both make the memory-hard property mandatory.
- The project must run on **Windows, Linux and macOS** with no container
  orchestration and no cloud dependency, and must build without a native
  toolchain (the stack's promise that it is "self-contained and
  demonstrable offline").
- The credential path should not carry **third-party native code**, because
  a defect there is a compliance breach rather than a usability bug.
- The project uses **npm** and its dependencies are auditable. Every
  dependency on the credential path is supply-chain surface.

Two candidate implementations were probed against the actual environment
rather than assumed — `scripts/probe-kdf.cjs` and
`scripts/probe-argon2-sig.cjs`:

| Candidate | Availability | Cost | Notes |
|---|---|---|---|
| `argon2` (npm package) | **not installed**; would need a native build | — | Native compile required |
| `argon2-cffi` (npm package) | not installed | — | Native compile required |
| `scrypt` (Node built-in) | available | ~42 ms, 16 MiB memory cost | Memory-hard, but not the modern default |
| `argon2id` (Node built-in) | available | ~55 ms, 19 MiB memory cost | RFC 9106 / OWASP recommended profile |

Node 26 exposes `crypto.argon2Sync`, which provides Argon2id with **no npm
package and no native build step**. The probe confirmed the built-in path
produces a deterministic 32-byte digest for a given salt, a different digest
for a different salt, and a different digest for a wrong password — the
three properties the credential store depends on.

## Decision

Use **Argon2id** via Node's built-in `crypto.argon2Sync`, with the OWASP
recommended profile:

```text
memory       = 19456 KiB (19 MiB)
passes       = 2
parallelism  = 1
tagLength    = 32 bytes
salt         = 16 random bytes per credential (crypto.randomBytes)
```

The KDF is accessed **only** through the `SecretHasher` port
(`domain/ports/secret-hasher.ts`), implemented by
`infrastructure/security/argon2-secret-hasher.ts`. No other file in the
project calls a hashing function, and no other file sees a plaintext
secret.

The stored `credentials.secret_hash` column holds a **self-describing
encoded string** containing the algorithm, the parameters and the salt
alongside the digest — so the cost can be raised later without invalidating
existing credentials, which the `SecretHash` value object requires
(`algorithm` and `parameters` are properties of the value, per the Stage 1
domain model).

### The API trap, recorded deliberately

Node's `crypto.argon2Sync(algorithm, parameters)` uses **different
parameter names** from every common npm argon2 package:

| Field | Node built-in | `argon2` npm package |
|-------|---------------|----------------------|
| password | `message` (Buffer) | `password` |
| salt | `nonce` (Buffer) | `salt` |
| memory | `memory` (KiB) | `memoryCost` |
| iterations | `passes` | `timeCost` |
| parallelism | `parallelism` | `parallelism` |
| output length | `tagLength` | `hashLength` |
| variant | first positional argument | `type` in options |

Using the npm package's names against Node's API fails with a misleading
error about the "algorithm" argument, because the first positional argument
is the *variant*, not the password. This is recorded here because the next
developer will hit it.

## Rationale

**Why Argon2id over scrypt.** Both are memory-hard and both would satisfy the
story. Argon2id is the current recommendation (RFC 9106, OWASP) because it
resists both side-channel and time-memory trade-off attacks, and it is
resistant to GPU acceleration. scrypt remains acceptable but is the older
recommendation. Given that this unit's whole reason to exist is the
security requirement, the modern default is the right default — the
difference in effort is trivial here because both are built in.

**Why the built-in over the npm package.** Three reasons, in order:

1. **No native build step.** The `argon2` and `argon2-cffi` packages require
   a compiler or prebuilt binaries at install time. The tech stack promises
   the product runs on Windows, Linux and macOS with no external
   dependencies; a native build on the credential path is a portability
   risk for no security gain.
2. **No third-party code in the credential path.** The credential path is
   the one place in the product where a defect is a compliance breach
   (BRD NFR-12) rather than a usability bug. Reducing its dependency
   surface to "Node itself" is a proportionate response to that.
3. **No supply-chain surface.** One fewer package to audit, pin and update
   on the most sensitive path in the system.

**Why not a fast general-purpose hash.** SHA-256 with a salt is not
memory-hard. A stolen credential table could be brute-forced at billions of
hashes per second on commodity hardware. The story explicitly forbids this:
"A fast general-purpose hash (SHA-256, MD5) would be trivially brute-forced
from a stolen database, so the KDF must be deliberately expensive per
guess."

**Why the cost is not hidden behind a constant.** The 19 MiB / 2-pass cost
is applied uniformly to every credential. It is not reduced for
"known" operators, and there is no fast path.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| `argon2` npm package | Widely used; familiar API | Native build step; third-party native code on the credential path; extra supply-chain surface | No security gain over the built-in, and it breaks the stack's portability promise |
| `argon2-cffi` npm package | Same algorithm; Python interop | Native build step; CFFI bridge is an extra failure surface | Same as above |
| `scrypt` (Node built-in) | Memory-hard; no dependency; 16 MiB cost | Older recommendation; weaker against GPU/ASIC acceleration than Argon2id | Acceptable, but Argon2id is available at the same cost with no dependency, so there is no reason to take the older option |
| `bcrypt` | Well understood, widely deployed | **Not memory-hard**; fixed 72-byte input limit; slow in the wrong way (CPU-bound, not memory-bound) | Fails the memory-hard requirement |
| `pbkdf2` (Node built-in) | No dependency; FIPS-adjacent | Iterative, not memory-hard; brute-forceable at high rate | Fails the memory-hard requirement |
| SHA-256 + per-credential salt | Trivial to implement | **Not memory-hard**; brute-forceable at billions/sec | Explicitly forbidden by the story |
| Plaintext passwords | Simplest possible | A stolen database yields every credential directly | Explicitly forbidden by the story and by BRD NFR-12 |

## Consequences

### Positive

- The credential path has **zero third-party dependencies** — only Node's own
  `crypto` module.
- The project installs and runs on Windows, Linux and macOS with **no
  native toolchain**, honouring the tech stack's self-contained promise.
- Argon2id is the **current recommended** memory-hard KDF (RFC 9106 / OWASP).
- The stored hash is **self-describing**, so the work factor can be raised
  later without invalidating existing credentials.
- The `SecretHasher` port means a future algorithm change touches **one
  file**, and a future `DIRECTORY` provider (Q-08) would not touch the
  hashing policy at all.

### Negative

- **Node's API is not the npm package's API.** The parameter names differ,
  and the failure mode is misleading. Mitigated by confining the call to
  one adapter file and recording the mapping in this ADR.
- The argon2 API is **younger and less widely used** than the npm package's,
  so there is less community-written code demonstrating correct usage.
- `crypto.argon2Sync` is **synchronous**. At ~55 ms per hash it blocks the
  event loop. Mitigated by the fact that sign-in is a once-per-shift
  operation, and by the constant-work guarantee (see below) which requires
  the verification to happen on every attempt anyway. **If sign-in volume
  ever grows to the point where this blocks other requests, the mitigation
  is a worker thread, not a weaker KDF.**
- Argon2id at 19 MiB per verification means **concurrent sign-in attempts
  each hold 19 MiB**. On a single-station terminal this is not a concern;
  on a larger deployment it would be.

### Risks

- **Risk: the timing-based enumeration defence depends on this KDF's cost
  being uniform.** If a future change made the "no such operator" path
  cheaper than the "wrong password" path, the endpoint would become an
  identity oracle. *Mitigation*: the constant-work guarantee is implemented
  in one place (`LocalIdentityProvider`) and enforced by a test in the
  bolt's test stage, not by inspection.
- **Risk: the work factor is set at 19 MiB and never reviewed.** As hardware
  improves, the memory-hard requirement should be re-examined. *Mitigation*:
  the hash is self-describing, so the parameters can be raised by changing
  one constant; existing credentials keep verifying.
- **Risk: a dependency-policy change later adds `argon2` to the project for
  unrelated reasons, creating two Argon2 implementations.** *Mitigation*:
  this ADR, and the decision index, state that the credential path uses the
  built-in only.

## Related

- **Stories**: `001-sign-in-at-terminal`
- **Bolt**: `001-008-operator-identity` (unit `008-operator-identity`)
- **Requirements**: FR-18, FR-21 · BRD NFR-12, BRD FR-34
- **Standards**: `memory-bank/standards/tech-stack.md` — **should be updated**
  to name Argon2id and record that the built-in is used. The stack currently
  says only "a memory-hard KDF", which is the gap this ADR closes.
- **Previous ADRs**: none
