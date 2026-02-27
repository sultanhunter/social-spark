-- Pinterest Agent persistence schema

create table if not exists public.pinterest_agent_generations (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  focus text,
  topic text not null,
  angle_rationale text,
  style_theme text,
  style_direction text,
  script jsonb not null default '{}'::jsonb,
  image_prompt text,
  alt_text text,
  image_url text,
  reasoning_model varchar(120),
  image_model varchar(120),
  status varchar(50) not null default 'completed',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pinterest_agent_generations_collection
  on public.pinterest_agent_generations(collection_id);
