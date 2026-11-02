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

-- 「作り直す」の条件（以前は1人1行。今は共有スペースの params に移した）
create table if not exists public.ivf_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  params     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 合言葉方式：共有スペースは合言葉で見分ける（同じ合言葉のスペースは作れない）
alter table public.ivf_groups add column if not exists phrase_key text unique;
alter table public.ivf_groups add column if not exists params jsonb;
update public.ivf_groups g set params = s.params
  from public.ivf_settings s
 where s.user_id = g.owner_id and g.params is null;

-- 端末ごとの匿名ユーザーを消しても、予定は消えないようにする
alter table public.ivf_groups alter column owner_id drop not null;
alter table public.ivf_groups alter column pin_hash drop not null;
alter table public.ivf_groups drop constraint if exists ivf_groups_owner_id_fkey;
alter table public.ivf_groups add constraint ivf_groups_owner_id_fkey
  foreign key (owner_id) references auth.users (id) on delete set null;
alter table public.ivf_events alter column user_id drop not null;
alter table public.ivf_events drop constraint if exists ivf_events_user_id_fkey;
alter table public.ivf_events add constraint ivf_events_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

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

-- 共有スペースの情報（版番号と、合言葉が決まっているか）。入っていなければ null
create or replace function public.ivf_group_info()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'group_id', g.id,
           'version', g.version,
           'has_phrase', g.phrase_key is not null)
    from public.ivf_groups g
   where g.id = public.ivf_my_group()
$$;

-- 合言葉は同じハッシュで探せるようにしておく（本文は保存しない）
create or replace function public.ivf_phrase_key(p_phrase text)
returns text
language sql immutable
set search_path = public
as $$
  select encode(extensions.digest('ivf-phrase:' || p_phrase, 'sha256'), 'hex')
$$;

-- 総当たり対策。匿名ユーザーは作り直せるので、1人ごとの回数に加えて全体の回数も見る
create or replace function public.ivf_check_attempts()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.ivf_join_attempts where at < now() - interval '1 day';
  if (select count(*) from public.ivf_join_attempts
       where user_id = auth.uid() and at > now() - interval '1 hour') >= 5
     or (select count(*) from public.ivf_join_attempts
          where at > now() - interval '10 minutes') >= 30 then
    raise exception 'too many attempts';
  end if;
end;
$$;

-- 合言葉を決めて共有スペースを作る。すでに使われている合言葉なら false
create or replace function public.create_ivf_space(p_phrase text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare g uuid;
begin
  perform public.ivf_check_attempts();
  if public.ivf_my_group() is not null then raise exception 'already in a group'; end if;
  if char_length(p_phrase) < 8 then raise exception 'phrase too short'; end if;
  insert into public.ivf_groups (owner_id, phrase_key)
  values (auth.uid(), public.ivf_phrase_key(p_phrase))
  on conflict (phrase_key) do nothing
  returning id into g;
  if g is null then
    insert into public.ivf_join_attempts (user_id) values (auth.uid());
    return false;
  end if;
  insert into public.ivf_members (user_id, group_id) values (auth.uid(), g);
  return true;
end;
$$;

-- 合言葉で共有スペースに入る。合わなければ false
create or replace function public.join_ivf_space(p_phrase text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare g uuid;
begin
  perform public.ivf_check_attempts();
  if public.ivf_my_group() is not null then raise exception 'already in a group'; end if;
  select id into g from public.ivf_groups where phrase_key = public.ivf_phrase_key(p_phrase);
  if g is null then
    insert into public.ivf_join_attempts (user_id) values (auth.uid());
    return false;
  end if;
  insert into public.ivf_members (user_id, group_id) values (auth.uid(), g);
  return true;
end;
$$;

-- 今の共有スペースの合言葉を決める・変える。ほかの端末は新しい合言葉で入り直す
-- すでに使われている合言葉なら false
create or replace function public.set_ivf_phrase(p_phrase text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare g uuid;
begin
  perform public.ivf_check_attempts();
  g := public.ivf_my_group();
  if g is null then raise exception 'no group'; end if;
  if char_length(p_phrase) < 8 then raise exception 'phrase too short'; end if;
  begin
    update public.ivf_groups set phrase_key = public.ivf_phrase_key(p_phrase), pin_hash = null where id = g;
  exception when unique_violation then
    insert into public.ivf_join_attempts (user_id) values (auth.uid());
    return false;
  end;
  delete from public.ivf_members where group_id = g and user_id <> auth.uid();
  return true;
end;
$$;

-- 以前の共有スペースを引き継ぐ（作った人のメールアドレス＋暗証番号）
-- 合言葉を決めたあとのスペースには、この方法では入れない。合わなければ null
create or replace function public.join_ivf_group(p_owner_email text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare g uuid; h text;
begin
  perform public.ivf_check_attempts();
  if public.ivf_my_group() is not null then raise exception 'already in a group'; end if;
  select gr.id, gr.pin_hash into g, h
    from public.ivf_groups gr join auth.users u on u.id = gr.owner_id
   where lower(u.email) = lower(trim(p_owner_email)) and gr.phrase_key is null;
  if g is null or h is null or h <> extensions.crypt(p_pin, h) then
    insert into public.ivf_join_attempts (user_id) values (auth.uid());
    return null;
  end if;
  insert into public.ivf_members (user_id, group_id) values (auth.uid(), g);
  return g;
end;
$$;

-- 「作り直す」の条件は共有スペースごとに持つ（入り直しても、パートナーからでも同じ）
create or replace function public.ivf_load_params()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select params from public.ivf_groups where id = public.ivf_my_group()
$$;

create or replace function public.ivf_save_params(p_params jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.ivf_my_group() is null then raise exception 'no group'; end if;
  update public.ivf_groups set params = p_params where id = public.ivf_my_group();
end;
$$;

-- 暗証番号だけで新しいスペースを作る古い入口は閉じる
drop function if exists public.create_ivf_group(text);

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
revoke execute on function public.ivf_phrase_key(text)                 from public, anon, authenticated;
revoke execute on function public.ivf_check_attempts()                 from public, anon, authenticated;
revoke execute on function public.create_ivf_space(text)               from public, anon;
revoke execute on function public.join_ivf_space(text)                 from public, anon;
revoke execute on function public.set_ivf_phrase(text)                 from public, anon;
revoke execute on function public.join_ivf_group(text, text)           from public, anon;
revoke execute on function public.ivf_load_params()                    from public, anon;
revoke execute on function public.ivf_save_params(jsonb)               from public, anon;
revoke execute on function public.replace_ivf_events(jsonb, bigint)    from public, anon;
grant  execute on function public.ivf_my_group()                       to authenticated;
grant  execute on function public.ivf_group_info()                     to authenticated;
grant  execute on function public.create_ivf_space(text)               to authenticated;
grant  execute on function public.join_ivf_space(text)                 to authenticated;
grant  execute on function public.set_ivf_phrase(text)                 to authenticated;
grant  execute on function public.join_ivf_group(text, text)           to authenticated;
grant  execute on function public.ivf_load_params()                    to authenticated;
grant  execute on function public.ivf_save_params(jsonb)               to authenticated;
grant  execute on function public.replace_ivf_events(jsonb, bigint)    to authenticated;
