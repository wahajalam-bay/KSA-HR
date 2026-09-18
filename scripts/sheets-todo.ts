import { SHEET_ACTIONS } from '@/lib/nav';
import { sheetNames } from '@/lib/sheets/registry';
import '@/lib/sheets';

const have = new Set(sheetNames());
const want = [...SHEET_ACTIONS].sort();
const missing = want.filter((a) => !have.has(a));
console.log(`${have.size} defined, ${missing.length} of ${want.length} still to write:\n`);
console.log(missing.join('\n'));
