-- Carousel Agent persistence schema

create table if not exists public.carousel_agent_generations (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  focus text,
  topic text not null,
  angle_rationale text,
  caption text,
  cta text,
  hashtags text[] not null default '{}',
  strategy_checklist text[] not null default '{}',
  spin_off_angles text[] not null default '{}',
  reasoning_model varchar(120),
  image_model varchar(120),
  generated_images boolean not null default true,
  status varchar(50) not null default 'completed',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.carousel_agent_generation_slides (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.carousel_agent_generations(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  slide_number int not null,
  role varchar(80),
  density varchar(20),
  overlay_title text,
  overlay_lines text[] not null default '{}',
  headline text,
  body_bullets text[] not null default '{}',
  voice_script text,
  hook_purpose text,
  caps_words text[] not null default '{}',
  visual_direction text,
  image_prompt text,
  alt_text text,
  image_url text,
  created_at timestamptz not null default now(),
  unique (generation_id, slide_number)
);

create index if not exists idx_carousel_agent_generations_collection
  on public.carousel_agent_generations(collection_id);

create index if not exists idx_carousel_agent_generation_slides_generation
  on public.carousel_agent_generation_slides(generation_id);
