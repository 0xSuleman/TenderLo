with seed_config as (
  select
    '00000000-0000-4000-8000-000000000001'::uuid as fallback_user_id,
    '00000000-0000-4000-8000-000000000010'::uuid as organization_id,
    'admin@tenderlo.local'::text as email,
    'TenderLo Admin'::text as full_name,
    'TenderLo Internal Ops'::text as organization_name,
    'TenderLo Admin123!'::text as password
),
existing_auth_user as (
  select auth.users.id
  from auth.users
  join seed_config on lower(auth.users.email) = seed_config.email
  limit 1
),
insert_auth_user as (
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  select
    '00000000-0000-0000-0000-000000000000'::uuid,
    fallback_user_id,
    'authenticated',
    'authenticated',
    email,
    crypt(password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', full_name),
    now(),
    now()
  from seed_config
  where not exists (select 1 from existing_auth_user)
  on conflict (id) do update set
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now()
  returning id
),
seed_admin as (
  select
    coalesce((select id from existing_auth_user), (select id from insert_auth_user), fallback_user_id) as user_id,
    organization_id,
    email,
    full_name,
    organization_name,
    password
  from seed_config
),
upsert_auth_user as (
  update auth.users
  set
    email = seed_admin.email,
    encrypted_password = crypt(seed_admin.password, gen_salt('bf')),
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
    raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
    raw_user_meta_data = jsonb_build_object('full_name', seed_admin.full_name),
    updated_at = now()
  from seed_admin
  where auth.users.id = seed_admin.user_id
  returning auth.users.id
),
upsert_auth_identity as (
  insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  select
    user_id::text,
    user_id,
    user_id::text,
    jsonb_build_object('sub', user_id::text, 'email', email, 'email_verified', true),
    'email',
    now(),
    now(),
    now()
  from seed_admin
  on conflict (provider_id, provider) do update set
    user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = now()
  returning id
),
upsert_admin_org as (
  insert into organizations (id, name, legal_name, primary_contact_name, primary_contact_email, city, province)
  select organization_id, organization_name, organization_name, full_name, email, 'Lahore', 'Punjab'
  from seed_admin
  on conflict (id) do update set
    name = excluded.name,
    legal_name = excluded.legal_name,
    primary_contact_name = excluded.primary_contact_name,
    primary_contact_email = excluded.primary_contact_email,
    city = excluded.city,
    province = excluded.province,
    updated_at = now()
  returning id
),
upsert_admin_profile as (
  insert into profiles (user_id, full_name)
  select user_id, full_name from seed_admin
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    updated_at = now()
  returning id
),
upsert_admin_membership as (
  insert into memberships (organization_id, user_id, role, status)
  select organization_id, user_id, 'ops_admin', 'active' from seed_admin
  on conflict (organization_id, user_id) do update set
    role = excluded.role,
    status = excluded.status,
    updated_at = now()
  returning id
),
upsert_admin_company_profile as (
  insert into company_profiles (organization_id, business_type, operating_regions, sectors, profile_completeness_score)
  select organization_id, 'internal_ops', array['Punjab'], array['general_contracting'], 20 from seed_admin
  on conflict (organization_id) do update set
    business_type = excluded.business_type,
    operating_regions = excluded.operating_regions,
    sectors = excluded.sectors,
    profile_completeness_score = excluded.profile_completeness_score,
    updated_at = now()
  returning id
),
insert_admin_subscription as (
  insert into subscriptions (organization_id, plan, status, provider, provider_subscription_id, current_period_start)
  select organization_id, 'enterprise', 'manual_invoice', 'seed', 'seed-admin-enterprise', now() from seed_admin
  where not exists (
    select 1
    from subscriptions
    where subscriptions.organization_id = seed_admin.organization_id
      and subscriptions.provider = 'seed'
      and subscriptions.provider_subscription_id = 'seed-admin-enterprise'
  )
  returning id
)
insert into audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, new_value)
select
  organization_id,
  user_id,
  'seed.ops_admin.created',
  'membership',
  organization_id,
  jsonb_build_object('email', email, 'role', 'ops_admin')
from seed_admin
where not exists (
  select 1
  from audit_logs
  where audit_logs.action = 'seed.ops_admin.created'
    and audit_logs.actor_user_id = seed_admin.user_id
    and audit_logs.entity_id = seed_admin.organization_id
);

insert into tender_sources (name, base_url, source_type, region, adapter_key, scrape_frequency_minutes, status)
values
  ('Federal EPADS Open Procurements', 'https://epads.gov.pk/open-procurements', 'federal', 'Pakistan', 'federal-epads', 240, 'active'),
  ('Federal PPRA Active Tenders', 'https://epms.ppra.gov.pk/public/tenders/active-tenders', 'federal', 'Pakistan', 'federal-ppra-active', 240, 'active'),
  ('Punjab PPRA', 'https://ppra.punjab.gov.pk/', 'provincial', 'Punjab', 'punjab-ppra', 360, 'active'),
  ('Sindh SPPRA Tender List', 'https://e.pprasindh.gov.pk/tenderlst', 'provincial', 'Sindh', 'sindh-sppra', 360, 'active'),
  ('KP Public Tenders', 'https://kp.gov.pk/page/tenders', 'provincial', 'Khyber Pakhtunkhwa', 'kp-tenders', 720, 'active'),
  ('Business Recorder Tenders', 'https://www.brecorder.com/business-finance/tenders', 'newspaper', 'Pakistan', 'business-recorder-tenders', 720, 'active'),
  ('Jang Public E-Paper Karachi', 'https://e.jang.com.pk/karachi/', 'newspaper', 'Pakistan', 'jang-epaper-public', 1440, 'active')
on conflict do nothing;

insert into field_extraction_rules (field_name, rule_type, pattern, source_adapter_key, confidence_weight, enabled)
values
  ('closing_date', 'keyword_window', '(closing date|last date|submission deadline|bid submission|receiving of tenders)', null, 0.88, true),
  ('opening_date', 'keyword_window', '(opening date|bid opening|opening of tenders)', null, 0.82, true),
  ('bid_security_amount', 'keyword_window', '(bid security|earnest money|security deposit|call deposit|bid bond)', null, 0.88, true),
  ('estimated_value', 'keyword_window', '(estimated cost|estimated value|NIT cost|engineer estimate|project cost)', null, 0.8, true),
  ('document_fee', 'keyword_window', '(tender fee|document fee|bidding document fee)', null, 0.72, true),
  ('pec_category', 'regex', '(C-A|C-B|C-1|C-2|C-3|C-4|C-5|C-6)', null, 0.9, true),
  ('department', 'keyword_window', '(department|authority|office of|ministry|directorate|division)', null, 0.7, true)
on conflict do nothing;
