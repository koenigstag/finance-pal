import { z } from 'zod';
import i18n from '@/i18n';

// Form validation runs the contracts' own zod schemas, whose built-in messages are English.
// This error map swaps in translated messages for the issue kinds the forms can actually
// produce, and leaves anything else to zod's default. It reads the language at validation
// time, so it follows language changes without re-registering.
const errorMap: z.ZodErrorMap = (issue, ctx) => {
  const t = i18n.t.bind(i18n);

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: t('validation.required') };
      }
      break;
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') {
        return { message: t('validation.email') };
      }
      if (issue.validation === 'regex') {
        return { message: t('validation.format') };
      }
      break;
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return {
          message: Number(issue.minimum) <= 1 ? t('validation.required') : t('validation.minLength', { min: Number(issue.minimum) }),
        };
      }
      break;
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') {
        return { message: t('validation.maxLength', { max: Number(issue.maximum) }) };
      }
      break;
  }
  return { message: ctx.defaultError };
};

z.setErrorMap(errorMap);
