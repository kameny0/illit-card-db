-- Photocard Archive: initial schema
-- Run this whole file in Supabase SQL Editor.
-- Create a Supabase Storage bucket named "card-images" and make it PUBLIC.
-- Public bucket means anyone with an image URL can view images, including pending uploads.
-- Never put the Supabase service_role/secret key in frontend code.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'user',
  role text not null default 'member' check (role in ('member','admin')),
  account_status text not null default 'pending' check (account_status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists account_status text not null default 'pending' check (account_status in ('pending','approved','rejected'));

create table if not exists public.site_settings (
  id boolean primary key default true check (id = true),
  require_user_approval boolean not null default true,
  require_card_approval boolean not null default true,
  require_price_approval boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.site_settings(id) values (true) on conflict (id) do nothing;

create table if not exists public.groups (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table if not exists public.members (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  name text not null,
  unique(group_id, name)
);

create table if not exists public.albums (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  name text not null,
  release_date date,
  unique(group_id, name)
);

create table if not exists public.cards (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id),
  member_id bigint not null references public.members(id),
  album_id bigint references public.albums(id),
  card_name text not null,
  benefit text,
  image_path text not null,
  image_hash text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.price_entries (
  id bigint generated always as identity primary key,
  card_id bigint not null references public.cards(id) on delete cascade,
  user_id uuid references auth.users(id),
  price integer not null check (price > 0),
  price_type text not null check (price_type in ('sold','listing')),
  source text not null,
  source_url text,
  transaction_date date,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

create index if not exists cards_member_idx on public.cards(member_id);
create index if not exists cards_album_idx on public.cards(album_id);
create index if not exists cards_status_idx on public.cards(status);
create index if not exists cards_image_hash_idx on public.cards(image_hash);
create index if not exists prices_card_idx on public.price_entries(card_id);
create index if not exists prices_status_idx on public.price_entries(status);

-- New account profile creation.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, role, account_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user'),
    'member',
    case when coalesce((select require_user_approval from public.site_settings where id = true), true) then 'pending' else 'approved' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Admin helper. Users cannot promote themselves because profiles UPDATE is restricted.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- RLS
alter table public.site_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.albums enable row level security;
alter table public.cards enable row level security;
alter table public.price_entries enable row level security;


drop policy if exists "settings read" on public.site_settings;
create policy "settings read" on public.site_settings for select to authenticated using (true);
drop policy if exists "settings admin update" on public.site_settings;
create policy "settings admin update" on public.site_settings for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "profile read" on public.profiles;
create policy "profile read" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "profile update own username" on public.profiles;
-- Profile role and account_status can only be changed by admins.

drop policy if exists "groups read" on public.groups;
create policy "groups read" on public.groups for select to anon, authenticated using (true);
drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select to anon, authenticated using (true);
drop policy if exists "albums read" on public.albums;
create policy "albums read" on public.albums for select to anon, authenticated using (true);

drop policy if exists "groups admin all" on public.groups;
create policy "groups admin all" on public.groups for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "members admin all" on public.members;
create policy "members admin all" on public.members for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "albums admin all" on public.albums;
create policy "albums admin all" on public.albums for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "cards read approved or admin" on public.cards;
create policy "cards read approved or admin" on public.cards for select to anon, authenticated
using (status = 'approved' or (select public.is_admin()));

drop policy if exists "cards submit pending" on public.cards;
create policy "cards submit pending" on public.cards for insert to authenticated
with check (submitted_by = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.account_status = 'approved') and status = case when (select require_card_approval from public.site_settings where id = true) then 'pending' else 'approved' end);

drop policy if exists "cards admin update" on public.cards;
create policy "cards admin update" on public.cards for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "cards admin delete" on public.cards;
create policy "cards admin delete" on public.cards for delete to authenticated
using ((select public.is_admin()));

drop policy if exists "prices read approved or admin" on public.price_entries;
create policy "prices read approved or admin" on public.price_entries for select to anon, authenticated
using (
  (status = 'approved' and exists (
    select 1 from public.cards c where c.id = card_id and c.status = 'approved'
  ))
  or (select public.is_admin())
);

drop policy if exists "prices submit pending" on public.price_entries;
create policy "prices submit pending" on public.price_entries for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.account_status = 'approved') and status = case when (select require_price_approval from public.site_settings where id = true) then 'pending' else 'approved' end);

drop policy if exists "prices admin update" on public.price_entries;
create policy "prices admin update" on public.price_entries for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "prices admin delete" on public.price_entries;
create policy "prices admin delete" on public.price_entries for delete to authenticated
using ((select public.is_admin()));

-- Storage policies. Create the "card-images" bucket in Storage first and set it Public.
drop policy if exists "card images public read" on storage.objects;
create policy "card images public read" on storage.objects for select to anon, authenticated
using (bucket_id = 'card-images');

drop policy if exists "users upload own card images" on storage.objects;
create policy "users upload own card images" on storage.objects for insert to authenticated
with check (
  bucket_id = 'card-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "admin delete card images" on storage.objects;
create policy "admin delete card images" on storage.objects for delete to authenticated
using (bucket_id = 'card-images' and (select public.is_admin()));

-- Seed initial ILLIT group and members. Album catalog can be entered by admins later.
insert into public.groups(name) values ('ILLIT') on conflict (name) do nothing;

insert into public.members(group_id, name)
select g.id, m.name
from public.groups g
cross join (values ('YUNAH'),('MINJU'),('MOKA'),('WONHEE'),('IROHA')) as m(name)
where g.name = 'ILLIT'
on conflict (group_id, name) do nothing;

-- After you create your own account, promote it to admin with:
-- update public.profiles
-- set role = 'admin'
-- where id = (select id from auth.users where email = 'YOUR_EMAIL');
