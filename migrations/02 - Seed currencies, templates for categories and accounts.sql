-- =====================================================================
-- Seed: справочник валют
-- Прогнать один раз через Supabase Studio SQL Editor.
-- id подобраны произвольно (не ISO numeric code) — просто стабильные
-- целые для FK внутри этой БД.
-- =====================================================================
insert into
  public.currencies (id, code, name, symbol)
values
  (1, 'USD', 'US Dollar', '$'),
  (2, 'EUR', 'Euro', '€'),
  (3, 'GBP', 'British Pound', '£'),
  (4, 'RUB', 'Russian Ruble', '₽'),
  (5, 'UAH', 'Ukrainian Hryvnia', '₴'),
  (6, 'KZT', 'Kazakhstani Tenge', '₸'),
  (7, 'PLN', 'Polish Zloty', 'zł'),
  (8, 'CZK', 'Czech Koruna', 'Kč'),
  (9, 'TRY', 'Turkish Lira', '₺'),
  (10, 'CNY', 'Chinese Yuan', '¥'),
  (11, 'JPY', 'Japanese Yen', '¥'),
  (12, 'CHF', 'Swiss Franc', 'CHF'),
  (13, 'GEL', 'Georgian Lari', '₾'),
  (14, 'AMD', 'Armenian Dram', '֏'),
  (15, 'AED', 'UAE Dirham', 'د.إ')
on conflict (id) do nothing;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_main_currency_id_fkey;
alter table public.profiles
add constraint profiles_main_currency_id_fkey foreign KEY (main_currency_id)
references public.currencies (id) on delete RESTRICT;





create table if not exists public.account_templates (
  id serial primary key,
  key text not null,
  sort_order int2 not null,
  name varchar not null,
  icon varchar,
  color varchar,
  type account_type not null,
  lang varchar not null
);

alter table public.account_templates enable row level security;
create policy account_templates_select on public.account_templates for select using (auth.role() = 'authenticated');

alter table public.accounts
add column template_id int4;

ALTER TABLE public.accounts
ADD CONSTRAINT fk_accounts_template_id FOREIGN KEY (template_id) 
REFERENCES public.account_templates (id);

alter table public.account_templates
ADD CONSTRAINT uq_account_templates_key_lang UNIQUE (key, lang);

insert into public.account_templates
(key, sort_order, name, icon, color, type, lang)
values
('wallet', 1, 'Wallet', 'wallet', NULL, 'regular', 'en'),
('wallet', 1, 'Кошелек', 'wallet', NULL, 'regular', 'ru'),
('card', 2, 'Card', 'card', NULL, 'regular', 'en'),
('card', 2, 'Карта', 'card', NULL, 'regular', 'ru')
on conflict (key, lang) do update
set
sort_order = EXCLUDED.sort_order,
name = EXCLUDED.name,
icon = EXCLUDED.icon,
color = EXCLUDED.color,
type = EXCLUDED.type
;




create table if not exists public.category_templates (
  id serial primary key,
  key text not null,
  sort_order int2 not null,
  name varchar not null,
  icon varchar,
  color varchar,
  type category_type not null,
  lang varchar not null
);

alter table public.category_templates enable row level security;
create policy category_templates_select on public.category_templates for select using (auth.role() = 'authenticated');

alter table public.categories
add column template_id int4;

ALTER TABLE public.categories
ADD CONSTRAINT fk_category_templates_id FOREIGN KEY (template_id) 
REFERENCES public.category_templates (id);

alter table public.category_templates
ADD CONSTRAINT uq_category_templates_key_lang UNIQUE (key, lang);

insert into public.category_templates
(key, sort_order, name, icon, color, type, lang)
values
('salary',        1,  'Salary',        'briefcase',       '#4CAF50', 'income',  'en'),
('salary',        1,  'Зарплата',      'briefcase',       '#4CAF50', 'income',  'ru'),
('freelance',     2,  'Freelance',     'laptop',          '#2196F3', 'income',  'en'),
('freelance',     2,  'Фриланс',       'laptop',          '#2196F3', 'income',  'ru'),
('gift',          3,  'Gift',          'gift',            '#E91E63', 'income',  'en'),
('gift',          3,  'Подарок',       'gift',            '#E91E63', 'income',  'ru'),
('investment',    4,  'Investment',    'trending-up',     '#FF9800', 'income',  'en'),
('investment',    4,  'Инвестиции',    'trending-up',     '#FF9800', 'income',  'ru'),
('other_income',  999, 'Other',         'dots-horizontal', '#9E9E9E', 'income',  'en'),
('other_income',  999, 'Прочее',        'dots-horizontal', '#9E9E9E', 'income',  'ru'),
 
('groceries',     1,  'Groceries',     'shopping-cart',   '#4CAF50', 'expense', 'en'),
('groceries',     1,  'Продукты',      'shopping-cart',   '#4CAF50', 'expense', 'ru'),
('transport',     2,  'Transport',     'car',             '#2196F3', 'expense', 'en'),
('transport',     2,  'Транспорт',     'car',             '#2196F3', 'expense', 'ru'),
('housing',       3,  'Housing',       'home',            '#FF9800', 'expense', 'en'),
('housing',       3,  'Жильё',         'home',            '#FF9800', 'expense', 'ru'),
('utilities',     4,  'Utilities',     'bolt',            '#FFC107', 'expense', 'en'),
('utilities',     4,  'Коммунальные услуги', 'bolt',      '#FFC107', 'expense', 'ru'),
('health',        5,  'Health',        'heart',           '#E91E63', 'expense', 'en'),
('health',        5,  'Здоровье',      'heart',           '#E91E63', 'expense', 'ru'),
('entertainment', 6,  'Entertainment', 'film',            '#9C27B0', 'expense', 'en'),
('entertainment', 6,  'Развлечения',   'film',            '#9C27B0', 'expense', 'ru'),
('dining_out',    7,  'Dining Out',    'coffee',          '#795548', 'expense', 'en'),
('dining_out',    7,  'Кафе и рестораны', 'coffee',       '#795548', 'expense', 'ru'),
('shopping',      8,  'Shopping',      'bag',             '#607D8B', 'expense', 'en'),
('shopping',      8,  'Покупки',       'bag',             '#607D8B', 'expense', 'ru'),
('education',     9,  'Education',     'book',            '#3F51B5', 'expense', 'en'),
('education',     9,  'Образование',   'book',            '#3F51B5', 'expense', 'ru'),
('rent',          10, 'Rent',           'key',            '#8BC34A', 'expense', 'en'),
('rent',          10, 'Аренда',         'key',            '#8BC34A', 'expense', 'ru'),
('other_expense', 999, 'Other',         'dots-horizontal', '#9E9E9E', 'expense', 'en'),
('other_expense', 999, 'Прочее',        'dots-horizontal', '#9E9E9E', 'expense', 'ru')
on conflict (key, lang) do update
set
sort_order = EXCLUDED.sort_order,
name = EXCLUDED.name,
icon = EXCLUDED.icon,
color = EXCLUDED.color,
type = EXCLUDED.type
;






-- create accounts for specific group_id
create or replace function public.seed_default_accounts(p_group_id uuid, p_user_id uuid, p_currency_id int2 default 1, p_lang varchar default 'en')
returns boolean
language plpgsql
security definer set search_path = ''
as $$
begin
  raise log 'seed_default_accounts, seeding_data, %', jsonb_build_object(
    'group_id', p_group_id,
    'user_id', p_user_id,
    'currency_id', p_currency_id,
    'lang', p_lang
  );

  insert into public.accounts (group_id, created_by, currency_id, is_included_in_balance, template_id, sort_order, type, name, icon, color)
  select
    p_group_id as group_id, p_user_id as created_by, p_currency_id as currency_id,
    true as is_included_in_balance,
    id, sort_order, type, name, icon, color
  from public.account_templates
  where lang = p_lang
  order by id
  on conflict do nothing;
  
  raise log 'seed_default_accounts, success';

  return true;
end;
$$;


-- create categories for specific group_id
create or replace function public.seed_default_categories(p_group_id uuid, p_user_id uuid, p_lang varchar default 'en')
returns boolean
language plpgsql
security definer set search_path = ''
as $$
begin
  raise log 'seed_default_categories, seeding_data, %', jsonb_build_object(
    'group_id', p_group_id,
    'user_id', p_user_id,
    'lang', p_lang
  );

  insert into public.categories (group_id, created_by, template_id, sort_order, type, name, icon, color)
  select
    p_group_id as group_id, p_user_id as created_by,
    id, sort_order, type, name, icon, color
  from public.category_templates
  where lang = p_lang
  order by id
  on conflict do nothing;
  
  raise log 'seed_default_categories, success';

  return true;
end;
$$;

create table if not exists default_values
(
  code varchar primary key,
  val_int2 int2,
  val_varchar varchar
);

insert into public.default_values
(code, val_int2, val_varchar)
values
('default_language', null, 'en'),
('default_currency_id', 1, null),
('default_group_name', null, 'My Group')
on conflict (code) do nothing;
