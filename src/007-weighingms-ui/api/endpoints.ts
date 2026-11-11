/**
 * The endpoints — the typed calls the SPA makes.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE WIRE SHAPES ARE DECLARED HERE, AND THEY HOLD NO VALUES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * These types describe what the **server** sends. They contain no batch,
 * no recipe, no component, no weight and no lot — because **every such
 * value arrives over the API** (BRD IR-07, workbook Rule 5).
 *
 * And the client's methods are the two the story names — the queue and the
 * selection — plus the locale lookup.
 */
import { call, type ApiResult } from './client.js';

/** One released batch, as the server sends it. */
export interface QueueBatch {
  readonly batchId: string;
  readonly orderRef: string;
  readonly machineRef: string;
  /** `null` when the MES gave none — the client renders its placeholder. */
  readonly fabricDescription: string | null;
  readonly shadeCode: string;
  readonly componentCount: number;
  readonly weighingStatus: string;
}

/** The queue, as the server sends it. */
export interface BatchQueue {
  readonly batches: readonly QueueBatch[];
  /** When the queue was received — **a server value**, displayed as received. */
  readonly receivedAt: string;
  readonly source: string;
  readonly freshness: { readonly kind: string };
  /** The filter that was applied — `null` means "All". */
  readonly filter: { readonly status: string } | null;
  /** The statuses the operator may filter to. */
  readonly statuses: readonly string[];
}

/** The selection, as the server sends it. */
export interface BatchSelection {
  readonly batchId: string;
  readonly method: string;
  readonly operatorId: string;
  readonly selectedAt: string;
}

/**
 * The queue — optionally filtered by status.
 *
 * **And the filter is the SERVER's**, because the story says the filter is
 * a *view* over the fetched queue and the API already owns the statuses
 * the operator may filter to.
 */
export async function fetchQueue(
  status?: string,
): Promise<ApiResult<BatchQueue>> {
  const query =
    status === undefined || status === ''
      ? ''
      : `?status=${encodeURIComponent(status)}`;
  return call<BatchQueue>(`/api/batch-queue${query}`);
}

/**
 * Select a batch — **by touch**.
 *
 * The body carries the batch id and **nothing else**. The operator comes
 * from the session, and the **method is derived** by the server from the
 * request's shape (ADR-030).
 */
export async function selectByTouch(
  batchId: string,
): Promise<ApiResult<{ selection: BatchSelection }>> {
  return call<{ selection: BatchSelection }>('/api/selection', {
    method: 'POST',
    body: JSON.stringify({ batchId }),
  });
}

/**
 * Select a batch — **by scan**.
 *
 * **The same endpoint and the same action** — only the body's shape
 * differs, and the server derives the method from it.
 */
export async function selectByScan(
  code: string,
): Promise<ApiResult<{ selection: BatchSelection }>> {
  return call<{ selection: BatchSelection }>('/api/selection', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/**
 * One operator-facing string, in the given language.
 *
 * **And it never throws** — a missing string falls back, and the fallback
 * is the key itself (NFR-7).
 */
export async function fetchString(
  locale: string,
  key: string,
): Promise<string> {
  const result = await call<{ value: string }>(
    `/api/locale/${encodeURIComponent(locale)}/${encodeURIComponent(key)}`,
  );

  if (result.kind === 'OK') return result.body.value;
  // The fallback is the KEY — a defined, diagnosable answer, and no request
  // fails.
  return key;
}

/** The session's state — and its component states. */
export interface SessionSnapshot {
  readonly sessionId: string;
  readonly batchId: string;
  readonly operatorId: string;
  readonly state: string;
  readonly activeComponentId: string | null;
  readonly selectedScaleId: string | null;
  readonly currentWeight: string | null;
  readonly weightUnit: string | null;
  readonly weightStable: boolean;
  readonly weightStale: boolean;
  readonly components: readonly {
    readonly componentId: string;
    readonly state: string;
  }[];
  readonly counter: { readonly weighed: number; readonly total: number };
  /**
   * The active component's lot and container, as captured IN THIS SESSION
   * — the station's answer, so a capture from an earlier batch never shows
   * (bolt 031). Absent from an older API.
   */
  readonly activeCaptures?: ComponentCaptures;
}

/** A component's lot and container, as the station reports them. */
export interface ComponentCaptures {
  readonly lot: { readonly lotNumber: string; readonly method: string } | null;
  readonly container: {
    readonly containerId: string;
    readonly tareWeight: string;
    readonly tareUnit: string;
    readonly tareSource: string;
  } | null;
}

/**
 * Capture the lot for a component (unit 002).
 *
 * A **scan** sends `code`, a typed value sends `lotNumber`: the method is
 * derived from the request's shape on the server, never asserted (ADR-030).
 */
export async function captureLot(
  componentId: string,
  input: { readonly code: string } | { readonly lotNumber: string },
): Promise<ApiResult<{ capture: { lotNumber: string } }>> {
  return call('/api/material-lot', {
    method: 'POST',
    body: JSON.stringify({ componentId, ...input }),
  });
}

/**
 * Assign the container for a component, on the scale the session is bound
 * to (unit 002). Its tare is the container master's, or the empty
 * container weighed on that scale — the server's, never the client's.
 */
export async function assignContainer(
  componentId: string,
  input: { readonly code: string } | { readonly containerId: string },
  scaleId: string,
): Promise<ApiResult<{ assignment: { containerId: string } }>> {
  return call('/api/container', {
    method: 'POST',
    body: JSON.stringify({ componentId, scaleId, ...input }),
  });
}

/**
 * The session's snapshot — and the recipe rail's states.
 *
 * **The component states come from the API** — the client does not decide
 * which component is `DONE` (C-08).
 */
export async function fetchSession(): Promise<
  ApiResult<{ session: SessionSnapshot | null }>
> {
  return call<{ session: SessionSnapshot | null }>('/api/session');
}

/**
 * The station's live weight — **the station's, not a client's**.
 */
export async function fetchWeight(): Promise<
  ApiResult<{
    weight: {
      readonly value: string;
      readonly unit: string;
      readonly stable: boolean;
      readonly stale: boolean;
    } | null;
  }>
> {
  return call('/api/session/weight');
}

/**
 * The zone — **computed by the domain** and returned here.
 *
 * *"No consumer — in particular no screen — computes it independently (FR-9,
 * BRD FR-16, BRD FR-17)."*
 */
export async function fetchZone(): Promise<
  ApiResult<{
    /**
     * THE ZONE — and it is **FLAT on the wire**.
     *
     * The controller answers `{ zone: "UNDER", value, unit, target,
     * tolerance, bounds, stillToWeigh }` — the zone's own name is the
     * `zone` field, not a wrapper around the whole body. And when there is
     * no zone the answer is `{ zone: null }` — **and nothing else**.
     *
     * So the value and the bounds are read from the body, and the body's
     * `zone` field says whether there IS a zone. A client that assumed a
     * nested shape would read `undefined` for every quantity.
     */
    readonly zone: string | null;
    readonly value?: string;
    readonly unit?: string;
    readonly target?: string;
    readonly tolerance?: {
      readonly min: string;
      readonly max: string;
    } | null;
    readonly bounds?: {
      readonly nearThreshold: string;
      readonly okLower: string;
      readonly okUpper: string;
    } | null;
    readonly stillToWeigh?: string;
  }>
> {
  return call('/api/session/zone');
}

/**
 * Confirm the active component.
 *
 * **The body carries the component id and NOTHING ELSE** — no zone, no
 * quantity. The zone is the domain's and the quantity is the device's, and
 *"a client that could assert either could confirm anything."*
 */
export async function confirmComponent(
  componentId: string,
): Promise<
  ApiResult<{
    record: { readonly componentId: string };
    /** The component the station advanced to — `null` at the last. */
    advancedTo?: string | null;
    /** The station's verdict that every component is confirmed. */
    batchComplete?: boolean;
  }>
> {
  return call('/api/session/confirm', {
    method: 'POST',
    body: JSON.stringify({ componentId }),
  });
}

/**
 * Select a component — the rail's action.
 *
 * **The body carries the component id and nothing else** — the operator
 * comes from the session, and the scale is the rule's.
 */
export async function selectComponent(
  componentId: string,
): Promise<ApiResult<{ session: SessionSnapshot | null }>> {
  return call('/api/session/select', {
    method: 'POST',
    body: JSON.stringify({ componentId }),
  });
}

/** The over-dose's quantities — **the detector's**, not the client's. */
export interface SurplusReport {
  readonly componentId: string;
  readonly overshoot: string;
  readonly surplusAmount: string;
  readonly unit: string;
  /** `null` at a zero target — the percentage is undefined there. */
  readonly surplusPercent: string | null;
}

export async function fetchSurplus(): Promise<
  ApiResult<{ surplus: SurplusReport | null }>
> {
  return call('/api/surplus');
}

/**
 * The proposal — **the rule's**, and every quantity a string.
 *
 * **The factor is NOT computed by the client** — the prototype carries a
 * worked example of its own, and it is correct only for that one case
 * (ADR-038). The client renders the rule's factor.
 */
export interface SurplusProposal {
  readonly proposalId: string;
  readonly componentId: string;
  readonly sessionId: string;
  readonly surplusAmount: string;
  readonly unit: string;
  readonly overshoot: string;
  readonly surplusPercent: string | null;
  /** The proportional factor — **the rule's**. */
  readonly factor: string;
  readonly status: string;
  readonly operatorId: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly reason: string | null;
  readonly recalculated: readonly {
    readonly componentId: string;
    readonly originalTarget: string;
    readonly revisedTarget: string;
  }[];
}

/** Detect the over-dose and present the proposal. */
export async function proposeSurplus(): Promise<
  ApiResult<{ proposal: SurplusProposal }>
> {
  return call('/api/surplus', { method: 'POST' });
}

/** Accept the proposal. */
export async function acceptSurplus(
  componentId: string,
): Promise<ApiResult<{ proposal: SurplusProposal }>> {
  return call('/api/surplus/accept', {
    method: 'POST',
    body: JSON.stringify({ componentId }),
  });
}

/** Decline the proposal — the batch is **held**, not confirmed. */
export async function declineSurplus(
  componentId: string,
): Promise<ApiResult<{ proposal: SurplusProposal }>> {
  return call('/api/surplus/decline', {
    method: 'POST',
    body: JSON.stringify({ componentId }),
  });
}

/** The escalation's state — `null` when there is none. */
export interface EscalationReport {
  readonly componentId: string;
  readonly sessionId: string;
  /**
   * The subject the supervisor's authorisation must name — the station's
   * own, derived on the server. The client passes it on and never composes
   * it (ADR-047).
   */
  readonly subject: string;
  readonly surplusAmount: string;
  readonly unit: string;
  readonly state: string;
  readonly authorisationId: string | null;
  readonly supervisorId: string | null;
}

export async function fetchEscalation(
  componentId: string,
): Promise<ApiResult<{ escalation: EscalationReport | null }>> {
  return call(`/api/escalation/${encodeURIComponent(componentId)}`);
}

/**
 * The supervisor's authorisation.
 *
 * **The reason is MANDATORY** — and the controller refuses an empty one.
 * And the supervisor's credentials are **not** the operator's: the
 * operator who raised the request cannot authorise it.
 */
export async function authoriseEscalation(
  authorisationId: string,
  supervisorId: string,
  secret: string,
  reason: string,
): Promise<
  ApiResult<{
    escalation?: EscalationReport;
    recordId?: string;
    auditEntry?: unknown;
  }>
> {
  return call('/api/escalation/authorise', {
    method: 'POST',
    body: JSON.stringify({
      authorisationId,
      supervisorId,
      secret,
      reason,
    }),
  });
}

/**
 * The batch summary — **the DOMAIN's**, not one reassembled by the client.
 *
 * Every quantity is a **string**, and the verdict is a **string** — the
 * client renders both as received (FR-15, BRD FR-15).
 */
export interface BatchSummary {
  readonly batchId: string;
  readonly sessionId: string;
  readonly componentsWeighed: number;
  readonly componentCount: number;
  readonly elapsedSeconds: number;
  readonly operatorId: string;
  /** The total — a fixed-point decimal **string**. */
  readonly totalDispensed: string;
  readonly unit: string;
  /**
   * The tolerance verdict — the API's own two-valued one.
   *
   * **`YES` or `NO`** — and that is the API's vocabulary, not the ticket's.
   * The ticket's `toleranceOutcome` is `WITHIN_TOLERANCE` /
   * `OUT_OF_TOLERANCE`; the summary's verdict is `YES` / `NO`, because unit
   * `003` states it as a two-valued answer (ADR-041).
   */
  readonly allWithinTolerance: string;
  readonly writeBack: string;
  readonly writeBackConfirmedAt: string | null;
  readonly releasedForTransport: boolean;
  readonly targetMachine: string;
}

export async function fetchSummary(
  batchId: string,
): Promise<ApiResult<{ summary: BatchSummary | null }>> {
  return call(
    `/api/batch/${encodeURIComponent(batchId)}/summary`,
  );
}

/**
 * The ticket — **the API's**, and the client composes no part of it.
 *
 * *"A client that assembled the ticket from its own field list would
 * freeze that list into the build and turn every template change into a
 * release"* (FR-17, BRD IR-16).
 */
export interface TicketReport {
  readonly ticketId: string;
  readonly sessionId: string;
  readonly batch: {
    readonly batchId: string;
    readonly orderRef: string;
    readonly machineRef: string;
    readonly shadeCode: string;
  };
  readonly operatorId: string;
  readonly generatedAt: string;
  readonly language: string;
  readonly templateId: string;
  readonly toleranceOutcome: string;
  readonly lines: readonly {
    readonly componentId: string;
    readonly materialCode: string;
    readonly targetQuantity: string;
    readonly targetUnit: string;
    readonly actualQuantity: string;
    readonly actualUnit: string;
    readonly lotNumber: string | null;
    readonly containerId: string | null;
    readonly scaleId: string;
    readonly zoneAtConfirm: string;
    readonly operatorId: string;
    readonly weighedAt: string;
  }[];
}

/**
 * Generate the ticket — **the API's**, and the client composes no part of it.
 *
 * **And the generation is IDEMPOTENT**: the controller answers `201` for a
 * new ticket and `200` for the one that already exists — and **the same
 * ticket** either way (BRD IR-08, C-14). So a retry after an ambiguous
 * failure succeeds rather than creating a second ticket.
 */
export async function createTicketEndpoint(): Promise<
  ApiResult<{ ticket: TicketReport }>
> {
  return call('/api/tickets', { method: 'POST' });
}

export async function fetchTicket(
  ticketId: string,
): Promise<ApiResult<{ ticket: TicketReport }>> {
  return call(`/api/tickets/${encodeURIComponent(ticketId)}`);
}

/**
 * The print job — and its state is **retrievable while it is in flight**.
 */
export interface PrintJobReport {
  readonly jobId: string;
  readonly ticketId: string;
  readonly state: string;
  readonly isReprint: boolean;
  readonly reprintOf: string | null;
  readonly reason: string | null;
  readonly attemptedAt: string;
  readonly completedAt: string | null;
  readonly error: string | null;
}

export async function printTicket(
  ticketId: string,
): Promise<ApiResult<{ job: PrintJobReport }>> {
  return call(`/api/tickets/${encodeURIComponent(ticketId)}/print`, {
    method: 'POST',
  });
}

export async function fetchPrintJob(
  jobId: string,
): Promise<ApiResult<{ job: PrintJobReport }>> {
  return call(`/api/print-jobs/${encodeURIComponent(jobId)}`);
}

/**
 * The reprint — and the body's **only** field is the reason.
 *
 * **And the reason is MANDATORY**: the controller refuses an empty one and
 * creates no print job.
 */
export async function reprintTicket(
  ticketId: string,
  reason: string,
): Promise<ApiResult<{ job: PrintJobReport; auditEntry?: unknown }>> {
  return call(`/api/tickets/${encodeURIComponent(ticketId)}/reprint`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * The devices — and each one's **status** and **link state**.
 *
 * **And the capacity** — which is what the tolerance band is scaled
 * against (FR-8).
 */
export interface ScaleReport {
  readonly scaleId: string;
  readonly label: string;
  readonly class: string;
  readonly capacity: string;
  readonly unit: string;
  /** The device's own status — the domain's vocabulary. */
  readonly status: string;
  /** The link state — and it is a REAL value, never a literal. */
  readonly link: string;
  /** `DUMMY` for the training device — the only one with training controls. */
  readonly source?: string;
}

export async function fetchScales(): Promise<
  ApiResult<{ scales: readonly ScaleReport[] }>
> {
  return call('/api/scales');
}

/**
 * The weighing gate — a question with an answer, not a failure.
 */
export async function fetchCanWeigh(
  scaleId: string,
): Promise<
  ApiResult<{
    allowed: boolean;
    reason: string | null;
    canWeigh: { readonly allowed: boolean; readonly reason: string | null };
  }>
> {
  return call(`/api/scales/${encodeURIComponent(scaleId)}/can-weigh`);
}

/**
 * The OrgaTEX link state.
 *
 * **And the un-synchronised count is reported in EVERY state** — because a
 * healthy link with a non-empty queue is a fact the operator needs.
 */
export interface LinkStateReport {
  readonly status: string;
  /**
   * THE LAST CONTACT — and it is a **timestamp**, not an age.
   *
   * The controller answers `{ status, lastContactAt, lastError,
   * consecutiveFailures, unsynchronisedCount }`. The age is **derived** by
   * the client from the timestamp and the clock — the API does not send an
   * age, and a client that expected one would read `undefined` and render
   * an age of "undefined ms".
   */
  readonly lastContactAt: string | null;
  readonly unsynchronisedCount: number;
  readonly lastError: { readonly code: string; readonly summary: string } | null;
  readonly consecutiveFailures: number;
}

export async function fetchLinkState(): Promise<
  ApiResult<LinkStateReport>
> {
  return call('/api/orgatex/link-state');
}

/**
 * The sync queue — the consumptions that have **not** landed.
 *
 * **A `FAILED` entry stays visible** with its last error and its attempt
 * count — a queue whose failures are invisible is a queue that loses data
 * quietly (BRD FR-20, FR-33).
 */
export interface SyncQueueEntry {
  readonly componentId: string;
  readonly state: string;
  readonly attempts: number;
  /**
   * THE LAST ERROR — and it is a **code and a summary**, not a sentence.
   *
   * The API's own rule: the body carries codes, and the detail goes to the
   * log (BRD NFR-11, IR-09). So the client renders the code and never the
   * detail.
   */
  readonly lastError: { readonly code: string; readonly summary: string } | null;
}

export async function fetchSyncQueue(): Promise<
  ApiResult<{ count: number; entries: readonly SyncQueueEntry[] }>
> {
  return call('/api/orgatex/sync-queue');
}

/**
 * The recipe — and the component's **name**, its dyestuff code and its
 * target.
 *
 * **The name is `null` when the MES supplied none** — and the client
 * renders its own placeholder rather than a fabricated one.
 */
export interface RecipeComponentReport {
  readonly sequence: number;
  readonly componentId: string;
  readonly dyestuffCode: string;
  readonly name: string | null;
  readonly swatchColour: string | null;
  readonly target: string;
  readonly unit: string;
  readonly tolerance: {
    readonly min: string;
    readonly max: string;
  } | null;
  readonly scaleClass: string | null;
  readonly state: string;
}

export async function fetchRecipe(
  batchId: string,
): Promise<
  ApiResult<{
    /**
     * THE RECIPE — and it is **NESTED under `recipe`** on the wire.
     *
     * The controller answers `{ recipe: { batchId, shadeCode, components,
     * counter, receivedAt, source, freshness } }` — so the recipe is read
     * from the `recipe` key, and a client that read the body directly would
     * find no components at all.
     */
    readonly recipe: {
      readonly batchId: string;
      readonly shadeCode: string;
      readonly components: readonly RecipeComponentReport[];
    };
  }>
> {
  return call(`/api/recipe/${encodeURIComponent(batchId)}`);
}

/**
 * The effective lot capture for a component — `null` when there is none.
 */
export async function fetchLot(
  componentId: string,
): Promise<
  ApiResult<{
    /**
     * THE CAPTURE — and it is `capture` on the wire, not `lot`.
     *
     * The controller answers `{ capture: null }` or
     * `{ capture: { componentId, lotNumber, materialCode, captureMethod,
     * capturedBy, capturedAt } }`.
     */
    readonly capture: { readonly lotNumber: string } | null;
  }>
> {
  return call(`/api/material-lot/${encodeURIComponent(componentId)}`);
}

/**
 * The effective container assignment for a component — `null` when there
 * is none.
 */
export async function fetchContainer(
  componentId: string,
): Promise<ApiResult<{ assignment: { containerId: string } | null }>> {
  return call(`/api/container/${encodeURIComponent(componentId)}`);
}

/**
 * The identity endpoints — the sign-in, the sign-out and the "who am I".
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE OPERATOR'S IDENTITY IS THE API's. THE CLIENT NEVER INVENTS IT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"Rendering the sign-in screen → `007-weighingms-ui`"* (unit 008), and
 * *"the signed-in operator chip in the top bar"* — so the client draws the
 * screen, and **the identity it draws is the one the API reports**.
 *
 * AND THE SIGN-IN RESPONSE IS THE ONLY PLACE A TOKEN APPEARS
 * -------------------------------------------------------
 * The token is **opaque** — it carries no operator id, no role and no
 * expiry, and it cannot be decoded to reveal one (unit 008's invariant
 * I-2). So the client cannot read "who" out of it: it asks the API.
 */

/** The operator's identity, as the API reports it. */
export interface OperatorReport {
  readonly operatorId: string;
  readonly displayName: string;
  readonly role: string;
}

/** The session — as the API reports it. */
export interface SessionReport {
  readonly sessionId: string | null;
  readonly operator: OperatorReport | null;
  readonly expiresAt: string | null;
}

/**
 * Sign in — and establish the session.
 *
 * **And the refusal is AMBIGUOUS on purpose.** The API answers every
 * credential failure with the same `AUTHENTICATION_FAILED` — unknown
 * operator, wrong secret, deactivated operator — so the client cannot
 * tell them apart, and neither can anyone watching the terminal.
 */
export async function signIn(
  operatorId: string,
  secret: string,
): Promise<ApiResult<{ token: string; operator: OperatorReport }>> {
  return call<{ token: string; operator: OperatorReport }>(
    '/api/identity/sign-in',
    {
      method: 'POST',
      body: JSON.stringify({ operatorId, secret }),
    },
  );
}

/**
 * End the session.
 *
 * **And it is IDEMPOTENT** — signing out with an unknown or already-ended
 * token answers `200`, because failing would disclose whether the token
 * was ever valid.
 */
export async function signOut(): Promise<ApiResult<{ signedOut: boolean }>> {
  return call<{ signedOut: boolean }>('/api/identity/sign-out', {
    method: 'POST',
  });
}

/**
 * Who is signed in — and the answer is the API's.
 *
 * **And `null` means "nobody"**, which is a state the client renders
 * rather than an error: the terminal may simply be between shifts.
 */
export async function fetchCurrentOperator(): Promise<
  ApiResult<SessionReport>
> {
  return call<SessionReport>('/api/identity/current');
}

/**
 * Start — or continue — a batch's weighing.
 *
 * The station decides the component and binds its scale (FR-14); the
 * client says only which batch.
 */
export async function startSession(
  batchId: string,
): Promise<ApiResult<{ session: SessionSnapshot }>> {
  return call('/api/session/start', {
    method: 'POST',
    body: JSON.stringify({ batchId }),
  });
}

/**
 * TRAINING ONLY — pour the active component onto its dummy scale.
 *
 * Only the landing is sent; the target and the band are the recipe's.
 */
export async function trainingDispense(
  landing: 'IN_TOLERANCE' | 'OVER_TOLERANCE',
): Promise<ApiResult<{ landing: string }>> {
  return call('/api/session/training/dispense', {
    method: 'POST',
    body: JSON.stringify({ landing }),
  });
}

/** Re-tare — zero the scale against what is on the platform (F2). */
export async function reTare(
  scaleId: string,
): Promise<ApiResult<{ tare: unknown }>> {
  return call(`/api/scales/${encodeURIComponent(scaleId)}/re-tare`, {
    method: 'POST',
  });
}

/**
 * Complete the batch — the station posts the consumption to OrgaTEX and
 * returns the summary with the write-back's state.
 */
export async function completeBatch(
  batchId: string,
): Promise<ApiResult<{ summary: BatchSummary }>> {
  return call(`/api/batch/${encodeURIComponent(batchId)}/complete`, {
    method: 'POST',
  });
}

/** A peripheral's own status report — the scanner's or the printer's. */
export interface PeripheralReport {
  readonly state: string;
  readonly reason?: string | null;
  readonly source: string;
}

export async function fetchScannerStatus(): Promise<
  ApiResult<PeripheralReport>
> {
  return call('/api/scanner/status');
}

/**
 * The supervisor authenticates at the terminal, and unit `008` issues an
 * authorisation for exactly this escalation's subject.
 *
 * Every refusal is the same `403` (ADR-004): a wrong PIN, an operator's
 * badge and a mismatched subject cannot be told apart.
 */
export async function requestSupervisorAuthorisation(
  supervisorId: string,
  secret: string,
  subject: string,
  reason: string,
): Promise<ApiResult<{ authorisationId: string }>> {
  return call('/api/identity/authorisations', {
    method: 'POST',
    body: JSON.stringify({
      supervisorId,
      secret,
      action: 'CONFIRM_COMPONENT',
      subject,
      reason,
    }),
  });
}

export async function fetchPrinterStatus(): Promise<
  ApiResult<PeripheralReport>
> {
  return call('/api/printer/status');
}

/**
 * Raise the supervisor override for the active component's over-dose.
 *
 * 409 when there is nothing to escalate — the zone is not OVER, or no
 * component is active.
 */
export async function raiseEscalation(
  componentId: string,
): Promise<ApiResult<{ escalation: EscalationReport }>> {
  return call('/api/escalation', {
    method: 'POST',
    body: JSON.stringify({ componentId }),
  });
}
