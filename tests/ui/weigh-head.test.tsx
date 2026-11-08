/**
 * The weigh-head and the rail's head — the prototype's content.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE OPERATOR MUST SEE **WHICH** DYESTUFF IN **WHICH** CONTAINER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The prototype shows the dyestuff's name and the meta line
 * *"DYE-4471 · LOT 2026-0387 · CONTAINER C-12 · TARE 214 g"* — and the
 * implementation must show the same, with every value **the API's**.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  WeighHead,
  RecipeRail,
} from '../../src/007-weighingms-ui/screens/weigh/components.js';

const t = (key: string): string => key;

describe('the weigh-head', () => {
  it('shows the dyestuff’s NAME — the MES’s', () => {
    render(
      <WeighHead
        name="Remazol Yellow RGB"
        dyestuffCode="DYE-4471"
        componentId="DYE-4471-Y"
        lotNumber="2026-0387"
        containerId="C-12"
        scaleLabel="3 kg precision"
        t={t}
      />,
    );

    expect(screen.getByTestId('weigh-name').textContent).toBe(
      'Remazol Yellow RGB',
    );
  });

  it('shows the META line — the code, the lot and the container', () => {
    render(
      <WeighHead
        name="Remazol Yellow RGB"
        dyestuffCode="DYE-4471"
        componentId="DYE-4471-Y"
        lotNumber="2026-0387"
        containerId="C-12"
        scaleLabel={null}
        t={t}
      />,
    );

    // The prototype's meta line: "DYE-4471 · LOT 2026-0387 · CONTAINER C-12".
    const meta = screen.getByTestId('weigh-meta').textContent ?? '';
    expect(meta).toContain('DYE-4471');
    expect(meta).toContain('2026-0387');
    expect(meta).toContain('C-12');
  });

  it('a name the MES did NOT supply renders the client’s placeholder — never a fabricated one', () => {
    render(
      <WeighHead
        name={null}
        dyestuffCode={null}
        componentId="DYE-4471-Y"
        lotNumber={null}
        containerId={null}
        scaleLabel={null}
        t={t}
      />,
    );

    expect(screen.getByTestId('weigh-name').textContent).toBe(
      'weigh.head.noName',
    );
    // And the component's own id stands in for the missing code.
    expect(screen.getByTestId('weigh-meta').textContent).toContain(
      'DYE-4471-Y',
    );
  });

  it('shows the SCALE that the rule selected', () => {
    render(
      <WeighHead
        name="Remazol Yellow RGB"
        dyestuffCode="DYE-4471"
        componentId="DYE-4471-Y"
        lotNumber={null}
        containerId={null}
        scaleLabel="32 kg floor"
        t={t}
      />,
    );

    expect(screen.getByTestId('weigh-scale').textContent).toContain(
      '32 kg floor',
    );
  });
});

describe('the rail’s head', () => {
  it('shows the shade, the batch and the COUNT weighed', () => {
    render(
      <RecipeRail
        components={[
          { componentId: 'DYE-4471-Y', state: 'DONE' },
          { componentId: 'AUX-0101', state: 'ACTIVE' },
          { componentId: 'AUX-0107', state: 'PENDING' },
        ]}
        shadeCode="Teal 4C"
        batchId="B-24187"
        weighed={2}
        total={5}
        t={t}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByTestId('rail-shade').textContent).toBe('Teal 4C');
    expect(screen.getByTestId('rail-batch').textContent).toBe('B-24187');
    // The prototype's "2 of 5 components weighed".
    expect(screen.getByTestId('rail-count').textContent).toContain('2/5');
  });
});
