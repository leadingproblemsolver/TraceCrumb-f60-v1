-- Intelligence graph migration — run after 001 (schema.sql).
-- Uses same is_org_member() helper and policy pattern as the base schema.

-- Org-level intelligence graph: one JSON blob per org, incrementally updated.
create table if not exists public.org_intelligence_graph (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  graph      jsonb not null default '{
    "version":"1.0",
    "nodes":{},
    "edges":{},
    "patterns":{"failure_patterns":[],"successful_resolutions":[],"known_risks":[],"unresolved":[]},
    "index":{"by_service":{},"by_type":{},"by_outcome":{}}
  }'::jsonb,
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint org_intelligence_graph_org_unique unique (org_id)
);

-- User-level overlay: personal incident history, not shared org-wide.
create table if not exists public.user_intelligence_graph (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  graph      jsonb not null default '{
    "version":"1.0",
    "nodes":{},
    "edges":{},
    "patterns":{"failure_patterns":[],"successful_resolutions":[],"known_risks":[],"unresolved":[]},
    "index":{"by_service":{},"by_type":{},"by_outcome":{}}
  }'::jsonb,
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint user_intelligence_graph_unique unique (org_id, user_id)
);

-- LLM decision packets: full template sent + response received, per incident call.
create table if not exists public.decision_packets (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  user_id            uuid references auth.users(id) on delete set null,
  incident_id        uuid references public.incidents(id) on delete set null,
  recommendation_id  uuid references public.incident_recommendations(id) on delete set null,
  packet_version     text not null default 'v1',
  template           jsonb not null,
  response           jsonb,
  rule_evaluations   jsonb not null default '[]'::jsonb,
  subgraph_ids       text[] not null default '{}',
  created_at         timestamptz not null default now()
);

-- Indexes
create index if not exists idx_org_graph_org on public.org_intelligence_graph(org_id);
create index if not exists idx_user_graph_user on public.user_intelligence_graph(user_id, org_id);
create index if not exists idx_decision_packets_incident on public.decision_packets(incident_id);
create index if not exists idx_decision_packets_org_created on public.decision_packets(org_id, created_at desc);

-- Updated-at triggers
drop trigger if exists set_org_intelligence_graph_updated_at on public.org_intelligence_graph;
create trigger set_org_intelligence_graph_updated_at
  before update on public.org_intelligence_graph
  for each row execute function public.set_updated_at();

drop trigger if exists set_user_intelligence_graph_updated_at on public.user_intelligence_graph;
create trigger set_user_intelligence_graph_updated_at
  before update on public.user_intelligence_graph
  for each row execute function public.set_updated_at();

-- RLS
alter table public.org_intelligence_graph enable row level security;
alter table public.user_intelligence_graph enable row level security;
alter table public.decision_packets enable row level security;

-- org_intelligence_graph: any org member can read/write the org graph
drop policy if exists org_graph_select on public.org_intelligence_graph;
create policy org_graph_select on public.org_intelligence_graph
  for select using (public.is_org_member(org_id));

drop policy if exists org_graph_insert on public.org_intelligence_graph;
create policy org_graph_insert on public.org_intelligence_graph
  for insert with check (public.is_org_member(org_id));

drop policy if exists org_graph_update on public.org_intelligence_graph;
create policy org_graph_update on public.org_intelligence_graph
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- user_intelligence_graph: own data only
drop policy if exists user_graph_select on public.user_intelligence_graph;
create policy user_graph_select on public.user_intelligence_graph
  for select using (user_id = auth.uid());

drop policy if exists user_graph_insert on public.user_intelligence_graph;
create policy user_graph_insert on public.user_intelligence_graph
  for insert with check (user_id = auth.uid() and public.is_org_member(org_id));

drop policy if exists user_graph_update on public.user_intelligence_graph;
create policy user_graph_update on public.user_intelligence_graph
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- decision_packets: org members can read all, insert own
drop policy if exists decision_packets_select on public.decision_packets;
create policy decision_packets_select on public.decision_packets
  for select using (public.is_org_member(org_id));

drop policy if exists decision_packets_insert on public.decision_packets;
create policy decision_packets_insert on public.decision_packets
  for insert with check (public.is_org_member(org_id));

drop policy if exists decision_packets_update on public.decision_packets;
create policy decision_packets_update on public.decision_packets
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
