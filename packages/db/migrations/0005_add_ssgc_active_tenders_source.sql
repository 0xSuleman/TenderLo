-- Keep the package migration copy aligned with Supabase migrations.
alter table tender_sources
  add column if not exists metadata jsonb not null default '{}'::jsonb;

insert into tender_sources (
  name,
  base_url,
  source_type,
  region,
  adapter_key,
  scrape_frequency_minutes,
  status,
  metadata
)
select
  'Sui Southern Gas Company Active Tenders',
  'https://www.ssgc.com.pk/web/?page_id=111492',
  'department'::tender_source_type,
  'Pakistan',
  'ssgc-active-tenders',
  360,
  'active'::tender_source_status,
  jsonb_build_object(
    'sourceGroup', 'ssgc',
    'portalFamily', 'ssgc',
    'documentPrefix', 'tender_SSGC',
    'knownSourceDomains', array['ssgc.com.pk', 'www.ssgc.com.pk']
  )
where not exists (
  select 1 from tender_sources where adapter_key = 'ssgc-active-tenders'
);
