create or replace function public.add_owner_as_member () returns trigger language plpgsql security definer as $$
  begin
    raise log 'add_owner_as_member, inserting';

    insert into public.group_members (group_id, user_id, role)
    values (new.id, new.owner_id, 'owner');

    raise log 'add_owner_as_member, success';

    return new;
  end;
$$;


-- inserts a row into public.profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  default_currency_id int2;
  default_language varchar;
  default_group_name varchar;
  currency_id int2;
  language varchar;
  group_name varchar;
  new_profile_id uuid;
  new_group_id uuid;
begin
  raise log 'handle_new_user, starting, %', json_build_object(
    'new_user_id', new.id
  );

  select val_int2 from public.default_values
  into default_currency_id
  where code = 'default_currency_id';

  select val_varchar from public.default_values
  into default_language
  where code = 'default_language';
  
  select val_varchar from public.default_values
  into default_group_name
  where code = 'default_group_name';

  raise log 'handle_new_user, calculating default values, %', json_build_object(
    'default_currency_id', default_currency_id,
    'default_language', default_language,
    'default_group_name', default_group_name
  );

  currency_id = coalesce((new.raw_user_meta_data ->> 'currency_id')::int2, default_currency_id);
  language = coalesce(new.raw_user_meta_data ->> 'language', default_language);
  group_name = coalesce(new.raw_user_meta_data ->> 'initial_group_name', default_group_name);

  raise log 'handle_new_user, creating new profile, %', json_build_object(
    'currency_id', currency_id,
    'language', language,
    'group_name', group_name
  );

  -- create profile row
  insert into public.profiles (id, email, main_currency_id, language)
  values (new.id, new.email, currency_id, language)
  returning id into new_profile_id;

  -- create initial group - auto creates group_members record for owner_id
  raise log 'handle_new_user, creating new group, %', json_build_object(
    'new_profile_id', new_profile_id
  );
  insert into public.groups (owner_id, name)
  values (new.id, group_name)
  returning id into new_group_id;

  raise log 'handle_new_user, seeding new data, %', json_build_object(
    'new_group_id', new_group_id
  );

  -- seed initial data into the group
  perform public.seed_default_accounts(new_group_id, new.id, currency_id, language);

  perform public.seed_default_categories(new_group_id, new.id, language);

  raise log 'handle_new_user, success';

  return new;
end;
$$;

-- updates a row inside public.profiles
create or replace function public.handle_update_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  raise log 'handle_update_user, starting';

  update public.profiles
  set email = new.email
  where id = new.id;

  raise log 'handle_update_user, success';

  return new;
end;
$$;

-- trigger the function every time a user is created
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();

-- trigger the function every time a user is edited
create or replace trigger on_auth_user_edited
  after update on auth.users
  for each row
  execute procedure public.handle_update_user(); 

create or replace trigger trg_group_owner_member
  after insert on public.groups for each row
  execute function public.add_owner_as_member ();