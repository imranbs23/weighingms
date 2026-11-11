/**
 * The Prepare panel — the lot and the container before the pour (bolt 031).
 *
 * ══════════════════════════════════════════════════════════════════════
 * ENTER IS A SCAN. THE BUTTON IS KEYED. THE SERVER DECIDES THE REST.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PreparePanel } from '../../src/007-weighingms-ui/screens/weigh/PreparePanel.js';

const t = (key: string): string => key;

function panel(overrides: Partial<Parameters<typeof PreparePanel>[0]> = {}) {
  const onLot = vi.fn();
  const onContainer = vi.fn();
  render(
    <PreparePanel
      needsLot
      needsContainer
      busy={false}
      t={t}
      onLot={onLot}
      onContainer={onContainer}
      {...overrides}
    />,
  );
  return { onLot, onContainer };
}

describe('the Prepare panel', () => {
  it('asks for the lot and the container while neither is captured', () => {
    panel();
    expect(screen.getByTestId('prepare-lot-input')).toBeTruthy();
    expect(screen.getByTestId('prepare-container-input')).toBeTruthy();
  });

  it('asks only for what is still missing', () => {
    panel({ needsLot: false });
    expect(screen.queryByTestId('prepare-lot-input')).toBeNull();
    expect(screen.getByTestId('prepare-container-input')).toBeTruthy();
  });

  it('is gone once both are captured', () => {
    const { container } = render(
      <PreparePanel
        needsLot={false}
        needsContainer={false}
        busy={false}
        t={t}
        onLot={() => undefined}
        onContainer={() => undefined}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('ENTER sends a SCAN — a barcode wedge ends its code with Enter', () => {
    const { onContainer } = panel();
    const input = screen.getByTestId('prepare-container-input');
    fireEvent.change(input, { target: { value: 'C-12' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onContainer).toHaveBeenCalledWith({ kind: 'SCAN', value: 'C-12' });
  });

  it('the BUTTON sends a KEYED value', () => {
    const { onLot } = panel();
    fireEvent.change(screen.getByTestId('prepare-lot-input'), {
      target: { value: '2026-0112' },
    });
    fireEvent.click(screen.getByTestId('prepare-lot-submit'));
    expect(onLot).toHaveBeenCalledWith({ kind: 'KEYED', value: '2026-0112' });
  });

  it('validates NOTHING itself — an empty value goes to the server, which refuses it', () => {
    const { onLot } = panel();
    fireEvent.click(screen.getByTestId('prepare-lot-submit'));
    expect(onLot).toHaveBeenCalledWith({ kind: 'KEYED', value: '' });
  });

  it('is inert while a request is in flight', () => {
    panel({ busy: true });
    expect((screen.getByTestId('prepare-lot-submit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('prepare-container-input') as HTMLInputElement).disabled).toBe(true);
  });
});
