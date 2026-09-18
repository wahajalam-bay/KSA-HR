import { commandNames, lookup } from '@/lib/commands/registry';
import '@/lib/commands';
for (const n of commandNames()) {
  const c = lookup(n)!;
  console.log(n.padEnd(22), (c as { capability?: string }).capability ?? '');
}
