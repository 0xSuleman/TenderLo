create extension if not exists pgcrypto;
create extension if not exists unaccent;
create extension if not exists pg_trgm;

do $$ begin create type app_role as enum ('owner', 'admin', 'member', 'viewer', 'ops_admin'); exception when duplicate_object then null; end $$;
do $$ begin create type membership_status as enum ('active', 'invited', 'suspended'); exception when duplicate_object then null; end $$;
do $$ begin create type pec_category as enum ('C-A', 'C-B', 'C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'unknown'); exception when duplicate_object then null; end $$;
do $$ begin create type verification_status as enum ('unverified', 'verified', 'expired', 'rejected', 'needs_review'); exception when duplicate_object then null; end $$;
do $$ begin create type engineer_type as enum ('PE', 'RE', 'trainee', 'unknown'); exception when duplicate_object then null; end $$;
do $$ begin create type equipment_ownership_type as enum ('owned', 'leased', 'rented', 'unknown'); exception when duplicate_object then null; end $$;
do $$ begin create type tender_source_type as enum ('federal', 'provincial', 'department', 'newspaper', 'manual'); exception when duplicate_object then null; end $$;
do $$ begin create type tender_source_status as enum ('active', 'disabled', 'failing'); exception when duplicate_object then null; end $$;
do $$ begin create type ingestion_run_status as enum ('running', 'succeeded', 'failed', 'partial'); exception when duplicate_object then null; end $$;
do $$ begin create type tender_status as enum ('draft', 'published', 'closed', 'cancelled', 'corrigendum', 'under_review'); exception when duplicate_object then null; end $$;
do $$ begin create type parser_status as enum ('pending', 'parsed', 'ocr_required', 'failed'); exception when duplicate_object then null; end $$;
do $$ begin create type ocr_status as enum ('not_needed', 'pending', 'completed', 'failed'); exception when duplicate_object then null; end $$;
do $$ begin create type extraction_method as enum ('pdf_text', 'docx_text', 'html_selector', 'html_generic', 'ocr', 'manual'); exception when duplicate_object then null; end $$;
do $$ begin create type field_source_method as enum ('html_selector', 'regex', 'keyword_window', 'table_rule', 'ocr', 'manual'); exception when duplicate_object then null; end $$;
do $$ begin create type rule_type as enum ('regex', 'keyword_window', 'selector', 'dictionary', 'table_rule'); exception when duplicate_object then null; end $$;
do $$ begin create type duplicate_status as enum ('pending', 'merged', 'rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type recommendation_status as enum ('recommended', 'warning', 'blocked', 'dismissed'); exception when duplicate_object then null; end $$;
do $$ begin create type compliance_status as enum ('eligible', 'eligible_with_warnings', 'not_eligible', 'unknown'); exception when duplicate_object then null; end $$;
do $$ begin create type notification_channel as enum ('email', 'in_app', 'whatsapp'); exception when duplicate_object then null; end $$;
do $$ begin create type notification_frequency as enum ('immediate', 'daily', 'weekly'); exception when duplicate_object then null; end $$;
do $$ begin create type notification_status as enum ('pending', 'sent', 'failed', 'read'); exception when duplicate_object then null; end $$;
do $$ begin create type subscription_plan as enum ('starter', 'growth', 'pro', 'enterprise'); exception when duplicate_object then null; end $$;
do $$ begin create type subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled', 'manual_invoice'); exception when duplicate_object then null; end $$;
do $$ begin create type invoice_status as enum ('draft', 'sent', 'paid', 'void', 'overdue'); exception when duplicate_object then null; end $$;
do $$ begin create type qa_task_type as enum ('low_confidence_field', 'duplicate_review', 'source_failure', 'parser_failure', 'manual_verification'); exception when duplicate_object then null; end $$;
do $$ begin create type qa_task_status as enum ('open', 'in_progress', 'resolved', 'dismissed'); exception when duplicate_object then null; end $$;
do $$ begin create type qa_priority as enum ('low', 'medium', 'high', 'urgent'); exception when duplicate_object then null; end $$;
do $$ begin create type phase2_record_status as enum ('open', 'closed', 'awarded', 'active', 'inactive'); exception when duplicate_object then null; end $$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  primary_contact_name text,
  primary_contact_email text,
  phone text,
  city text,
  province text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  status membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role app_role not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists company_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  business_type text,
  ntn text,
  strn text,
  website text,
  operating_regions text[] not null default '{}',
  sectors text[] not null default '{}',
  profile_completeness_score integer not null default 0 check (profile_completeness_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pec_licenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  license_number text not null,
  category pec_category not null default 'unknown',
  specialization_codes text[] not null default '{}',
  issue_date date,
  expiry_date date,
  verification_status verification_status not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists engineers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text not null,
  pec_number text,
  engineer_type engineer_type not null default 'unknown',
  discipline text,
  verification_status verification_status not null default 'unverified',
  expiry_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  equipment_type text,
  capacity text,
  ownership_type equipment_ownership_type not null default 'unknown',
  location text,
  verification_status verification_status not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profile_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  document_type text not null,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  expiry_date date,
  verification_status verification_status not null default 'unverified',
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tender_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  source_type tender_source_type not null,
  region text,
  adapter_key text not null,
  scrape_frequency_minutes integer not null default 1440 check (scrape_frequency_minutes >= 15),
  status tender_source_status not null default 'active',
  last_run_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references tender_sources(id) on delete cascade,
  status ingestion_run_status not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  tenders_seen integer not null default 0,
  tenders_created integer not null default 0,
  tenders_updated integer not null default 0,
  duplicates_found integer not null default 0,
  error_message text
);

create table if not exists raw_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references tender_sources(id) on delete cascade,
  ingestion_run_id uuid references ingestion_runs(id) on delete set null,
  source_url text not null,
  content_type text not null,
  storage_path text not null,
  content_hash text not null,
  fetched_at timestamptz not null default now(),
  unique (source_id, content_hash)
);

create table if not exists tenders (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references tender_sources(id) on delete set null,
  canonical_tender_id text not null unique,
  title text not null,
  normalized_title text not null,
  source_url text,
  tender_number text,
  department text,
  procurement_category text,
  sector text,
  province text,
  city text,
  description text,
  advertisement_date date,
  closing_date timestamptz,
  opening_date timestamptz,
  bid_security_amount numeric(16,2),
  estimated_value numeric(16,2),
  document_fee numeric(16,2),
  status tender_status not null default 'draft',
  extraction_confidence numeric(5,2) not null default 0,
  is_human_verified boolean not null default false,
  search_document tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(department, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(sector, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(city, '') || ' ' || coalesce(province, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tender_source_links (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  source_id uuid references tender_sources(id) on delete set null,
  source_url text not null,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tender_id, source_url)
);

create table if not exists tender_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  source_url text,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  page_count integer,
  parser_status parser_status not null default 'pending',
  ocr_status ocr_status not null default 'not_needed',
  content_hash text not null,
  source_group text,
  document_prefix text,
  source_document_key text,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tender_id, content_hash)
);

create table if not exists parsed_document_text (
  id uuid primary key default gen_random_uuid(),
  tender_document_id uuid not null references tender_documents(id) on delete cascade,
  page_number integer not null,
  text text not null,
  extraction_method extraction_method not null,
  confidence_score numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (tender_document_id, page_number, extraction_method)
);

create table if not exists extracted_fields (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  tender_document_id uuid references tender_documents(id) on delete set null,
  field_name text not null,
  field_value text not null,
  source_method field_source_method not null,
  confidence_score numeric(5,2) not null default 0,
  evidence_text text not null,
  verification_status verification_status not null default 'unverified',
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists field_extraction_rules (
  id uuid primary key default gen_random_uuid(),
  field_name text not null,
  rule_type rule_type not null,
  pattern text not null,
  source_adapter_key text,
  confidence_weight numeric(5,2) not null default 0.75,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tender_sector_matches (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  sector text not null,
  score numeric(8,2) not null,
  matched_keywords text[] not null default '{}',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tender_id, sector)
);

create table if not exists duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  candidate_tender_id uuid not null references tenders(id) on delete cascade,
  confidence_score numeric(5,2) not null,
  reasons text[] not null default '{}',
  status duplicate_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tender_id, candidate_tender_id),
  check (tender_id <> candidate_tender_id)
);

create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  status recommendation_status not null,
  positive_reasons text[] not null default '{}',
  warnings text[] not null default '{}',
  blockers text[] not null default '{}',
  next_action text not null,
  calculated_at timestamptz not null default now(),
  unique (organization_id, tender_id)
);

create table if not exists compliance_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  status compliance_status not null,
  detected_requirements jsonb not null default '{}'::jsonb,
  missing_documents text[] not null default '{}',
  expired_documents text[] not null default '{}',
  warnings text[] not null default '{}',
  blockers text[] not null default '{}',
  profile_snapshot jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists saved_searches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  query text not null default '',
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists saved_tenders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, tender_id)
);

create table if not exists notification_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_search_id uuid references saved_searches(id) on delete cascade,
  channel notification_channel not null,
  frequency notification_frequency not null default 'daily',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  channel notification_channel not null,
  status notification_status not null default 'pending',
  related_tender_id uuid references tenders(id) on delete set null,
  delivery_attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references notifications(id) on delete cascade,
  channel notification_channel not null,
  provider text not null,
  provider_message_id text,
  status notification_status not null,
  error_message text,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plan subscription_plan not null,
  status subscription_status not null,
  provider text not null,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  provider text not null,
  provider_payment_id text not null,
  amount numeric(16,2) not null,
  currency text not null default 'PKR',
  status text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  invoice_number text not null unique,
  amount numeric(16,2) not null,
  currency text not null default 'PKR',
  status invoice_status not null default 'draft',
  due_date date,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists qa_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  tender_id uuid references tenders(id) on delete cascade,
  source_id uuid references tender_sources(id) on delete cascade,
  task_type qa_task_type not null,
  status qa_task_status not null default 'open',
  priority qa_priority not null default 'medium',
  title text not null,
  details jsonb not null default '{}'::jsonb,
  assigned_to uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists partner_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  sectors text[] not null default '{}',
  regions text[] not null default '{}',
  min_pec_category pec_category not null default 'unknown',
  max_project_value numeric(16,2),
  notes text,
  status phase2_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists partner_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  matched_organization_id uuid not null references organizations(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  reasons text[] not null default '{}',
  status phase2_record_status not null default 'active',
  calculated_at timestamptz not null default now(),
  unique (organization_id, matched_organization_id),
  check (organization_id <> matched_organization_id)
);

create table if not exists subcontracting_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid references tenders(id) on delete set null,
  title text not null,
  sector text not null,
  region text,
  description text not null,
  required_documents text[] not null default '{}',
  status phase2_record_status not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists award_records (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid references tenders(id) on delete set null,
  department text not null,
  contractor_name text not null,
  award_value numeric(16,2),
  award_date date,
  source_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists competitor_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  contractor_name text not null,
  sectors text[] not null default '{}',
  regions text[] not null default '{}',
  observed_awards_count integer not null default 0,
  observed_awards_value numeric(16,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bid_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  name text not null,
  checklist jsonb not null default '{}'::jsonb,
  status phase2_record_status not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, tender_id, name)
);

create table if not exists bid_package_documents (
  id uuid primary key default gen_random_uuid(),
  bid_package_id uuid not null references bid_packages(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_document_id uuid references profile_documents(id) on delete set null,
  storage_path text,
  original_filename text,
  document_type text not null,
  included boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists memberships_user_idx on memberships(user_id, status);
create index if not exists memberships_org_idx on memberships(organization_id, role, status);
create index if not exists profile_documents_org_idx on profile_documents(organization_id, document_type);
create index if not exists tender_sources_status_idx on tender_sources(status, last_run_at);
create index if not exists tender_sources_metadata_gin_idx on tender_sources using gin(metadata);
create index if not exists ingestion_runs_source_idx on ingestion_runs(source_id, started_at desc);
create index if not exists tenders_status_closing_idx on tenders(status, closing_date);
create index if not exists tenders_search_idx on tenders using gin(search_document);
create index if not exists tenders_source_idx on tenders(source_id);
create index if not exists tenders_status_source_closing_idx on tenders(status, source_id, closing_date);
create index if not exists tenders_province_city_idx on tenders(province, city);
create index if not exists tenders_sector_idx on tenders(sector);
create index if not exists tenders_department_trgm_idx on tenders using gin(department gin_trgm_ops);
create index if not exists tenders_estimated_value_idx on tenders(estimated_value);
create index if not exists tenders_bid_security_idx on tenders(bid_security_amount);
create index if not exists tender_documents_tender_idx on tender_documents(tender_id);
create index if not exists tender_documents_source_trace_idx on tender_documents(source_group, document_prefix, source_document_key);
create index if not exists parsed_document_text_doc_idx on parsed_document_text(tender_document_id);
create index if not exists extracted_fields_tender_field_idx on extracted_fields(tender_id, field_name);
create index if not exists extracted_fields_field_value_idx on extracted_fields(field_name, field_value, verification_status, tender_id);
create unique index if not exists extracted_fields_dedupe_idx
  on extracted_fields (
    tender_id,
    coalesce(tender_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
    field_name,
    field_value,
    source_method,
    md5(evidence_text)
  );
create index if not exists recommendations_org_score_idx on recommendations(organization_id, score desc);
create index if not exists recommendations_org_status_score_idx on recommendations(organization_id, status, score desc);
create index if not exists compliance_checks_org_tender_idx on compliance_checks(organization_id, tender_id, created_at desc);
create index if not exists saved_searches_org_user_idx on saved_searches(organization_id, user_id);
create index if not exists notifications_org_user_idx on notifications(organization_id, user_id, status);
create index if not exists qa_tasks_status_idx on qa_tasks(status, priority, created_at);
create index if not exists audit_logs_org_idx on audit_logs(organization_id, created_at desc);
create index if not exists award_records_contractor_idx on award_records(contractor_name, award_date desc);
create unique index if not exists subscriptions_org_provider_subscription_idx on subscriptions(organization_id, provider_subscription_id) where provider_subscription_id is not null;

create or replace function is_active_member(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships
    where organization_id = target_org_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function has_org_role(target_org_id uuid, allowed_roles app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships
    where organization_id = target_org_id
      and user_id = auth.uid()
      and status = 'active'
      and role = any(allowed_roles)
  );
$$;

create or replace function is_ops_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships
    where user_id = auth.uid()
      and status = 'active'
      and role = 'ops_admin'
  );
$$;

create or replace function protect_verified_extracted_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.verification_status = 'verified' and new.source_method <> 'manual' then
    new.field_value = old.field_value;
    new.confidence_score = old.confidence_score;
    new.evidence_text = old.evidence_text;
    new.verification_status = old.verification_status;
    new.verified_by = old.verified_by;
    new.verified_at = old.verified_at;
  end if;

  if tg_op = 'INSERT' and new.source_method <> 'manual' and exists (
    select 1 from extracted_fields
    where tender_id = new.tender_id
      and field_name = new.field_name
      and verification_status = 'verified'
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists extracted_fields_protect_verified on extracted_fields;
create trigger extracted_fields_protect_verified
before insert or update on extracted_fields
for each row execute function protect_verified_extracted_fields();

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'organizations','profiles','memberships','company_profiles','pec_licenses','engineers','equipment',
    'profile_documents','tender_sources','tenders','tender_documents','extracted_fields','field_extraction_rules',
    'saved_searches','notification_rules','subscriptions','qa_tasks','partner_preferences',
    'subcontracting_opportunities','competitor_profiles','bid_packages'
  ]
  loop
    execute format('drop trigger if exists %I_set_updated_at on %I', tbl, tbl);
    execute format('create trigger %I_set_updated_at before update on %I for each row execute function set_updated_at()', tbl, tbl);
  end loop;
end $$;

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;
alter table company_profiles enable row level security;
alter table pec_licenses enable row level security;
alter table engineers enable row level security;
alter table equipment enable row level security;
alter table profile_documents enable row level security;
alter table tender_sources enable row level security;
alter table ingestion_runs enable row level security;
alter table raw_source_snapshots enable row level security;
alter table tenders enable row level security;
alter table tender_source_links enable row level security;
alter table tender_documents enable row level security;
alter table parsed_document_text enable row level security;
alter table extracted_fields enable row level security;
alter table field_extraction_rules enable row level security;
alter table tender_sector_matches enable row level security;
alter table duplicate_candidates enable row level security;
alter table recommendations enable row level security;
alter table compliance_checks enable row level security;
alter table saved_searches enable row level security;
alter table saved_tenders enable row level security;
alter table notification_rules enable row level security;
alter table notifications enable row level security;
alter table notification_delivery_attempts enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table invoices enable row level security;
alter table qa_tasks enable row level security;
alter table audit_logs enable row level security;
alter table partner_preferences enable row level security;
alter table partner_matches enable row level security;
alter table subcontracting_opportunities enable row level security;
alter table award_records enable row level security;
alter table competitor_profiles enable row level security;
alter table bid_packages enable row level security;
alter table bid_package_documents enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'organizations','profiles','memberships','invitations','company_profiles','pec_licenses','engineers','equipment',
    'profile_documents','tender_sources','ingestion_runs','raw_source_snapshots','tenders','tender_source_links',
    'tender_documents','parsed_document_text','extracted_fields','field_extraction_rules','tender_sector_matches',
    'duplicate_candidates','recommendations','compliance_checks','saved_searches','saved_tenders','notification_rules',
    'notifications','notification_delivery_attempts','subscriptions','payments','invoices','qa_tasks','audit_logs',
    'partner_preferences','partner_matches','subcontracting_opportunities','award_records','competitor_profiles',
    'bid_packages','bid_package_documents'
  ]
  loop
    execute format(
      'create policy %I on %I for all using (is_ops_admin()) with check (is_ops_admin())',
      tbl || '_ops_admin_all',
      tbl
    );
  end loop;
end $$;

create policy "organizations_select_member" on organizations for select using (is_active_member(id) or is_ops_admin());
create policy "organizations_update_owner_admin" on organizations for update using (has_org_role(id, array['owner','admin']::app_role[]) or is_ops_admin());

create policy "profiles_select_self" on profiles for select using (user_id = auth.uid() or is_ops_admin());
create policy "profiles_insert_self" on profiles for insert with check (user_id = auth.uid());
create policy "profiles_update_self" on profiles for update using (user_id = auth.uid());

create policy "memberships_select_member_or_ops" on memberships for select using (is_active_member(organization_id) or is_ops_admin());
create policy "memberships_manage_owner_admin" on memberships for all using (has_org_role(organization_id, array['owner','admin']::app_role[]) or is_ops_admin()) with check (has_org_role(organization_id, array['owner','admin']::app_role[]) or is_ops_admin());

create policy "invitations_select_admin" on invitations for select using (has_org_role(organization_id, array['owner','admin']::app_role[]) or is_ops_admin());
create policy "invitations_manage_admin" on invitations for all using (has_org_role(organization_id, array['owner','admin']::app_role[]) or is_ops_admin()) with check (has_org_role(organization_id, array['owner','admin']::app_role[]) or is_ops_admin());

create policy "tender_sources_ops_read" on tender_sources for select using (is_ops_admin());
create policy "tender_sources_ops_write" on tender_sources for all using (is_ops_admin()) with check (is_ops_admin());
create policy "ingestion_runs_ops_read" on ingestion_runs for select using (is_ops_admin());
create policy "raw_source_snapshots_ops_read" on raw_source_snapshots for select using (is_ops_admin());
create policy "field_extraction_rules_ops" on field_extraction_rules for all using (is_ops_admin()) with check (is_ops_admin());
create policy "duplicate_candidates_ops" on duplicate_candidates for all using (is_ops_admin()) with check (is_ops_admin());
create policy "qa_tasks_ops_global" on qa_tasks for all using (is_ops_admin() or (organization_id is not null and is_active_member(organization_id))) with check (is_ops_admin());
create policy "audit_logs_select_member_or_ops" on audit_logs for select using (is_ops_admin() or (organization_id is not null and has_org_role(organization_id, array['owner','admin']::app_role[])));

create policy "tenders_public_published" on tenders for select using (status = 'published' or is_ops_admin());
create policy "tenders_ops_write" on tenders for all using (is_ops_admin()) with check (is_ops_admin());
create policy "tender_links_visible" on tender_source_links for select using (exists (select 1 from tenders where tenders.id = tender_source_links.tender_id and (tenders.status = 'published' or is_ops_admin())));
create policy "tender_documents_ops" on tender_documents for select using (is_ops_admin());
create policy "parsed_text_ops" on parsed_document_text for select using (is_ops_admin());
create policy "extracted_fields_visible" on extracted_fields for select using (exists (select 1 from tenders where tenders.id = extracted_fields.tender_id and (tenders.status = 'published' or is_ops_admin())));
create policy "extracted_fields_ops_write" on extracted_fields for all using (is_ops_admin()) with check (is_ops_admin());
create policy "sector_matches_visible" on tender_sector_matches for select using (exists (select 1 from tenders where tenders.id = tender_sector_matches.tender_id and (tenders.status = 'published' or is_ops_admin())));
create policy "award_records_visible" on award_records for select using (true);

create policy "recommendations_member" on recommendations for select using (is_active_member(organization_id) or is_ops_admin());
create policy "compliance_member" on compliance_checks for select using (is_active_member(organization_id) or is_ops_admin());

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'company_profiles','pec_licenses','engineers','equipment','profile_documents','saved_searches',
    'saved_tenders','notification_rules','notifications','subscriptions','payments','invoices',
    'partner_preferences','partner_matches','subcontracting_opportunities','competitor_profiles',
    'bid_packages','bid_package_documents'
  ]
  loop
    execute format('create policy %I_select_org on %I for select using (is_active_member(organization_id) or is_ops_admin())', tbl, tbl);
    execute format('create policy %I_insert_org on %I for insert with check (has_org_role(organization_id, array[''owner'',''admin'',''member'']::app_role[]) or is_ops_admin())', tbl, tbl);
    execute format('create policy %I_update_org on %I for update using (has_org_role(organization_id, array[''owner'',''admin'',''member'']::app_role[]) or is_ops_admin()) with check (has_org_role(organization_id, array[''owner'',''admin'',''member'']::app_role[]) or is_ops_admin())', tbl, tbl);
    execute format('create policy %I_delete_org on %I for delete using (has_org_role(organization_id, array[''owner'',''admin'']::app_role[]) or is_ops_admin())', tbl, tbl);
  end loop;
end $$;

create policy "notification_attempts_owner" on notification_delivery_attempts
for select using (
  exists (
    select 1 from notifications n
    where n.id = notification_delivery_attempts.notification_id
      and (is_active_member(n.organization_id) or is_ops_admin())
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-documents', 'profile-documents', false, 52428800, null),
  ('tender-documents', 'tender-documents', false, 104857600, null),
  ('tender-source-snapshots', 'tender-source-snapshots', false, 104857600, null),
  ('newspaper-clippings', 'newspaper-clippings', false, 104857600, null),
  ('bid-package-documents', 'bid-package-documents', false, 52428800, null)
on conflict (id) do nothing;

create policy "profile_docs_storage_read" on storage.objects
for select using (
  bucket_id = 'profile-documents'
  and is_active_member((storage.foldername(name))[1]::uuid)
);

create policy "profile_docs_storage_write" on storage.objects
for insert with check (
  bucket_id = 'profile-documents'
  and has_org_role((storage.foldername(name))[1]::uuid, array['owner','admin','member']::app_role[])
);

create policy "bid_package_storage_read" on storage.objects
for select using (
  bucket_id = 'bid-package-documents'
  and is_active_member((storage.foldername(name))[1]::uuid)
);

create policy "bid_package_storage_write" on storage.objects
for insert with check (
  bucket_id = 'bid-package-documents'
  and has_org_role((storage.foldername(name))[1]::uuid, array['owner','admin','member']::app_role[])
);

create policy "ops_private_storage_read" on storage.objects
for select using (
  bucket_id in ('tender-documents', 'tender-source-snapshots', 'newspaper-clippings')
  and is_ops_admin()
);

create policy "ops_private_storage_write" on storage.objects
for all using (
  bucket_id in ('tender-documents', 'tender-source-snapshots', 'newspaper-clippings')
  and is_ops_admin()
) with check (
  bucket_id in ('tender-documents', 'tender-source-snapshots', 'newspaper-clippings')
  and is_ops_admin()
);
