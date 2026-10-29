-- 体外受精スケジュール用のテーブル
-- Supabase の SQL Editor に貼り付けて「Run」を押してください（1回だけ）。

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
create index if not exists ivf_events_user_date on public.ivf_events (user_id, date);

-- 「作り直す」の条件（1人1行）
create table if not exists public.ivf_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  params     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ログインした人だけがテーブルを使えるようにする
-- （新しいテーブルを自動で公開しない設定のプロジェクトでも動くように、明示的に付与する）
revoke all on public.ivf_events, public.ivf_settings from anon;
grant select, insert, update, delete on public.ivf_events, public.ivf_settings to authenticated;

-- 本人の行だけ読み書きできるようにする（行レベルセキュリティ）
alter table public.ivf_events   enable row level security;
alter table public.ivf_settings enable row level security;

drop policy if exists "own events" on public.ivf_events;
create policy "own events" on public.ivf_events
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own settings" on public.ivf_settings;
create policy "own settings" on public.ivf_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 自分の予定をまるごと置き換える（削除と追加を1回のトランザクションで行う）
create or replace function public.replace_ivf_events(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.ivf_events where user_id = auth.uid();
  insert into public.ivf_events (user_id, date, kind, memo, cycle)
  select auth.uid(),
         (r ->> 'date')::date,
         r ->> 'kind',
         coalesce(r ->> 'memo', ''),
         coalesce((r ->> 'cycle')::int, 0)
  from jsonb_array_elements(p_rows) as r;
end;
$$;

revoke execute on function public.replace_ivf_events(jsonb) from public, anon;
grant  execute on function public.replace_ivf_events(jsonb) to authenticated;
