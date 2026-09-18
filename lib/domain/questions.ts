/* ─────────────────────────────────────────────────────────────────────────────
   Application questions.

   The same six kinds are used by the bank in Settings and by the questions a
   requisition asks on the careers form, and both render a row the same way —
   the icon says what kind of answer is expected, the line under it says the
   rest. Keeping the words here means the two lists cannot drift apart.
   ───────────────────────────────────────────────────────────────────────────*/
import type { IconName } from '@/components/ui/icons';

export type QuestionType = 'yesno' | 'choice' | 'multi' | 'short' | 'long' | 'number';

export const QUESTION_TYPES: Array<[QuestionType, string]> = [
  ['yesno', 'Yes / No'],
  ['choice', 'Single choice'],
  ['multi', 'Multiple choice'],
  ['short', 'Short answer'],
  ['long', 'Long answer'],
  ['number', 'Number'],
];

export const questionTypeLabel = (t: string): string =>
  (QUESTION_TYPES.find((x) => x[0] === t)?.[1] ?? t);

export const questionIcon = (t: string): IconName =>
  (t === 'yesno' ? 'check' : t === 'number' ? 'hash' : t === 'long' ? 'book' : 'list');
