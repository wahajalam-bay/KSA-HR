import fs from 'node:fs';
import path from 'node:path';

/* Next.js loads .env.local for the app; the scripts and the test harnesses run
   outside it, so they load the same files the same way — later files do not
   overwrite what is already in the environment, which is how CI overrides. */
const ORDER = ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env'];

export function loadEnvFiles(root = process.cwd()): void {
  for (const name of ORDER) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      let value = t.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        /* An unquoted value ends where its trailing comment begins. .env.example
           documents the alternatives inline — `EMAIL_PROVIDER=none  # none | smtp`
           — and the value is `none`, not the whole sentence. This is what Next's
           own loader does, so the app and the scripts read the file alike. */
        value = value.replace(/\s+#.*$/, '').trim();
      }
      process.env[key] = value;
    }
  }
}
