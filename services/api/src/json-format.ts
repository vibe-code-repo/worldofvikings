/**
 * A JSON printer that produces exactly what Prettier would produce.
 *
 * The API writes files that stay in the repository, so `pnpm format:check` is
 * the real acceptance criterion for every world the editor saves: a file the
 * formatter would rewrite turns every later commit into a diff nobody asked
 * for. `JSON.stringify(value, null, 2)` fails that test — it breaks
 * `[24.3, 1.2, -56.4]` across four lines.
 *
 * The three rules Prettier's JSON printer follows, and this module with it:
 *
 * 1. Objects print one key per line (an object written expanded stays
 *    expanded), `{}` when empty.
 * 2. Arrays print on one line when they fit inside the print width.
 * 3. An array of numbers that does not fit is *filled*: as many values per line
 *    as fit, not one per line.
 *
 * `json-format.test.ts` checks every rule against real Prettier output, so the
 * claim in this comment is verified rather than asserted.
 */

/** Prettier's `printWidth` from `.prettierrc.json`. */
export const DEFAULT_PRINT_WIDTH = 100;

const INDENT = '  ';

/** Formats a value as a JSON document, including the trailing newline. */
export function formatJsonDocument(value: unknown, printWidth = DEFAULT_PRINT_WIDTH): string {
  return `${printValue(value, 0, 0, 0, printWidth)}\n`;
}

/**
 * @param depth  nesting level, two spaces each.
 * @param column where the value starts on its line — Prettier measures the
 *               whole line, not just the value.
 * @param suffix characters that will follow the value on the same line (the
 *               separating comma), which also count towards the print width.
 */
function printValue(
  value: unknown,
  depth: number,
  column: number,
  suffix: number,
  width: number,
): string {
  if (Array.isArray(value)) {
    return printArray(value, depth, column, suffix, width);
  }
  if (isPlainObject(value)) {
    return printObject(value, depth, width);
  }
  return printScalar(value);
}

function printObject(value: Record<string, unknown>, depth: number, width: number): string {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return '{}';
  }

  const pad = INDENT.repeat(depth + 1);
  const lines = entries.map(([key, entry], index) => {
    const last = index === entries.length - 1;
    const prefix = `${JSON.stringify(key)}: `;
    const printed = printValue(entry, depth + 1, pad.length + prefix.length, last ? 0 : 1, width);
    return `${pad}${prefix}${printed}${last ? '' : ','}`;
  });
  return `{\n${lines.join('\n')}\n${INDENT.repeat(depth)}}`;
}

function printArray(
  values: readonly unknown[],
  depth: number,
  column: number,
  suffix: number,
  width: number,
): string {
  if (values.length === 0) {
    return '[]';
  }

  const flat = printFlat(values);
  if (flat !== null && column + flat.length + suffix <= width) {
    return flat;
  }

  const pad = INDENT.repeat(depth + 1);
  const lines = values.every((entry) => typeof entry === 'number')
    ? fillNumbers(values as readonly number[], pad.length, width)
    : values.map((entry, index) => {
        const last = index === values.length - 1;
        const printed = printValue(entry, depth + 1, pad.length, last ? 0 : 1, width);
        return `${printed}${last ? '' : ','}`;
      });
  return `[\n${lines.map((line) => `${pad}${line}`).join('\n')}\n${INDENT.repeat(depth)}]`;
}

/** As many numbers per line as fit — Prettier's "concisely printed array". */
function fillNumbers(values: readonly number[], indent: number, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  values.forEach((value, index) => {
    const part = `${printScalar(value)}${index === values.length - 1 ? '' : ','}`;
    if (current === '') {
      current = part;
    } else if (indent + current.length + 1 + part.length <= width) {
      current = `${current} ${part}`;
    } else {
      lines.push(current);
      current = part;
    }
  });
  lines.push(current);
  return lines;
}

/**
 * The value on a single line, or `null` when it must break. Objects always
 * break, because that is how Prettier keeps an expanded object expanded.
 */
function printFlat(value: unknown): string | null {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const parts = value.map(printFlat);
    return parts.includes(null) ? null : `[${parts.join(', ')}]`;
  }
  if (isPlainObject(value)) {
    return Object.keys(value).length === 0 ? '{}' : null;
  }
  return printScalar(value);
}

/**
 * A scalar as its JSON literal. Values JSON cannot represent throw instead of
 * being written as `null`: silently losing data is worse than a failed request
 * (agent rule 11).
 */
function printScalar(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`cannot write ${String(value)} to a JSON file`);
  }
  const literal = JSON.stringify(value);
  if (literal === undefined) {
    throw new TypeError(`cannot write a value of type ${typeof value} to a JSON file`);
  }
  return literal;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
