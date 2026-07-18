import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTenderIdFromSlug, tenderDetailPath, tenderSearchSchema } from "@tenderlo/shared";

const migration = readFileSync("packages/db/migrations/0001_initial_schema.sql", "utf8");
const durableQueueMigration = readFileSync("packages/db/migrations/0003_durable_ingestion_jobs.sql", "utf8");

describe("database contract", () => {
  it("creates all critical evidence and QA tables", () => {
    for (const table of ["extracted_fields", "qa_tasks", "raw_source_snapshots", "recommendations", "compliance_checks", "audit_logs"]) {
      expect(migration).toContain(`create table if not exists ${table}`);
    }
    expect(migration).toContain("metadata jsonb not null default '{}'::jsonb");
    expect(migration).toContain("source_group text");
    expect(migration).toContain("document_prefix text");
    expect(migration).toContain("source_document_key text");
    expect(migration).toContain("fetched_at timestamptz not null default now()");
  });

  it("enables RLS and private storage buckets", () => {
    expect(migration).toContain("alter table organizations enable row level security");
    expect(migration).toContain("alter table profile_documents enable row level security");
    expect(migration).toContain("'profile-documents', 'profile-documents', false");
    expect(migration).toContain("'tender-documents', 'tender-documents', false");
    expect(migration).toContain("'tender-source-snapshots', 'tender-source-snapshots', false");
    expect(migration).toContain("tbl || '_ops_admin_all'");
    expect(migration).toContain("for all using (is_ops_admin()) with check (is_ops_admin())");
  });

  it("protects human verified extracted fields", () => {
    expect(migration).toContain("protect_verified_extracted_fields");
    expect(migration).toContain("old.verification_status = 'verified'");
    expect(migration).toContain("extracted_fields_dedupe_idx");
  });

  it("includes Phase 2 persistence", () => {
    for (const table of ["partner_matches", "subcontracting_opportunities", "award_records", "bid_packages"]) {
      expect(migration).toContain(`create table if not exists ${table}`);
    }
  });

  it("supports filtered tender search indexes and published-only public visibility", () => {
    for (const index of [
      "tenders_search_idx",
      "tenders_status_source_closing_idx",
      "tenders_province_city_idx",
      "tenders_sector_idx",
      "tenders_department_trgm_idx",
      "tenders_estimated_value_idx",
      "tenders_bid_security_idx",
      "tender_sources_metadata_gin_idx",
      "tender_documents_source_trace_idx",
      "extracted_fields_field_value_idx",
      "recommendations_org_status_score_idx"
    ]) {
      expect(migration).toContain(index);
    }
    expect(migration).toContain("create extension if not exists pg_trgm");
    expect(migration).toContain("status = 'published' or is_ops_admin()");
    expect(migration).not.toContain("status in ('published','closed','corrigendum') or is_ops_admin()");
  });

  it("normalizes the tender search API parameters", () => {
    const input = tenderSearchSchema.parse({
      q: "roads",
      source: "00000000-0000-0000-0000-000000000001",
      closing_date_after: "2026-05-01",
      closing_date_before: "2026-05-31",
      eligible_only: "false",
      sort: "estimated_value",
      page: "2",
      page_size: "75"
    });

    expect(input.source_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(input.deadline_from).toBe("2026-05-01");
    expect(input.deadline_to).toBe("2026-05-31");
    expect(input.eligible_only).toBe(false);
    expect(input.sort).toBe("estimated_value_desc");
    expect(input.page).toBe(2);
    expect(input.limit).toBe(50);
    expect(input.page_size).toBe(50);
    expect(input.tender_status).toBe("published");
  });

  it("builds and parses canonical tender detail slugs", () => {
    const id = "00000000-0000-4000-8000-000000000123";
    const path = tenderDetailPath("Road Rehabilitation Works", id);
    expect(path).toBe(`/tender/road-rehabilitation-works-${id}`);
    expect(parseTenderIdFromSlug(path.split("/").pop() ?? "")).toBe(id);
    expect(parseTenderIdFromSlug("bad-slug")).toBeNull();
  });

  it("adds a durable, leased ingestion queue and source circuit-breaker state", () => {
    expect(durableQueueMigration).toContain("create table if not exists ingestion_jobs");
    expect(durableQueueMigration).toContain("ingestion_jobs_one_active_source_idx");
    expect(durableQueueMigration).toContain("enqueue_due_ingestion_jobs");
    expect(durableQueueMigration).toContain("claim_ingestion_jobs");
    expect(durableQueueMigration).toContain("skip locked");
    expect(durableQueueMigration).toContain("circuit_open_until");
    expect(durableQueueMigration).toContain("dead_letter");
  });
});
