/**
 * Code 128 (code set B) — the ticket preview's barcode.
 *
 * The prototype's ticket carries a barcode of the batch id. The physical
 * label's symbology is an open question (Product Brief Q-18), so the
 * preview draws Code 128 and marks it as a training label (bolt 029,
 * human decision at the plan checkpoint: option 1).
 *
 * The encoding is the standard's: a start character, the data, a modulo-103
 * check character, and the stop pattern. Each pattern is six alternating
 * bar/space widths in modules (the stop has seven).
 */

/** Bar/space widths for symbol values 0–106, from the Code 128 standard. */
const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213',
  '122312', '132212', '221213', '221312', '231212', '112232', '122132',
  '122231', '113222', '123122', '123221', '223211', '221132', '221231',
  '213212', '223112', '312131', '311222', '321122', '321221', '312212',
  '322112', '322211', '212123', '212321', '232121', '111323', '131123',
  '131321', '112313', '132113', '132311', '211313', '231113', '231311',
  '112133', '112331', '132131', '113123', '113321', '133121', '313121',
  '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111',
  '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114',
  '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121',
  '412121', '111143', '111341', '131141', '114113', '114311', '411113',
  '411311', '113141', '114131', '311141', '411131', '211412', '211214',
  '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/** One bar: where it starts and how wide it is, in modules. */
export interface Bar {
  readonly x: number;
  readonly width: number;
}

/**
 * Encode text as Code 128-B bars.
 *
 * @returns The bars and the symbol's total width in modules — the quiet
 *          zones are the caller's.
 * @throws When a character is outside code set B (ASCII 32–126).
 */
export function code128(text: string): {
  readonly bars: readonly Bar[];
  readonly modules: number;
} {
  const values: number[] = [START_B];
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(`Code 128-B cannot encode ${JSON.stringify(character)}`);
    }
    values.push(code - 32);
  }

  // THE CHECK CHARACTER — the start's value plus each data value times its
  // position, modulo 103.
  const checksum =
    values.reduce(
      (sum, value, index) => sum + (index === 0 ? value : value * index),
      0,
    ) % 103;
  values.push(checksum, STOP);

  const bars: Bar[] = [];
  let x = 0;
  for (const value of values) {
    const pattern = PATTERNS[value] ?? '';
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number.parseInt(pattern.charAt(index), 10);
      // Even positions are bars, odd ones spaces.
      if (index % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }

  return { bars, modules: x };
}
