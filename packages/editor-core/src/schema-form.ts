/**
 * What a panel has to draw for a block of world data, derived from the schema
 * that block is validated against (ADR-0033).
 *
 * **Why derived and not written out.** The lighting profile has 38 fields and
 * the terrain block is about to grow four more — `normalMap`, `normalScale`,
 * `metallic`, `smoothness` — as the terrain work lands. A hand-written panel
 * would mean every schema change needs a matching edit in `apps/editor`, and
 * the failure when someone forgets is silent: the field exists in the file, the
 * game reads it, and the editor simply does not show it. Deriving the form from
 * `@wov/world-schema` makes that impossible. A field added to the schema
 * appears in the editor on the next reload, with its own range and its own
 * type, and nothing in `apps/editor` changes.
 *
 * **How.** Through `z.toJSONSchema`, which is Zod's own public description of
 * its schemas. Reading Zod's internals would work today and break on an
 * upgrade; JSON Schema is the documented output and carries exactly what a
 * control needs — type, minimum, maximum, enum, and the pattern that tells a
 * colour from a path.
 *
 * This module knows nothing about React. It answers descriptors; `apps/editor`
 * turns them into inputs.
 */
import { z } from 'zod';

/** A control a panel can draw, and everything it needs to draw it. */
export type FormField =
  | FormGroup
  | FormNumber
  | FormBoolean
  | FormColor
  | FormChoice
  | FormText
  | FormAsset
  | FormVector
  | FormList
  | FormUnknown;

interface FormFieldBase {
  /** The key in the block this field edits — one path segment. */
  readonly key: string;
  /** `sunSpread` → `sun spread`, for the label next to the control. */
  readonly label: string;
  /** Whether the schema refuses the block without it. */
  readonly required: boolean;
  /**
   * The editor command that writes this field, when it is not an ordinary
   * field patch.
   *
   * `turnedBy` in `@wov/world-schema` puts it there. A panel uses it to decide
   * which of its two halves draws the field — see `fieldsCommandedBy` — so that
   * one block edited by two commands is still one panel and never two controls
   * for one number.
   */
  readonly command?: string;
}

export interface FormGroup extends FormFieldBase {
  readonly kind: 'group';
  readonly fields: readonly FormField[];
}

export interface FormNumber extends FormFieldBase {
  readonly kind: 'number';
  readonly minimum?: number;
  readonly maximum?: number;
  /**
   * Whether {@link minimum} is itself refused — `z.number().positive()` is a
   * minimum of zero that zero does not satisfy.
   *
   * A slider does not care. Whoever has to invent a *starting value* does: a
   * new terrain layer built with `tileSize: 0` is rejected by the very schema
   * this description came from, and the author sees a validation error instead
   * of a layer.
   */
  readonly exclusiveMinimum?: boolean;
  readonly integer: boolean;
  /** A step that makes the control usable, derived from the range. */
  readonly step: number;
}

export interface FormBoolean extends FormFieldBase {
  readonly kind: 'boolean';
}

/** A string the schema constrains to `#rrggbb` — a colour well, not a text box. */
export interface FormColor extends FormFieldBase {
  readonly kind: 'color';
}

export interface FormChoice extends FormFieldBase {
  readonly kind: 'choice';
  readonly options: readonly string[];
}

export interface FormText extends FormFieldBase {
  readonly kind: 'text';
}

/**
 * A path into the asset store, and which kind of file belongs there.
 *
 * Still a text field — a world may legitimately name a file no manifest lists,
 * and a control that hid that value would make the world uneditable. What the
 * kind adds is a list to *choose* from: the panel offers the manifest's terrain
 * models for a height field and its images for a ground texture. The annotation
 * comes from the schema (`assetPathOf` in `@wov/world-schema`), so a new path
 * field arrives with its picker and nothing here or in `apps/editor` changes.
 */
export interface FormAsset extends FormFieldBase {
  readonly kind: 'asset';
  /** `terrain`, `texture`, `mesh`, `prefab` — the manifest's own vocabulary. */
  readonly asset: string;
}

/** A fixed-length tuple of numbers: a position, a direction, a `[w, d]` size. */
export interface FormVector extends FormFieldBase {
  readonly kind: 'vector';
  readonly length: number;
  readonly minimum?: number;
}

export interface FormList extends FormFieldBase {
  readonly kind: 'list';
  /** What one entry looks like. A list of layers is a list of groups. */
  readonly item: FormField;
  readonly maxItems?: number;
  readonly minItems?: number;
}

/** A shape this module has no control for. Shown as raw JSON rather than hidden. */
export interface FormUnknown extends FormFieldBase {
  readonly kind: 'unknown';
}

/** The `#rrggbb` rule of `@wov/world-schema`, as it reaches JSON Schema. */
const HEX_COLOR_PATTERN = '^#[0-9a-fA-F]{6}$';

/** `normalScale` → `normal scale`; `mapSize` → `map size`. */
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

type JsonSchema = Record<string, unknown>;

function asSchema(value: unknown): JsonSchema | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * A step a person can actually drag with.
 *
 * A fraction of one wants hundredths, a shadow map wants whole texels, and a
 * fog distance in metres wants tenths. Guessing from the declared range is what
 * lets a new field arrive with a usable control and no UI change.
 */
function stepFor(
  minimum: number | undefined,
  maximum: number | undefined,
  integer: boolean,
): number {
  if (integer) {
    return 1;
  }
  if (minimum !== undefined && maximum !== undefined && maximum - minimum <= 2) {
    // Hundredths, unless the whole range is narrower than that. Fog density is
    // bounded at 0.005 per metre (ADR-0041), and a step of 0.01 there is a
    // control with two positions: off, and past the end. So the step is also
    // held down to a power of ten near a fiftieth of the range, which leaves
    // every existing 0…1 and 0…2 field on its hundredths and gives a narrow
    // one a slider it can actually be dragged along.
    return Math.min(0.01, powerOfTenAtOrBelow((maximum - minimum) / 50));
  }
  return 0.1;
}

/**
 * The largest power of ten that is not greater than `value`.
 *
 * Built from its exponent as a literal rather than with `Math.pow`, which
 * returns 0.00009999999999999999 for ten to the minus four. That is the right
 * number and the wrong one to put in a control's `step`, where a browser
 * compares a typed value against it.
 */
function powerOfTenAtOrBelow(value: number): number {
  if (!(value > 0)) {
    return 0.01;
  }
  return Number(`1e${String(Math.floor(Math.log10(value)))}`);
}

function fieldFrom(key: string, schema: JsonSchema, required: boolean): FormField {
  // `turnedBy` in `@wov/world-schema` puts this there through `.meta()`, which
  // `z.toJSONSchema` copies into the field verbatim — the same route
  // `assetPathOf` takes.
  const command = schema['command'];
  const base = {
    key,
    label: humanizeKey(key),
    required,
    ...(typeof command === 'string' && command !== '' ? { command } : {}),
  };

  const enumValues = schema['enum'];
  if (Array.isArray(enumValues)) {
    return { ...base, kind: 'choice', options: enumValues.map((value) => String(value)) };
  }

  const type = schema['type'];

  if (type === 'boolean') {
    return { ...base, kind: 'boolean' };
  }

  if (type === 'number' || type === 'integer') {
    const inclusive = numberOf(schema['minimum']);
    const exclusive = numberOf(schema['exclusiveMinimum']);
    const minimum = inclusive ?? exclusive;
    const maximum = numberOf(schema['maximum']) ?? numberOf(schema['exclusiveMaximum']);
    const integer = type === 'integer';
    return {
      ...base,
      kind: 'number',
      ...(minimum === undefined ? {} : { minimum }),
      ...(maximum === undefined ? {} : { maximum }),
      ...(inclusive === undefined && exclusive !== undefined ? { exclusiveMinimum: true } : {}),
      integer,
      step: stepFor(minimum, maximum, integer),
    };
  }

  if (type === 'string') {
    if (schema['pattern'] === HEX_COLOR_PATTERN) {
      return { ...base, kind: 'color' };
    }
    // `assetPathOf` in `@wov/world-schema` puts this there through `.meta()`,
    // which `z.toJSONSchema` copies into the field verbatim.
    const asset = schema['asset'];
    if (typeof asset === 'string' && asset !== '') {
      return { ...base, kind: 'asset', asset };
    }
    return { ...base, kind: 'text' };
  }

  if (type === 'array') {
    const prefixItems = schema['prefixItems'];
    if (Array.isArray(prefixItems) && prefixItems.length > 0) {
      const entries = prefixItems.map(asSchema);
      if (entries.every((entry) => entry?.['type'] === 'number')) {
        const minimum = entries
          .map((entry) => numberOf(entry?.['minimum']) ?? numberOf(entry?.['exclusiveMinimum']))
          .find((value) => value !== undefined);
        return {
          ...base,
          kind: 'vector',
          length: prefixItems.length,
          ...(minimum === undefined ? {} : { minimum }),
        };
      }
    }
    const items = asSchema(schema['items']);
    if (items !== undefined) {
      const maxItems = numberOf(schema['maxItems']);
      const minItems = numberOf(schema['minItems']);
      return {
        ...base,
        kind: 'list',
        item: fieldFrom(key, items, true),
        ...(maxItems === undefined ? {} : { maxItems }),
        ...(minItems === undefined ? {} : { minItems }),
      };
    }
  }

  const properties = asSchema(schema['properties']);
  if (type === 'object' || properties !== undefined) {
    return { ...base, kind: 'group', fields: fieldsFrom(schema) };
  }

  return { ...base, kind: 'unknown' };
}

function fieldsFrom(schema: JsonSchema): readonly FormField[] {
  const properties = asSchema(schema['properties']) ?? {};
  const requiredKeys = new Set(
    Array.isArray(schema['required']) ? schema['required'].map((key) => String(key)) : [],
  );
  const fields: FormField[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const child = asSchema(value);
    if (child === undefined) {
      continue;
    }
    fields.push(fieldFrom(key, child, requiredKeys.has(key)));
  }
  return fields;
}

/**
 * The controls one Zod object schema asks for, in declaration order.
 *
 * Declaration order is the order the panel shows and the order the file is
 * written in, which is why `LightingProfileSchema` declares `sun` before
 * `postProcessing` and not alphabetically.
 */
export function describeFields(schema: z.ZodType): readonly FormField[] {
  // `io: 'input'` so an optional field is described by what may be *written*,
  // and `unrepresentable: 'any'` so a shape JSON Schema cannot express becomes
  // an untyped field instead of throwing and taking the whole panel with it.
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  return fieldsFrom(json);
}

/**
 * Every field a given command writes, with the path it sits at.
 *
 * The answer for a *list* is the path of one entry with `*` where its index
 * goes — `['layers', '*', 'metallic']` — because a list has as many of the
 * field as it has entries and the panel is the only thing that knows how many.
 *
 * This is what keeps a two-command block one panel: the half of the panel that
 * dispatches `command` asks for its own fields by naming the command, not by
 * naming the fields, so a fifth field annotated in the schema appears in the
 * right half of the panel with no edit here or in `apps/editor`.
 */
export function fieldsCommandedBy(
  fields: readonly FormField[],
  command: string,
  prefix: readonly string[] = [],
): { readonly path: readonly string[]; readonly field: FormField }[] {
  const found: { path: readonly string[]; field: FormField }[] = [];
  for (const field of fields) {
    const path = [...prefix, field.key];
    if (field.command === command) {
      found.push({ path, field });
      continue;
    }
    if (field.kind === 'group') {
      found.push(...fieldsCommandedBy(field.fields, command, path));
    } else if (field.kind === 'list' && field.item.kind === 'group') {
      found.push(...fieldsCommandedBy(field.item.fields, command, [...path, '*']));
    }
  }
  return found;
}

/** Every leaf path under a set of fields, outermost first. For tests and tooling. */
export function fieldPaths(
  fields: readonly FormField[],
  prefix: readonly string[] = [],
): string[][] {
  const paths: string[][] = [];
  for (const field of fields) {
    const path = [...prefix, field.key];
    if (field.kind === 'group') {
      paths.push(...fieldPaths(field.fields, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}
