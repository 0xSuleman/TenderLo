-- Durable, Postgres-backed ingestion queue.  This keeps source ingestion
-- independent from the scheduler process and makes retries/auditing replay-safe.

alter table tender_sources
  add column if not exists circuit_open_until timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists last_error text;

alter table ingestion_runs
  add column if not exists tenders_rejected integer not null default 0,
  add column if not exists documents_advertised integer not null default 0,
  add column if not exists documents_downloaded integer not null default 0,
  add column if not exists documents_failed integer not null default 0,
  add column if not exists snapshots_stored integer not null default 0,
  add column if not exists job_id uuid;

create table if not exists ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references tender_sources(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'leased', 'succeeded', 'failed', 'dead_letter', 'cancelled')),
  scheduled_for timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  lease_token uuid,
  lease_expires_at timestamptz,
  ingestion_run_id uuid references ingestion_runs(id) on delete set null,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table ingestion_runs add constraint ingestion_runs_job_id_fkey
    foreign key (job_id) references ingestion_jobs(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists ingestion_jobs_claim_idx
  on ingestion_jobs(status, scheduled_for, created_at)
  where status = 'queued';
create index if not exists ingestion_jobs_source_idx
  on ingestion_jobs(source_id, created_at desc);
create unique index if not exists ingestion_jobs_one_active_source_idx
  on ingestion_jobs(source_id)
  where status in ('queued', 'leased');
create index if not exists tender_sources_circuit_idx
  on tender_sources(status, circuit_open_until, last_run_at);

create or replace function enqueue_due_ingestion_jobs(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into ingestion_jobs (source_id, scheduled_for)
  select source.id, p_now
  from tender_sources source
  where source.status = 'active'
    and (source.circuit_open_until is null or source.circuit_open_until <= p_now)
    and (
      source.last_run_at is null
      or source.last_run_at <= p_now - make_interval(mins => source.scrape_frequency_minutes)
    )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function claim_ingestion_jobs(
  p_worker_token uuid,
  p_limit integer default 1,
  p_lease_seconds integer default 1800,
  p_now timestamptz default now()
)
returns setof ingestion_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Requeue abandoned leases before a worker claims fresh work.
  update ingestion_jobs
  set status = 'queued', lease_token = null, lease_expires_at = null,
      scheduled_for = p_now, updated_at = p_now
  where status = 'leased' and lease_expires_at < p_now;

  return query
  with candidates as (
    select job.id
    from ingestion_jobs job
    join tender_sources source on source.id = job.source_id
    where job.status = 'queued'
      and job.scheduled_for <= p_now
      and source.status = 'active'
      and (source.circuit_open_until is null or source.circuit_open_until <= p_now)
    order by job.scheduled_for, job.created_at
    for update of job skip locked
    limit greatest(1, least(p_limit, 20))
  )
  update ingestion_jobs job
  set status = 'leased', lease_token = p_worker_token,
      lease_expires_at = p_now + make_interval(secs => greatest(60, least(p_lease_seconds, 7200))),
      attempt_count = job.attempt_count + 1, updated_at = p_now
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

alter table ingestion_jobs enable row level security;
create policy "ingestion_jobs_ops_admin_all" on ingestion_jobs
  for all using (is_ops_admin()) with check (is_ops_admin());

drop trigger if exists ingestion_jobs_set_updated_at on ingestion_jobs;
create trigger ingestion_jobs_set_updated_at
before update on ingestion_jobs
for each row execute function set_updated_at();
