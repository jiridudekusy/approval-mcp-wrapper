import { z } from 'zod';

import type { PluginCallDescription } from './contracts.js';

const jsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const localizedMessageSchema = z.object({
  key: z.string().min(1),
  params: z.record(z.string(), jsonPrimitive).optional(),
  fallback: z
    .object({
      en: z.string({ error: 'English fallback is required' }).min(1, {
        error: 'English fallback is required',
      }),
      cs: z.string().min(1).optional(),
    })
    .refine((fallback) => fallback.en.length > 0, {
      message: 'English fallback is required',
    }),
});

const predicateSchema = z.object({
  path: z.string(),
  operator: z.enum(['equals', 'exists', 'in', 'startsWith']),
  value: z.json().optional(),
});

const pluginDescriptionSchema = z.object({
  source: z.enum(['generic', 'plugin']),
  reasonCode: z.string().optional(),
  normalizedContext: z.record(z.string(), z.json()),
  sensitivePaths: z.array(
    z.string().refine((path) => path === '' || path.startsWith('/'), {
      message: 'Sensitive path must be a JSON pointer',
    }),
  ),
  title: localizedMessageSchema,
  sections: z.array(
    z.object({
      id: z.string().min(1),
      heading: localizedMessageSchema,
      fields: z.array(
        z.object({
          label: localizedMessageSchema,
          value: z.json(),
        }),
      ),
      risk: z.enum(['danger', 'info', 'warning']).optional(),
    }),
  ),
  proposedScopes: z.array(
    z.object({
      id: z.string().min(1),
      label: localizedMessageSchema,
      predicates: z.array(predicateSchema),
    }),
  ),
});

export function validatePluginDescription(input: unknown): PluginCallDescription {
  try {
    return pluginDescriptionSchema.parse(input) as PluginCallDescription;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(error.issues.map((issue) => issue.message).join('; '), { cause: error });
    }
    throw error;
  }
}
