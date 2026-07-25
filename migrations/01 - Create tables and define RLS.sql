-- =====================================================================
-- MoneyIQ-alike: целевая схема Postgres для Supabase (self-hosted)
-- Поддержка: групповой доступ (несколько юзеров -> общие транзакции),
-- Row Level Security, готовность к офлайн-синку (PowerSync).
-- =====================================================================
create extension if not exists pgcrypto;

-- gen_random_uuid()
-- ---------------------------------------------------------------------
-- 1. ENUM-ТИПЫ
-- ---------------------------------------------------------------------
DO 'BEGIN

create type member_role as enum(''owner'', ''admin'', ''member'', ''viewer'');

create type account_type as enum(''regular'', ''debt'', ''savings'');

create type category_type as enum(''income'', ''expense'');

create type transaction_type as enum(''expense'', ''income'', ''transfer'');

create type recurrence_unit as enum(''day'', ''week'', ''month'', ''year'');

EXCEPTION WHEN duplicate_object THEN
   NULL;  -- ignore the error
END;';

-- ---------------------------------------------------------------------
-- 2. ПРОФИЛИ (расширение auth.users)
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  main_currency_id int not null default 1,
  language text not null default 'en',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. ГРУППЫ (= "книги"/"бюджеты" в оригинале, поле _b_i)
-- ---------------------------------------------------------------------
create table if not exists groups (
  id uuid primary key default gen_random_uuid (),
  name text not null,
  owner_id uuid not null references auth.users (id) on delete cascade, -- источник правды по авторизации — group_members.role='owner'; owner_id меняется только через transfer_group_ownership()
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz -- архивация вместо удаления; NULL = активна
);

create table if not exists group_members (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists idx_group_members_user on public.group_members (user_id);

-- ---------------------------------------------------------------------
-- 4. ВАЛЮТЫ (справочник, общий для всех — RLS не нужен, только read)
-- ---------------------------------------------------------------------
create table if not exists currencies (
  id smallint primary key,
  code text not null unique, -- 'USD', 'EUR', 'RUB'...
  name text not null,
  symbol text
);

-- ---------------------------------------------------------------------
-- 5. СЧЕТА
-- ---------------------------------------------------------------------
create table if not exists accounts (
  id uuid primary key default gen_random_uuid (),
  group_id uuid not null references groups (id) on delete cascade,
  type account_type not null default 'regular',
  name text not null,
  currency_id smallint not null references currencies (id),
  is_favourite boolean not null default false,
  icon text,
  color text,
  description text,
  is_included_in_balance boolean not null default true,
  sort_order integer not null default 0,
  archived boolean not null default false,
  archived_at timestamptz,
  -- баланс НЕ хранится тут намеренно — считается из transactions (см. вьюху account_balances ниже)
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz -- soft delete, важно для sync
);

create index if not exists idx_accounts_group on accounts (group_id)
where
  deleted_at is null;

-- лимит и цель — отдельная таблица, а не два nullable-поля в accounts,
-- т.к. это опциональные метаданные только для part счетов (debt/savings)
create table if not exists account_targets (
  account_id uuid primary key references accounts (id) on delete cascade,
  limit_amount numeric(14, 2),
  goal_amount numeric(14, 2)
);

-- ---------------------------------------------------------------------
-- 6. КАТЕГОРИИ
-- ---------------------------------------------------------------------
create table if not exists categories (
  id uuid primary key default gen_random_uuid (),
  group_id uuid not null references groups (id) on delete cascade,
  parent_id uuid references categories (id),
  type category_type not null,
  name text not null,
  icon text,
  color text,
  sort_order integer not null default 0,
  archived boolean not null default false,
  archived_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_categories_group on categories (group_id)
where
  deleted_at is null;

-- ---------------------------------------------------------------------
-- 7. ТЕГИ (явная many-to-many вместо строки "id|id|id")
-- ---------------------------------------------------------------------
create table if not exists tags (
  id uuid primary key default gen_random_uuid (),
  group_id uuid not null references groups (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

-- ---------------------------------------------------------------------
-- 8. ТРАНЗАКЦИИ
-- category_id и to_account_id разведены явно (в отличие от оригинала,
-- где обе роли смешивались в _a_i/_d_i в зависимости от _ty)
-- ---------------------------------------------------------------------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid (),
  group_id uuid not null references groups (id) on delete cascade,
  type transaction_type not null,
  date timestamptz not null,
  amount numeric(14, 2) not null,
  currency_id smallint not null references currencies (id),
  account_id uuid not null references accounts (id), -- всегда счёт
  category_id uuid references categories (id), -- только expense/income
  to_account_id uuid references accounts (id), -- только transfer
  dest_amount numeric(14, 2), -- только transfer с конвертацией
  note text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_transaction_sides check (
    (
      type = 'transfer'
      and to_account_id is not null
      and category_id is null
    )
    or (
      type in ('expense', 'income')
      and to_account_id is null
    )
  ),
  constraint chk_transaction_amount_positive check (
    amount > 0
    and (
      dest_amount is null
      or dest_amount > 0
    )
  )
);

create index if not exists idx_transactions_group_date on transactions (group_id, date desc)
where
  deleted_at is null;

create index if not exists idx_transactions_account on transactions (account_id)
where
  deleted_at is null;

create index if not exists idx_transactions_category on transactions (category_id)
where
  deleted_at is null;

create table if not exists transaction_tags (
  transaction_id uuid not null references transactions (id) on delete cascade,
  tag_id uuid not null references tags (id) on delete cascade,
  primary key (transaction_id, tag_id)
);

-- ---------------------------------------------------------------------
-- 9. ПОВТОРЯЮЩИЕСЯ ТРАНЗАКЦИИ (вместо закодированного _rec/_rem/_id_b/_sch)
-- ---------------------------------------------------------------------
create table if not exists recurring_rules (
  id uuid primary key default gen_random_uuid (),
  group_id uuid not null references groups (id) on delete cascade,
  -- шаблон транзакции, который будет создаваться при каждом запуске правила
  type transaction_type not null,
  amount numeric(14, 2) not null,
  currency_id smallint not null references currencies (id),
  account_id uuid not null references accounts (id),
  category_id uuid references categories (id),
  to_account_id uuid references accounts (id),
  note text,
  interval_unit recurrence_unit not null,
  interval_value integer not null default 1, -- "каждые N единиц"
  next_run_date timestamptz not null,
  reminder_days_before integer, -- null = без напоминания
  active boolean not null default true,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_recurring_sides check (
    (
      type = 'transfer'
      and to_account_id is not null
      and category_id is null
    )
    or (
      type in ('expense', 'income')
      and to_account_id is null
    )
  ),
  constraint chk_recurring_amount_positive check (amount > 0)
);

create index if not exists idx_recurring_group on recurring_rules (group_id)
where
  deleted_at is null;

-- ---------------------------------------------------------------------
-- 10. updated_at — автотриггер
-- ---------------------------------------------------------------------
create or replace function set_updated_at () returns trigger language plpgsql as $$
  begin
    new.updated_at = now();
    return new;
  end;
$$;

-- ---------------------------------------------------------------------
-- 10b. Проверка целостности: account_id/category_id/to_account_id должны
-- принадлежать той же группе, что и сама запись (transaction/recurring_rule).
-- Обычный FK этого не проверяет — нужен триггер.
-- ---------------------------------------------------------------------
create or replace function public.check_group_consistency () returns trigger language plpgsql as $$
  begin
    if new.account_id is not null and not exists (
      select 1 from public.accounts where id = new.account_id and group_id = new.group_id
      ) then
        raise exception 'account_id % does not belong to group %', new.account_id, new.group_id;
    end if;

    if new.to_account_id is not null and not exists (
      select 1 from public.accounts where id = new.to_account_id and group_id = new.group_id
      ) then
        raise exception 'to_account_id % does not belong to group %', new.to_account_id, new.group_id;
    end if;

    if new.category_id is not null and not exists (
      select 1 from public.categories where id = new.category_id and group_id = new.group_id
      ) then
        raise exception 'category_id % does not belong to group %', new.category_id, new.group_id;
    end if;

  return new;
  end;
$$;

DO 'BEGIN
create trigger trg_transactions_group_consistency before insert
or
update on public.transactions for each row
execute function public.check_group_consistency ();

create trigger trg_recurring_group_consistency before insert
or
update on public.recurring_rules for each row
execute function check_group_consistency ();

create trigger trg_accounts_updated before
update on public.accounts for each row
execute function set_updated_at ();

create trigger trg_categories_updated before
update on public.categories for each row
execute function set_updated_at ();

create trigger trg_transactions_updated before
update on public.transactions for each row
execute function set_updated_at ();

create trigger trg_recurring_updated before
update on public.recurring_rules for each row
execute function set_updated_at ();

create trigger trg_groups_updated before
update on public.groups for each row
execute function set_updated_at ();

EXCEPTION WHEN duplicate_object THEN
   NULL;  -- ignore the error
END;';

-- ---------------------------------------------------------------------
-- 11. Вьюха для баланса счёта (считается, а не хранится)
-- ---------------------------------------------------------------------
create OR REPLACE view public.account_balances as
select
  a.id as account_id,
  a.group_id,
  coalesce(
    sum(
      case
        when t.account_id = a.id
        and t.type = 'income' then t.amount
        when t.account_id = a.id
        and t.type = 'expense' then - t.amount
        when t.account_id = a.id
        and t.type = 'transfer' then - t.amount
        when t.to_account_id = a.id
        and t.type = 'transfer' then coalesce(t.dest_amount, t.amount)
        else 0
      end
    ),
    0
  ) as balance,
  a.currency_id,
  c.code as currency_code
from
  public.accounts a
  left join public.transactions t on (
    t.account_id = a.id
    or t.to_account_id = a.id
  )
  and t.deleted_at is null
  inner join currencies c on c.id = a.currency_id
where
  a.deleted_at is null
group by
  a.id,
  a.group_id,
  c.code;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
-- ---------------------------------------------------------------------
-- Хелпер-функции. SECURITY DEFINER — чтобы избежать рекурсии RLS
-- при проверке членства в группе (иначе policy на group_members сама
-- дергала бы RLS group_members и зациклилась бы).
-- ---------------------------------------------------------------------
create or replace function public.is_group_member (p_group_id uuid) returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.group_members
    where p_group_id is null OR (group_id = p_group_id and user_id = auth.uid())
  );
$$;

create or replace function public.group_role (p_group_id uuid) returns member_role language sql security definer stable as $$
  select role from public.group_members
  where group_id = p_group_id and user_id = auth.uid();
$$;

-- роли owner/admin/member могут писать, viewer — только читает;
-- архивная группа — read-only для всех, включая owner (сначала разархивируй)
create or replace function public.can_write_group (p_group_id uuid) returns boolean language sql security definer stable as $$
  select group_role(p_group_id) in ('owner', 'admin', 'member')
  and not exists (select 1 from public.groups where id = p_group_id and archived_at is not null);
$$;

-- ---------------------------------------------------------------------
-- Включаем RLS везде
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

alter table public.groups enable row level security;

alter table public.group_members enable row level security;

alter table public.accounts enable row level security;

alter table public.account_targets enable row level security;

alter table public.categories enable row level security;

alter table public.tags enable row level security;

alter table public.transactions enable row level security;

alter table public.transaction_tags enable row level security;

alter table public.recurring_rules enable row level security;


-- profiles: каждый видит и правит только свой профиль

DO 'BEGIN
create policy profiles_select on public.profiles for
select
  using (id = auth.uid ());

create policy profiles_update on public.profiles
for update
  using (id = auth.uid ());
  
EXCEPTION WHEN duplicate_object THEN
   NULL;  -- ignore the error
END;';

-- groups: видно только группы, где ты участник; создавать может любой
-- залогиненный юзер (сам становится owner); удалять/переименовывать — только owner

DO 'BEGIN
create policy groups_select on public.groups for
select
  using (is_group_member (id));

create policy groups_insert on public.groups for insert
with
  check (owner_id = auth.uid ());

create policy groups_update on public.groups
for update
  using (group_role (id) = ''owner'');
  
EXCEPTION WHEN duplicate_object THEN
   NULL;  -- ignore the error
END;';

-- Намеренно НЕТ policy groups_delete: жёсткое удаление группы через API
-- запрещено (RLS по умолчанию блокирует всё, что не разрешено явной policy).
-- Обычный жизненный цикл — archive_group()/restore_group() ниже.
-- Настоящий DELETE остаётся возможен только через service_role
-- (например, для GDPR-запроса на удаление аккаунта), в обход RLS.
-- group_members: видно всем участникам группы (чтобы видеть список сотоварищей)
-- добавление/удаление участников — см. RPC-функции ниже, а не прямой INSERT/DELETE,
-- чтобы не давать "member" право добавлять кого попало через голый INSERT

DO 'BEGIN
create policy group_members_select on public.group_members for
select
  using (public.is_group_member (group_id));

create policy group_members_insert on public.group_members for insert
with
  check (public.group_role (group_id) in (''owner'', ''admin''));

create policy group_members_delete on public.group_members for delete using (
  (
    public.group_role (group_id) in (''owner'', ''admin'')
    or user_id = auth.uid ()
  )
  and not (
    role = ''owner''
    and (
      select
        count(*)
      from
        public.group_members gm2
      where
        gm2.group_id = group_members.group_id
        and gm2.role = ''owner''
    ) <= 1
  )
);

EXCEPTION WHEN duplicate_object THEN
   NULL;
END;';

-- accounts / categories / tags / transactions / recurring_rules:
-- единый паттерн — читать могут все участники группы, писать — все кроме viewer
DO 'BEGIN
create policy accounts_select on public.accounts for
select
  using (public.is_group_member (group_id));

create policy accounts_write on public.accounts for insert
with
  check (public.can_write_group (group_id));

create policy accounts_update on public.accounts
for update
  using (public.can_write_group (group_id));

create policy accounts_delete on public.accounts for delete using (can_write_group (group_id));

create policy account_targets_select on public.account_targets for
select
  using (
    public.is_group_member (
      (
        select
          group_id
        from
          public.accounts
        where
          id = account_id
      )
    )
  );

create policy account_targets_write on public.account_targets for all using (
  public.can_write_group (
    (
      select
        group_id
      from
        public.accounts
      where
        id = account_id
    )
  )
);

create policy categories_select on public.categories for
select
  using (public.is_group_member (group_id));

create policy categories_write on public.categories for insert
with
  check (public.can_write_group (group_id));

create policy categories_update on public.categories
for update
  using (public.can_write_group (group_id));

create policy categories_delete on public.categories for delete using (public.can_write_group (group_id));

create policy tags_select on tags for
select
  using (is_group_member (group_id));

create policy tags_write on tags for insert
with
  check (can_write_group (group_id));

create policy tags_delete on tags for delete using (can_write_group (group_id));

create policy transactions_select on public.transactions for
select
  using (is_group_member (group_id));

create policy transactions_write on public.transactions for insert
with
  check (can_write_group (group_id));

create policy transactions_update on public.transactions
for update
  using (can_write_group (group_id));

create policy transactions_delete on public.transactions for delete using (can_write_group (group_id));

create policy transaction_tags_select on transaction_tags for
select
  using (
    is_group_member (
      (
        select
          group_id
        from
          public.transactions
        where
          id = transaction_id
      )
    )
  );

create policy transaction_tags_write on public.transaction_tags for all using (
  can_write_group (
    (
      select
        group_id
      from
        public.transactions
      where
        id = transaction_id
    )
  )
);

create policy recurring_select on public.recurring_rules for
select
  using (is_group_member (group_id));

create policy recurring_write on public.recurring_rules for insert
with
  check (can_write_group (group_id));

create policy recurring_update on public.recurring_rules
for update
  using (can_write_group (group_id));

create policy recurring_delete on public.recurring_rules for delete using (can_write_group (group_id));

alter table public.currencies enable row level security;

create policy currencies_select on public.currencies for
select
  using (auth.role () = ''authenticated'');
  
EXCEPTION WHEN duplicate_object THEN
   NULL;  -- ignore the error
END;';

-- ---------------------------------------------------------------------
-- RPC: приглашение участника в группу (owner/admin) — вместо голого INSERT,
-- чтобы валидировать роль и не давать member'у эскалировать права
-- ---------------------------------------------------------------------
create or replace function public.invite_group_member (
  p_group_id uuid,
  p_user_id uuid,
  p_role member_role default 'member'
) returns void language plpgsql security definer as $$
  begin
    raise log 'invite_group_member, inserting';

    if public.group_role(p_group_id) not in ('owner', 'admin') then
      raise exception 'insufficient permissions';
    end if;
    insert into public.group_members (group_id, user_id, role)
    values (p_group_id, p_user_id, p_role)
    on conflict (group_id, user_id) do update set role = excluded.role;
  end;
$$;

-- ---------------------------------------------------------------------
-- RPC: архивация / восстановление группы (только owner).
-- Данные никуда не пропадают, группа просто становится read-only
-- и может скрываться из основного списка в UI.
-- ---------------------------------------------------------------------
create or replace function archive_group (p_group_id uuid) returns void language plpgsql security definer as $$
  begin
    raise log 'archive_group, updating';

    if public.group_role(p_group_id) <> 'owner' then
      raise exception 'only the owner can archive a group';
    end if;
    update public.groups set archived_at = now() where id = p_group_id;
  end;
$$;

create or replace function restore_group (p_group_id uuid) returns void language plpgsql security definer as $$
  begin
    raise log 'restore_group, updating';

    if public.group_role(p_group_id) <> 'owner' then
      raise exception 'only the owner can restore a group';
    end if;
    update public.groups set archived_at = null where id = p_group_id;
  end;
$$;

-- ---------------------------------------------------------------------
-- RPC: передача владения группой. Единственный официальный способ сменить
-- owner — держит group_members.role и groups.owner_id синхронными
-- (авторизация везде идёт по group_members.role, а не по owner_id,
-- поэтому без этой функции они могут разъехаться при ручном UPDATE).
-- ---------------------------------------------------------------------
create or replace function public.transfer_group_ownership (p_group_id uuid, p_new_owner_id uuid) returns void language plpgsql security definer as $$
  begin
    raise log 'transfer_group_ownership, updating';

    if public.group_role(p_group_id) <> 'owner' then
      raise exception 'only the current owner can transfer ownership';
    end if;
    if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_new_owner_id) then
      raise exception 'target user is not a member of this group';
    end if;

    update public.group_members set role = 'admin' where group_id = p_group_id and user_id = auth.uid();
    update public.group_members set role = 'owner' where group_id = p_group_id and user_id = p_new_owner_id;
    update public.groups set owner_id = p_new_owner_id where id = p_group_id;
  end;
$$;
