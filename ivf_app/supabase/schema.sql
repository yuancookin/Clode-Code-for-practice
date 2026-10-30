-- 体外受精スケジュール用のテーブル
-- Supabase の SQL Editor に貼り付けて「Run」を押してください。
-- 何度実行しても大丈夫です（前のバージョンから更新するときも、これをそのまま実行します）。

create extension if not exists pgcrypto with schema extensions;

-- 共有スペース（パートナーと同じ予定を見るための単位）
create table if not exists public.ivf_groups (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  pin_hash   text not null,               -- 暗証番号（ハッシュにして保存）
  version    bigint not null default 0,   -- 保存のたびに1増える（同時編集の上書き防止）
  created_at timestamptz not null default now()
);

-- 共有スペースのメンバー（1人1つ）
create table if not exists public.ivf_members (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  group_id  uuid not null references public.ivf_groups (id) on delete cascade,
  joined_at timestamptz not null default now()
);

-- 暗証番号の入力ミスの記録（総当たり対策）
create table if not exists public.ivf_join_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);

-- 予定（1日1件。同じ日に複数入れてもよい）
create table if not exists public.ivf_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  kind       text not null,
  memo       text not null default '',
  cycle      int  not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.ivf_events add column if not exists group_id uuid references public.ivf_groups (id) on delete cascade;
create index if not exists ivf_events_group_date on public.ivf_events (group_id, date);

-- 「作り直す」の条件（1人1行）
create table if not exists public.ivf_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  params     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 自分が入っている共有スペース
create or replace function public.ivf_my_group()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select group_id from public.ivf_members where user_id = auth.uid()
$$;

-- 権限：共有スペース関係のテーブルは関数からだけ触れる
revoke all on public.ivf_groups, public.ivf_members, public.ivf_join_attempts from anon, authenticated;
revoke all on public.ivf_events, public.ivf_settings from anon;
grant select, insert, update, delete on public.ivf_events, public.ivf_settings to authenticated;

alter table public.ivf_groups        enable row level security;
alter table public.ivf_members       enable row level security;
alter table public.ivf_join_attempts enable row level security;
alter table public.ivf_events        enable row level security;
alter table public.ivf_settings      enable row level security;

-- 予定は「同じ共有スペースのメンバー」だけが読み書きできる
drop policy if exists "own events" on public.ivf_events;
drop policy if exists "group events" on public.ivf_events;
create policy "group events" on public.ivf_events
  for all to authenticated
  using (group_id = (select public.ivf_my_group()))
  with check (group_id = (select public.ivf_my_group()));

drop policy if exists "own settings" on public.ivf_settings;
create policy "own settings" on public.ivf_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 共有スペースの情報（メンバーのメールアドレスと版番号）。入っていなければ null
create or replace function public.ivf_group_info()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'group_id', g.id,
           'version', g.version,
           'owner_email', (select email from auth.users where id = g.owner_id),
           'members', (select jsonb_agg(u.email order by m.joined_at)
                         from public.ivf_members m join auth.users u on u.id = m.user_id
                        where m.group_id = g.id))
    from public.ivf_groups g
   where g.id = public.ivf_my_group()
$$;

-- 共有スペースを新しく作る（暗証番号を決める）。今までの自分の予定はそこへ移す
create or replace function public.create_ivf_group(p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.ivf_my_group() is not null then raise exception 'already in a group'; end if;
  if p_pin !~ '^[0-9]{4,12}$' then raise exception 'pin must be 4-12 digits'; end if;
  insert into public.ivf_groups (owner_id, pin_hash)
  values (auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf')))
  returning id into g;
  insert into public.ivf_members (user_id, group_id) values (auth.uid(), g);
  update public.ivf_events set group_id = g where user_id = auth.uid() and group_id is null;
  return g;
end;
$$;

-- パートナーの共有スペースに参加する（相手のメールアドレス＋暗証番号）
-- 合わなければ null を返す。1時間に5回まちがえると、しばらく試せない
create or replace function public.join_ivf_group(p_owner_email text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare g uuid; h text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.ivf_my_group() is not null then raise exception 'already in a group'; end if;
  if (select count(*) from public.ivf_join_attempts
       where user_id = auth.uid() and at > now() - interval '1 hour') >= 5 then
    raise exception 'too many attempts';
  end if;
  select gr.id, gr.pin_hash into g, h
    from public.ivf_groups gr join auth.users u on u.id = gr.owner_id
   where lower(u.email) = lower(trim(p_owner_email));
  if g is null or h <> extensions.crypt(p_pin, h) then
    insert into public.ivf_join_attempts (user_id) values (auth.uid());
    return null;
  end if;
  insert into public.ivf_members (user_id, group_id) values (auth.uid(), g);
  return g;
end;
$$;

-- 共有スペースの予定をまるごと置き換える（1回のトランザクション）
-- p_version が今の版と違えば（＝パートナーが先に保存していたら）エラーにする
drop function if exists public.replace_ivf_events(jsonb);
create or replace function public.replace_ivf_events(p_rows jsonb, p_version bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare g uuid; v bigint;
begin
  g := public.ivf_my_group();
  if g is null then raise exception 'no group'; end if;
  select version into v from public.ivf_groups where id = g for update;
  if p_version is not null and v <> p_version then raise exception 'version conflict'; end if;
  delete from public.ivf_events where group_id = g;
  insert into public.ivf_events (user_id, group_id, date, kind, memo, cycle)
  select auth.uid(), g,
         (r ->> 'date')::date,
         r ->> 'kind',
         coalesce(r ->> 'memo', ''),
         coalesce((r ->> 'cycle')::int, 0)
    from jsonb_array_elements(p_rows) as r;
  update public.ivf_groups set version = v + 1 where id = g;
  return v + 1;
end;
$$;

revoke execute on function public.ivf_my_group()                       from public, anon;
revoke execute on function public.ivf_group_info()                     from public, anon;
revoke execute on function public.create_ivf_group(text)               from public, anon;
revoke execute on function public.join_ivf_group(text, text)           from public, anon;
revoke execute on function public.replace_ivf_events(jsonb, bigint)    from public, anon;
grant  execute on function public.ivf_my_group()                       to authenticated;
grant  execute on function public.ivf_group_info()                     to authenticated;
grant  execute on function public.create_ivf_group(text)               to authenticated;
grant  execute on function public.join_ivf_group(text, text)           to authenticated;
grant  execute on function public.replace_ivf_events(jsonb, bigint)    to authenticated;
