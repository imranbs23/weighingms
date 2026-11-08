/**
 * ConfigurationController — the effective configuration, and the change.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CONFIGURATION CHANGE IS A SUPERVISOR'S ACT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A change that alters what a weighing means is exactly the kind of act
 * that needs one — and the story's actor is *"a dyehouse supervisor"*.
 *
 * **And the role comes from the SESSION's operator** — never from the
 * request.
 *
 * **And the body carries the value, the category, the scope and the
 * reason** — and **not** the actor, the role, the version, the previous
 * value or the effective-from. Those are derived or assigned (ADR-045).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { TicketModule } from '../../infrastructure/composition-root.js';
import {
  CONFIGURATION_CATEGORIES,
  ConfigurationCategory,
} from '../../domain/entities/configuration.js';

export const SUPERVISOR_REQUIRED = 'SUPERVISOR_REQUIRED';
export const REASON_REQUIRED = 'REASON_REQUIRED';
export const SCOPE_NOT_FOUND = 'SCOPE_NOT_FOUND';
export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

/**
 * The change's body.
 *
 * **The value, the category, the scope and the reason** — and nothing
 * else. The actor, the role, the version, the previous value and the
 * effective-from are all derived or assigned by the store.
 */
const changeSchema = z.object({
  value: z.string().trim().min(1, 'a value is required').max(1024),
  category: z.enum(CONFIGURATION_CATEGORIES),
  /** What the override applies to — `null` for a global change. */
  scope: z.string().trim().min(1).max(128).nullish(),
  /** The justification — **mandatory**. */
  reason: z.string().trim().min(1, 'a reason is required').max(1000),
});

/** The key — a bounded string, because the key set is not closed. */
const keySchema = z.string().trim().min(1).max(128);

export function createConfigurationRouter(
  tickets: TicketModule,
): Router {
  const router = Router();

  /**
   * GET /api/configuration — the effective configuration.
   *
   * Every entry carries its key, value, category, update time, updating
   * actor and version.
   *
   * **And the READ is a supervisor's act too** — the same role check as
   * the change, because the effective configuration says what tolerances
   * the station is applying and who changed them, and that is a
   * supervisor's record (ADR-045).
   */
  router.get('/', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    if (!req.currentOperator.isSupervisor()) {
      res.status(403).json({ error: SUPERVISOR_REQUIRED });
      return;
    }

    const entries = await tickets.configuration.all();

    res.status(200).json({
      entries: entries.map((entry: {
        readonly key: { readonly value: string };
        readonly value: { readonly value: string };
        readonly category: { readonly value: string };
        readonly version: number;
        readonly effectiveFrom: { toDate(): Date };
        readonly actorId: string;
        readonly updatedAt: { toDate(): Date };
      }) => ({
        key: entry.key.value,
        value: entry.value.value,
        category: entry.category.value,
        version: entry.version,
        effectiveFrom: entry.effectiveFrom.toDate().toISOString(),
        actorId: entry.actorId,
        updatedAt: entry.updatedAt.toDate().toISOString(),
      })),
    });
  });

  /**
   * PUT /api/configuration/:key — the change.
   *
   * 200 — the value was changed.
   * 400 — the body is not a change.
   * 403 — the operator is not a supervisor.
   * 404 — the scope does not exist.
   * 422 — the reason is missing.
   */
  router.put('/:key', async (req: Request, res: Response) => {
    if (req.currentOperator === undefined) {
      res.status(401).json({ error: UNAUTHENTICATED });
      return;
    }

    // THE ROLE. From the SESSION.
    if (!req.currentOperator.isSupervisor()) {
      res.status(403).json({ error: SUPERVISOR_REQUIRED });
      return;
    }

    const parsedKey = keySchema.safeParse(req.params['key']);
    if (!parsedKey.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: VALIDATION_ERROR });
      return;
    }

    const outcome = await tickets.setConfiguration.execute(
      parsedKey.data,
      ConfigurationCategory.of(parsed.data.category),
      parsed.data.value,
      parsed.data.reason,
      req.currentOperator.id.value,
      req.currentOperator.role.value,
      parsed.data.scope ?? null,
    );

    if (outcome.kind === 'REASON_REQUIRED') {
      res.status(422).json({ error: REASON_REQUIRED });
      return;
    }

    if (outcome.kind === 'SCOPE_NOT_FOUND') {
      res.status(404).json({ error: SCOPE_NOT_FOUND });
      return;
    }

    res.status(200).json({
      key: outcome.version.key.value,
      value: outcome.version.value.value,
      category: outcome.version.category.value,
      version: outcome.version.version,
      effectiveFrom: outcome.version.effectiveFrom.toDate().toISOString(),
      previousValue: outcome.version.previousValue?.value ?? null,
      actorId: outcome.version.actorId,
    });
  });

  return router;
}

/**
 * LocaleController — one operator-facing string.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE FALLBACK IS PER KEY. AND NO REQUEST FAILS.
 * ══════════════════════════════════════════════════════════════════════
 */
export function createLocaleRouter(tickets: TicketModule): Router {
  const router = Router();

  /**
   * GET /api/locale/:locale/:key — one string.
   *
   * 200 — the string, or the **fallback**. **Never a failure.**
   */
  router.get('/:locale/:key', async (req: Request, res: Response) => {
    const locale = req.params['locale'] as string;
    const key = req.params['key'] as string;

    const value = await tickets.resolveString.execute(locale, key);

    res.status(200).json({ locale, key, value });
  });

  return router;
}
