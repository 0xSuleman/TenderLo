#!/usr/bin/env node
/**
 * db-setup.mjs
 * Pushes schema migration + seed to Supabase using the postgres package.
 * Usage:
 *   node --env-file=.env.local scripts/db-setup.mjs schema
 *   node --env-file=.env.local scripts/db-setup.mjs seed
 *   node --env-file=.env.local scripts/db-setup.mjs all
 */

import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mode = process.argv[2] ?? "all";

if (!supabaseUrl || !serviceKey) {
  console.error("❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

// Supabase cloud Postgres connection string
// host: db.<project-ref>.supabase.co  port: 5432
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const connectionString = `postgresql://postgres:${serviceKey}@db.${projectRef}.supabase.co:5432/postgres`;

// Auto-discover all migration files in order
const migrationsDir = join(root, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ label: f.replace(".sql", ""), path: join(migrationsDir, f) }));

const seedFile = { label: "seed", path: join(root, "packages/db/seeds/seed.sql") };

async function run() {
  const sql = postgres(connectionString, {
    ssl: "require",
    max: 1,
    connect_timeout: 30,
    idle_timeout: 10,
  });

  const targets = mode === "seed" ? [seedFile] : mode === "schema" ? migrationFiles : [...migrationFiles, seedFile];

  for (const target of targets) {
    console.log(`\n📄  Running ${target.label}: ${target.path}`);
    let content;
    try {
      content = readFileSync(target.path, "utf-8");
    } catch (e) {
      console.error(`❌  Cannot read ${target.path}:`, e.message);
      process.exit(1);
    }

    try {
      // Run the whole file as a single transaction
      await sql.unsafe(content);
      console.log(`✅  ${target.label} applied successfully.`);
    } catch (e) {
      console.error(`❌  ${target.label} failed:`, e.message);
      // For schema/migrations, non-fatal errors (e.g. already exists) are common — continue
      if (target.label !== "seed") {
        console.log("ℹ️   Migration may already be partially applied. Continuing...");
      } else {
        await sql.end();
        process.exit(1);
      }
    }
  }

  await sql.end();
  console.log("\n🎉  Done.");
}

run().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
