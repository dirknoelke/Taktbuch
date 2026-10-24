// Verwaltung über die Kommandozeile, im Cluster z. B.:
//   kubectl -n taktbuch-staging exec deploy/taktbuch-app -- node packages/api/src/cli.ts invite mella@example.org
import { createPool, migrate } from './db.ts';
import { createInvite } from './auth.ts';

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL fehlt'); process.exit(2); }
const db = createPool(url);

try {
  if (cmd === 'migrate') {
    const done = await migrate(db, m => console.log(m));
    if (!done.length) console.log('Schema ist aktuell.');
  } else if (cmd === 'invite') {
    const origin = process.env.PUBLIC_ORIGIN;
    if (!origin) throw new Error('PUBLIC_ORIGIN fehlt');
    const email = args.find(a => !a.startsWith('--')) ?? null;
    const days = Number(args.find(a => a.startsWith('--days='))?.slice(7) ?? 7);
    const link = await createInvite(db, { publicOrigin: origin.replace(/\/$/, '') }, email, days);
    console.log(`Einladung${email ? ' für ' + email : ''}, gültig ${days} Tage, einmal verwendbar:\n${link}`);
  } else {
    console.log('Befehle:\n  migrate\n  invite [email] [--days=7]');
    process.exitCode = cmd ? 2 : 0;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
