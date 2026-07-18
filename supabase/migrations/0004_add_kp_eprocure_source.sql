-- KP's EPADS public portal has a separate public API and document flow from
-- the legacy KPPRA active-tenders site, so it is indexed as its own source.
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
  'KP eProcure Public Tenders',
  'https://portalkp.eprocure.gov.pk/#/tenders/Epadtenders',
  'provincial'::tender_source_type,
  'Khyber Pakhtunkhwa',
  'kp-eprocure',
  360,
  'active'::tender_source_status,
  jsonb_build_object(
    'sourceGroup', 'kp_eprocure',
    'portalFamily', 'kp_eprocure',
    'documentPrefix', 'tender_KP_EPROCURE',
    'knownSourceDomains', array['portalkp.eprocure.gov.pk', 'apiprd.eprocure.gov.pk', 'kp.eprocure.gov.pk', 'kppra.gov.pk']
  )
where not exists (
  select 1 from tender_sources where adapter_key = 'kp-eprocure'
);
