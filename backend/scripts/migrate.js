/**
 * Migration runner with a ledger.
 *
 * Applied migrations are recorded in the `schema_migrations` table, so the
 * repo can tell you what state a database is actually in.
 *
 * Usage:
 *   node scripts/migrate.js status               show applied / pending / drifted
 *   node scripts/migrate.js up [--dry-run]       apply all pending, in order
 *   node scripts/migrate.js baseline --through <file>
 *                                                record migrations as applied
 *                                                WITHOUT running them
 *
 * Each migration runs inside a transaction together with its ledger insert,
 * so a failure leaves no partial state and no phantom ledger row.
 */

const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const MIGRATIONS_DIR = path.join(__dirname, '../db/migrations');

// Arbitrary but fixed: stops two deploys migrating the same DB concurrently.
const ADVISORY_LOCK_KEY = 8675309;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    text PRIMARY KEY,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    duration_ms integer,
    baselined   boolean NOT NULL DEFAULT false
  );
`;

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

function readMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      return { filename, sql, checksum: checksum(sql) };
    });
}

/**
 * Most of these migrations open with `BEGIN;` and close with `COMMIT;`. The
 * runner supplies its own transaction, and an inner COMMIT would end it early
 * — committing the migration before the ledger row is written. Strip a leading
 * BEGIN and a trailing COMMIT so the runner's transaction stays in control.
 *
 * Deliberately narrow: only the first and last statements are considered, so
 * BEGIN/END inside dollar-quoted function bodies is untouched.
 */
function stripOuterTransaction(sql) {
  let out = sql.replace(/^(\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*)BEGIN\s*;/i, '$1');
  out = out.replace(/COMMIT\s*;(\s*(?:--[^\n]*\n|\s)*)$/i, '$1');
  return out;
}

async function loadLedger(client) {
  await client.query(LEDGER_DDL);
  const { rows } = await client.query(
    'SELECT filename, checksum, applied_at, baselined FROM schema_migrations'
  );
  return new Map(rows.map((r) => [r.filename, r]));
}

async function cmdStatus(client) {
  const ledger = await loadLedger(client);
  const migrations = readMigrations();

  let pending = 0;
  let drifted = 0;

  console.log('');
  for (const m of migrations) {
    const record = ledger.get(m.filename);
    if (!record) {
      pending++;
      console.log(`  PENDING    ${m.filename}`);
    } else if (record.checksum !== m.checksum) {
      drifted++;
      console.log(
        `  DRIFTED    ${m.filename}  (file changed since it was applied)`
      );
    } else {
      const when = record.applied_at.toISOString().slice(0, 16).replace('T', ' ');
      const how = record.baselined ? 'baselined' : 'applied';
      console.log(`  ok         ${m.filename}  ${how} ${when}`);
    }
  }

  // A ledger row with no matching file means someone deleted a migration.
  for (const filename of ledger.keys()) {
    if (!migrations.some((m) => m.filename === filename)) {
      console.log(`  ORPHANED   ${filename}  (in ledger, no file in repo)`);
    }
  }

  console.log(
    `\n  ${migrations.length} migration(s): ${migrations.length - pending - drifted} applied, ` +
      `${pending} pending, ${drifted} drifted\n`
  );

  return { pending, drifted };
}

async function cmdUp(client, { dryRun }) {
  const ledger = await loadLedger(client);
  const migrations = readMigrations();

  for (const m of migrations) {
    const record = ledger.get(m.filename);
    if (record && record.checksum !== m.checksum) {
      throw new Error(
        `${m.filename} has changed since it was applied.\n` +
          `  Applied checksum: ${record.checksum}\n` +
          `  Current checksum: ${m.checksum}\n` +
          `Migrations are immutable once applied. Write a new migration instead.`
      );
    }
  }

  const pending = migrations.filter((m) => !ledger.has(m.filename));

  if (pending.length === 0) {
    console.log('\n  Nothing to apply — database is up to date.\n');
    return;
  }

  if (dryRun) {
    console.log(`\n  Would apply ${pending.length} migration(s):`);
    pending.forEach((m) => console.log(`    ${m.filename}`));
    console.log('');
    return;
  }

  console.log(`\n  Applying ${pending.length} migration(s)...\n`);

  for (const m of pending) {
    const started = Date.now();
    try {
      await client.query('BEGIN');
      await client.query(stripOuterTransaction(m.sql));
      await client.query(
        `INSERT INTO schema_migrations (filename, checksum, duration_ms)
         VALUES ($1, $2, $3)`,
        [m.filename, m.checksum, Date.now() - started]
      );
      await client.query('COMMIT');
      console.log(`  applied    ${m.filename}  (${Date.now() - started}ms)`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`${m.filename} failed and was rolled back:\n  ${error.message}`);
    }
  }

  console.log('\n  Done.\n');
}

async function cmdBaseline(client, { through }) {
  if (!through) {
    throw new Error(
      'baseline requires --through <file>, e.g. --through 013_channel_contributions.sql\n' +
        'Everything up to and including that file is recorded as already applied.'
    );
  }

  const ledger = await loadLedger(client);
  const migrations = readMigrations();
  const cutoff = migrations.findIndex((m) => m.filename === through);

  if (cutoff === -1) {
    throw new Error(`No such migration: ${through}`);
  }

  const toRecord = migrations
    .slice(0, cutoff + 1)
    .filter((m) => !ledger.has(m.filename));

  if (toRecord.length === 0) {
    console.log('\n  Nothing to baseline — all already in the ledger.\n');
    return;
  }

  await client.query('BEGIN');
  try {
    for (const m of toRecord) {
      await client.query(
        `INSERT INTO schema_migrations (filename, checksum, baselined)
         VALUES ($1, $2, true)`,
        [m.filename, m.checksum]
      );
      console.log(`  baselined  ${m.filename}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  console.log(
    `\n  Recorded ${toRecord.length} migration(s) as applied. Nothing was run against the schema.\n`
  );
}

function parseArgs(argv) {
  const command = argv[0] || 'status';
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--dry-run') flags.dryRun = true;
    if (argv[i] === '--through') flags.through = argv[++i];
  }
  return { command, flags };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const client = await pool.connect();

  // Serialize against other runners before touching anything.
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

  try {
    switch (command) {
      case 'status': {
        const { drifted } = await cmdStatus(client);
        if (drifted > 0) process.exitCode = 1;
        break;
      }
      case 'up':
        await cmdUp(client, flags);
        break;
      case 'baseline':
        await cmdBaseline(client, flags);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Usage: migrate.js [status | up [--dry-run] | baseline --through <file>]');
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(`\n  ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    client.release();
    await pool.end();
  }
}

main();
