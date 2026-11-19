import { z } from 'zod';

const name = z.string().max(512);
const selector = z.union([
  z.strictObject({ role: z.string().regex(/^[a-z]+$/u), name }),
  z.strictObject({ label: name.min(1) }),
  z.strictObject({ text: name.min(1) }),
]);
const target = z.union([selector, z.array(selector).min(1).max(6)]);
const value = z.string().max(16_384);
const filename = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u);
const key = z.string().regex(/^(?:(?:Shift|Control|Alt|Meta|ControlOrMeta)\+)*(?:[A-Za-z0-9]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Enter|Escape|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown)$/u);

export const actionSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('resize'),
    width: z.number().int().min(280).max(3840),
    height: z.number().int().min(240).max(2160),
  }),
  z.strictObject({ op: z.literal('discover'), target: target.optional() }),
  z.strictObject({ op: z.literal('click'), target }),
  z.strictObject({ op: z.literal('focus'), target }),
  z.strictObject({ op: z.literal('scroll'), target, deltaY: z.number().int().min(-2_500).max(2_500).optional() }),
  z.strictObject({ op: z.literal('fill'), target, value }),
  z.strictObject({ op: z.literal('select'), target, value }),
  z.strictObject({ op: z.literal('check'), target }),
  z.strictObject({ op: z.literal('press'), key, target: target.optional() }),
  z.strictObject({ op: z.literal('uploadText'), target, file: filename, value }),
  z.strictObject({ op: z.literal('download'), target }),
  z.strictObject({ op: z.literal('screenshot'), file: filename }),
  z.strictObject({ op: z.literal('expect'), target, state: z.enum(['visible', 'hidden', 'focused', 'enabled', 'selected', 'expanded']) }),
  z.strictObject({ op: z.literal('expectText'), target, value, contains: z.boolean().optional() }),
  z.strictObject({ op: z.literal('expectValue'), target, value }),
  z.strictObject({ op: z.literal('back') }),
]);

export type Action = z.infer<typeof actionSchema>;
export type Target = z.infer<typeof target>;
