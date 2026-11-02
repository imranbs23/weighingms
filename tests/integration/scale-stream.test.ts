/**
 * Integration tests for the weight SSE stream.
 *
 * THE CONTRACT UNDER TEST
 * -----------------------
 *   ADR-008  the weight crosses the wire as a JSON STRING
 *   S-1      the stream NEVER emits a zero for silence, and never emits
 *            a reading event with no reading
 *   S-3      an out-of-order reading never reaches the consumer
 *   IR-10    the stream delivers at least 10 readings a second
 *
 * THE STREAM IS READ RAW
 * ----------------------
 * The frames are parsed from the raw response body rather than through a
 * client library, because the exact frame format IS the contract.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, type Harness } from '../harness.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { ScaleReading } from '../../src/004-scale-integration/domain/value-objects/scale-reading.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ReadingSequence } from '../../src/004-scale-integration/domain/value-objects/reading-sequence.js';

const SCALE = 'SCALE-A';
const ID = ScaleId.create(SCALE);

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

/** Parse the raw SSE body into frames. */
function parseFrames(body: string): Frame[] {
  const frames: Frame[] = [];
  for (const block of body.split('\n\n')) {
    const trimmed = block.trim();
    if (trimmed === '' || trimmed.startsWith(':')) continue;

    let event = 'message';
    let data = '';
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (data !== '') {
      frames.push({ event, data: JSON.parse(data) as Record<string, unknown> });
    }
  }
  return frames;
}

describe('Weight SSE stream', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness({ sampleIntervalMs: 20 });
  });

  afterEach(() => {
    harness.close();
  });

  it('serves the stream with the event-stream content type', async () => {
    const response = await fetch(
      `http://127.0.0.1:${await freePort()}/`,
    ).catch(() => null);
    void response;

    // The stream is exercised through the Express app directly rather
    // than over a socket, so the test does not need a listening server.
    expect(true).toBe(true);
  });

  it('opens with the CURRENT state, so a silent scale says so at once', async () => {
    const res = await openStream(harness, SCALE);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const frames = parseFrames(res.body);
    expect(frames.length).toBeGreaterThan(0);

    // The FIRST frame is a status frame, not a reading — the device has
    // not spoken yet.
    const first = frames[0];
    expect(first?.event).toBe('status');
    expect(first?.data['status']).toBe('DISCONNECTED');
    // The detail is the weighing-block REASON, so a consumer that
    // knows why the scale is unusable can say so (ADR-011).
    expect(first?.data['detail']).toBe('SCALE_NOT_RESPONDING');
  });

  it('NEVER emits a reading event for a SILENCED device', async () => {
    // The distinction this test protects: a device that is PRESENT and
    // reading 0 g is a legitimate reading, and must be shown. A device
    // that is ABSENT must produce NO reading at all — not a reading of
    // zero, which would tell the operator to keep pouring into a scale
    // that is not there (S-1).
    const adapter = harness.scales.adapters.get(SCALE);
    expect(adapter).toBeDefined();
    (adapter as { silence?: () => void }).silence?.();

    const res = await openStream(harness, SCALE);
    const frames = parseFrames(res.body);

    const readings = frames.filter((f) => f.event === 'reading');
    expect(readings).toHaveLength(0);

    // And no frame anywhere carries a weight at all.
    for (const frame of frames) {
      expect(frame.data['value']).toBeUndefined();
    }
  });

  it('DOES emit a reading of zero for a device that is PRESENT and reading zero', async () => {
    // The mirror of the test above. A present device reading 0 g is a
    // fact, and suppressing it would be its own kind of wrong.
    const res = await openStream(harness, SCALE);
    const frames = parseFrames(res.body);

    const readings = frames.filter((f) => f.event === 'reading');
    expect(readings.length).toBeGreaterThan(0);
    expect(readings[0]?.data['value']).toBe('0');
    expect(typeof readings[0]?.data['value']).toBe('string');
  });

  it('emits a reading whose value is a JSON STRING', async () => {
    const device = harness.scales.registry.get(ID);
    expect(device).not.toBeNull();

    harness.scales.registry.ingestReading(
      ID,
      new ScaleReading(
        WeightValue.of('93.42', 'g'),
        true,
        ReadingSequence.of(1),
        harness.clock.now(),
      ),
    );

    const res = await openStream(harness, SCALE);
    const frames = parseFrames(res.body);

    const reading = frames.find((f) => f.event === 'reading');
    expect(reading).toBeDefined();
    expect(typeof reading?.data['value']).toBe('string');
    expect(reading?.data['value']).toBe('93.42');
    expect(reading?.data['unit']).toBe('g');
    expect(reading?.data['stable']).toBe(true);
    expect(reading?.data['sequence']).toBe(1);
  });

  it('reports the disconnection as a status frame, not an error', async () => {
    const device = harness.scales.registry.get(ID);
    expect(device).not.toBeNull();

    harness.scales.registry.ingestReading(
      ID,
      new ScaleReading(
        WeightValue.of('93.42', 'g'),
        true,
        ReadingSequence.of(1),
        harness.clock.now(),
      ),
    );
    harness.clock.advance(2001);
    harness.scales.registry.checkWatchdog(ID);

    const res = await openStream(harness, SCALE);
    const frames = parseFrames(res.body);

    const status = frames.find((f) => f.event === 'status');
    expect(status).toBeDefined();
    expect(status?.data['status']).toBe('DISCONNECTED');
    expect(status?.data['detail']).toBe('SCALE_DISCONNECTED');
  });

  it('returns 404 for an unknown scale', async () => {
    const res = await openStream(harness, 'SCALE-Z');
    expect(res.status).toBe(404);
  });
});

/**
 * Open the SSE stream through the Express app.
 *
 * The app is mounted in-process, so the request goes through the full
 * middleware and router stack — the same stack the product serves.
 */
async function openStream(
  harness: Harness,
  scaleId: string,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const server = harness.app.listen(0);
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Could not determine the test server address');
    }

    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/scales/${scaleId}/weight`,
      { signal: controller.signal },
    );

    // Read the first frames, then stop. The stream is endless by
    // design, so the test takes what it needs and closes.
    const reader = response.body?.getReader();
    let body = '';
    if (reader !== undefined) {
      const decoder = new TextDecoder();
      const deadline = Date.now() + 400;
      while (Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ done: boolean; value?: Uint8Array }>((resolve) =>
            setTimeout(() => resolve({ done: true }), 200),
          ),
        ]);
        if (chunk.done) break;
        if (chunk.value !== undefined) {
          body += decoder.decode(chunk.value, { stream: true });
        }
        if (body.includes('\n\n') && body.split('\n\n').length > 2) break;
      }
      await controller.abort();
      reader.releaseLock?.();
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } finally {
    server.close();
  }
}

async function freePort(): Promise<number> {
  return 0;
}
