-- The Weekly Table: database setup.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- It is safe to run more than once.

create table if not exists public.docs (
  code       text        not null check (char_length(code) between 8 and 64),
  path       text        not null check (char_length(path) between 1 and 200),
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (code, path)
);

-- Lock the table: the browser can never read or write it directly.
alter table public.docs enable row level security;
revoke all on public.docs from anon, authenticated;

-- The only way in is through these functions, and each one requires the
-- household code (a long random secret, like a shared password).

create or replace function public.wt_list(p_code text)
returns table(path text, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select d.path, d.updated_at
  from public.docs d
  where d.code = p_code and char_length(p_code) >= 8;
$$;

create or replace function public.wt_get(p_code text, p_paths text[] default null)
returns table(path text, data jsonb, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select d.path, d.data, d.updated_at
  from public.docs d
  where d.code = p_code and char_length(p_code) >= 8
    and (p_paths is null or d.path = any(p_paths));
$$;

create or replace function public.wt_put(p_code text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if p_code is null or char_length(p_code) < 8 then
    raise exception 'invalid household code';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    raise exception 'invalid rows';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.docs (code, path, data, updated_at)
    values (p_code, r->>'path', r->'data', now())
    on conflict (code, path)
    do update set data = excluded.data, updated_at = now();
  end loop;
end $$;

create or replace function public.wt_del(p_code text, p_path text)
returns void
language sql security definer set search_path = public as $$
  delete from public.docs
  where code = p_code and path = p_path and char_length(p_code) >= 8;
$$;

revoke all on function public.wt_list(text)               from public;
revoke all on function public.wt_get(text, text[])        from public;
revoke all on function public.wt_put(text, jsonb)         from public;
revoke all on function public.wt_del(text, text)          from public;
grant execute on function public.wt_list(text)            to anon;
grant execute on function public.wt_get(text, text[])     to anon;
grant execute on function public.wt_put(text, jsonb)      to anon;
grant execute on function public.wt_del(text, text)       to anon;
