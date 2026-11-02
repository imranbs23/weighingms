/**
 * WeightStreamController — the SSE endpoint.
 *
 * GET /api/scales/:scaleId/weight  (text/event-stream)
 *
 * ADR-008: the value crosses the wire as a JSON STRING. `"93.42"`, not
 * `93.42`. A JSON number is an IEEE-754 double in every parser, so the
 * number form would undo the domain's no-floating-point guarantee in
 * transit.
 *
 * FOUR THINGS THE FRAME DOES NOT DO
 * ---------------------------------
 *
 * 1. IT NEVER EMITS A ZERO FOR SILENCE. There is no reading event with a
 *    zero value, no "null" event, and no "no data" event carrying a
 *    weight. A consumer that has received nothing has received NOTHING.
 *    The status event carries the REASON the stream is quiet, so the
 *    consumer can say "scale gone since 07:41:02" without the stream
 *    having to invent a reading to justify the silence (S-1).
 *
 * 2. IT REPLAYS NO BACKLOG. A consumer attaching late sees readings from
 *    its attachment point onward. Replaying history would present stale
 *    readings as current.
 *
 * 3. IT DOES NOT ERROR WHEN THE SCALE GOES DOWN. The stream stays open
 *    and emits a `status` event. A client must be able to watch a scale
 *    go down and come back on ONE connection.
 *
 * 4. IT DOES NOT WAIT FOR THE SCALE TO SPEAK BEFORE OPENING. The
 *    consumer is told the CURRENT state immediately, so a scale that has
 *    never spoken says so at once rather than appearing to hang.
 */
import { Router, type Request, type Response } from 'express';
import { ScaleId } from '../../domain/value-objects/scale-id.js';
import type { ScaleModule } from '../../infrastructure/composition-root.js';
import { DummyScaleAdapter } from '../../infrastructure/adapters/dummy-scale-adapter.js';
import { scaleIdSchema } from '../schemas/scale-schemas.js';
import { SUBSCRIBER_BUFFER_LIMIT } from '../../domain/services/scale-stream-service.js';

export const SCALE_NOT_FOUND = 'SCALE_NOT_FOUND';

/** How often a heartbeat is sent, in milliseconds. */
const HEARTBEAT_INTERVAL_MS = 15_000;

export function createWeightStreamRouter(scales: ScaleModule): Router {
  const router = Router();

  router.get('/:scaleId/weight', async (req: Request, res: Response) => {
    const parsedId = scaleIdSchema.safeParse(req.params['scaleId']);
    if (!parsedId.success) {
      res.status(400).json({ error: 'VALIDATION_ERROR' });
      return;
    }

    const scaleId = ScaleId.create(parsedId.data);
    const device = scales.registry.get(scaleId);
    if (device === null) {
      res.status(404).json({ error: SCALE_NOT_FOUND });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // ── The current state, immediately ──
    // A scale that has never spoken says so at once, rather than the
    // consumer waiting in silence and concluding the stream is broken.
    //
    // The DETAIL is the weighing-block REASON — the same reason the
    // gate returns. A consumer that knows why the scale is unusable can
    // say so; one that only knows "disconnected" cannot distinguish a
    // device that never responded from one that went silent (ADR-011).
    const snapshot = device.snapshot(new Date());
    if (snapshot.kind === 'READING') {
      writeReading(res, scaleId, snapshot.reading);
    } else {
      const reason = scales.registry.canWeigh(scaleId).reason;
      writeStatus(res, 'DISCONNECTED', snapshot.since, reason);
    }

    // ── Subscribe ──
    // The buffer is BOUNDED. A subscriber that stops reading is dropped
    // and told why, rather than being allowed to grow the server's memory
    // (the design's DoS note).
    let overflowed = false;
    let pending = 0;

    const unsubscribe = scales.streams.subscribe(scaleId, (message) => {
      if (overflowed) return;
      if (pending >= SUBSCRIBER_BUFFER_LIMIT) {
        overflowed = true;
        writeStatus(res, 'DISCONNECTED', null, 'SLOW_CONSUMER');
        res.end();
        return;
      }
      pending += 1;

      if (message.kind === 'READING') {
        writeReading(res, scaleId, message.reading);
      } else {
        // A disconnection event carries the reason; a plain status frame
        // carries whatever detail it was given.
        writeStatus(res, message.status, message.since, message.detail);
      }

      pending -= 1;
    });

    // ── Start the adapter's stream, if this is the first subscriber ──
    const adapter = scales.adapters.get(scaleId.value);
    if (adapter instanceof DummyScaleAdapter) {
      void pumpAdapter(scales, scaleId, adapter);
    }

    // ── Heartbeat ──
    // Keeps the connection alive through proxies and lets the client
    // detect a dead link.
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    const close = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };

    req.on('close', close);
    req.on('error', close);
  });

  return router;
}

/**
 * Pump the adapter's readings into the registry.
 *
 * The adapter's stream is shared: it runs once per device, and every
 * reading it produces is ingested into the registry, which broadcasts to
 * the subscribers. A second subscriber attaches to the SAME registry
 * stream rather than starting a second adapter — otherwise the device
 * would emit two interleaved sequences.
 *
 * THE PUMP STOPS WHEN THE LAST SUBSCRIBER LEAVES. Without that, the
 * adapter would keep producing readings for a device nobody is watching,
 * forever — a leak that a long-running station would accumulate.
 */
async function pumpAdapter(
  scales: ScaleModule,
  scaleId: ScaleId,
  adapter: DummyScaleAdapter,
): Promise<void> {
  if (adapter.isPumping()) {
    return;
  }
  adapter.startPumping();

  try {
    for await (const reading of adapter.openStream(scaleId)) {
      // Stop when nobody is watching. The check is AFTER the yield so
      // the first reading is always delivered to the subscriber that
      // started the pump.
      if (scales.streams.subscriberCount(scaleId) === 0) {
        adapter.stop();
        return;
      }

      const accepted = scales.registry.ingestReading(scaleId, reading);
      if (accepted) {
        scales.streams.publishReading(scaleId, reading);
      }
    }
  } catch {
    // The adapter's stream ended. Nothing to do — the device is simply
    // silent, and the watchdog will notice.
  }
}

/**
 * Write a reading frame.
 *
 * ADR-008: the value is a JSON STRING.
 */
function writeReading(
  res: Response,
  scaleId: ScaleId,
  reading: {
    readonly value: { readonly text: string; readonly unit: string };
    readonly stable: boolean;
    readonly sequence: { readonly value: number };
    readonly receivedAt: Date;
  },
): void {
  const payload = {
    scaleId: scaleId.value,
    value: reading.value.text,
    unit: reading.value.unit,
    stable: reading.stable,
    sequence: reading.sequence.value,
    receivedAt: reading.receivedAt.toISOString(),
  };
  res.write(`event: reading\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** Write a status frame. */
function writeStatus(
  res: Response,
  status: string,
  since: Date | null,
  detail: string | null,
): void {
  const payload = {
    status,
    since: since === null ? null : since.toISOString(),
    detail,
  };
  res.write(`event: status\ndata: ${JSON.stringify(payload)}\n\n`);
}
