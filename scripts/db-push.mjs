#!/usr/bin/env node
// Applies schema migrations + seed to Supabase using the REST API (rpc/sql endpoint)
// Usage: node --env-file=.env.local scripts/db-push.mjs [seed]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Extract project ref from URL
const projectRef = new URL(url).hostname.split(".")[0];
const runSeed = process.argv[2] === "seed";

async function runSql(label, sql) {
  console.log(`\n⏳ Running: ${label}`);
  const res = await fetch(
    `${url}/rest/v1/rpc/exec_sql`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ sql }),
    }
  );

  if (!res.ok) {
    // Try pg endpoint directly
    const pgRes = await fetch(`${url}/pg`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: sql }),
    });
    if (!pgRes.ok) {
      const body = await pgRes.text().catch(() => "");
      console.error(`❌ Failed: ${label}\n`, body.slice(0, 500));
      return false;
    }
  }
  console.log(`✅ Done: ${label}`);
  return true;
}

async function pushViaMgmtApi(label, sql) {
  console.log(`\n⏳ Running via Management API: ${label}`);
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    console.error(`❌ Failed: ${label}\n  Status: ${res.status}\n`, body.slice(0, 400));
    return false;
  }
  console.log(`✅ Done: ${label}`);
  return true;
}

// Split SQL into individual statements carefully (respects $$ blocks)
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let inDollarQuote = false;
  let dollarTag = "";
  let i = 0;

  while (i < sql.length) {
    // Detect dollar-quoting start/end
    if (!inDollarQuote) {
      const dollarMatch = sql.slice(i).match(/^(\$[^$]*\$)/);
      if (dollarMatch) {
        inDollarQuote = true;
        dollarTag = dollarMatch[1];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    } else {
      if (sql.slice(i).startsWith(dollarTag)) {
        inDollarQuote = false;
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = "";
        continue;
      }
    }

    if (!inDollarQuote && sql[i] === ";" && sql[i + 1] !== ";") {
      current += ";";
      const trimmed = current.trim();
      if (trimmed && trimmed !== ";") statements.push(trimmed);
      current = "";
      i++;
      continue;
    }

    current += sql[i];
    i++;
  }
  const trimmed = current.trim();
  if (trimmed && trimmed !== ";") statements.push(trimmed);
  return statements;
}

async function main() {
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const files = runSeed
    ? [
        { label: "Seed", path: join(root, "packages/db/seeds/seed.sql") },
      ]
    : [
        { label: "Migration 0001 (initial schema)", path: join(root, "supabase/migrations/0001_initial_schema.sql") },
      ];

  for (const file of files) {
    let sql;
    try {
      sql = readFileSync(file.path, "utf-8");
    } catch (e) {
      console.error(`❌ Could not read ${file.path}:`, e.message);
      process.exit(1);
    }

    // Split into statements and run each
    const statements = splitStatements(sql);
    console.log(`\n📄 ${file.label}: ${statements.length} statements`);
    let ok = 0;
    let fail = 0;

    for (let idx = 0; idx < statements.length; idx++) {
      const stmt = statements[idx];
      const preview = stmt.slice(0, 80).replace(/\n/g, " ");
      process.stdout.write(`  [${idx + 1}/${statements.length}] ${preview}... `);

      let error = null;
      try {
        const response = await supabase.rpc("exec_sql", { sql: stmt });
        error = response.error;
      } catch (e) {
        error = new Error("rpc not available");
      }

      if (error) {
        // Fall back to direct postgres REST
        const res = await fetch(`${url}/rest/v1/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
            "Prefer": "return=minimal",
          },
        });
        // Actually use postgres extension endpoint
        const pgRes = await fetch(
          `${url}/pg/query`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": serviceKey,
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ query: stmt }),
          }
        );
        if (!pgRes.ok) {
          const body = await pgRes.text().catch(() => "");
          if (body.includes("already exists") || body.includes("duplicate") || body.includes("does not exist and --create-db")) {
            process.stdout.write("⏭ skipped (already exists)\n");
            ok++;
          } else {
            process.stdout.write(`❌ FAILED\n    ${body.slice(0, 200)}\n`);
            fail++;
          }
          continue;
        }
      }
      process.stdout.write("✅\n");
      ok++;
    }

    console.log(`\n${file.label} complete: ${ok} ok, ${fail} failed`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
