create extension if not exists btree_gist;

-- A profile's public fields can be edited by its owner, but its role is reserved
-- to trusted database/backend operators.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'Profile roles can only be changed by a trusted backend operator'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_escalation on public.profiles;
create trigger profiles_prevent_role_escalation
before update of role on public.profiles
for each row execute function public.prevent_profile_role_escalation();

-- Authenticated users always start as customers. User metadata cannot choose
-- a role because the trigger ignores any role-like metadata.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create table if not exists public.professional_services (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (professional_id, service_id)
);

alter table public.bookings
  drop constraint if exists bookings_tstzrange_excl;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and contype = 'x'
  loop
    execute format('alter table public.bookings drop constraint %I', v_constraint.conname);
  end loop;
end;
$$;

alter table public.bookings
  add constraint bookings_professional_time_excl
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (professional_id is not null and status <> 'cancelled');

alter table public.bookings
  alter column customer_name set not null,
  alter column customer_phone set not null,
  alter column starts_at set not null,
  alter column ends_at set not null;

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  alt_text text not null default '',
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (product_id, storage_path)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null check (provider in ('infinitepay')),
  provider_reference text,
  idempotency_key text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded')),
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.payments(id),
  provider_event_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider_event_id)
);

create table if not exists public.site_content (
  content_key text primary key,
  content jsonb not null default '{}'::jsonb,
  is_published boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  storage_path text not null unique,
  media_type text not null check (media_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  alt_text text not null default '',
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.content_revisions (
  id bigint generated always as identity primary key,
  content_key text not null,
  content jsonb not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create table if not exists public.delivery_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  flat_fee_cents integer not null default 0 check (flat_fee_cents >= 0),
  free_over_cents integer check (free_over_cents is null or free_over_cents >= 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_events (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id),
  order_id uuid references public.orders(id),
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text not null,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'barts-public',
  'barts-public',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads barts media" on storage.objects;
drop policy if exists "admins upload barts media" on storage.objects;
drop policy if exists "admins update barts media" on storage.objects;
drop policy if exists "admins delete barts media" on storage.objects;
create policy "public reads barts media"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'barts-public');
create policy "admins upload barts media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'barts-public' and (select public.is_admin()));
create policy "admins update barts media"
  on storage.objects for update to authenticated
  using (bucket_id = 'barts-public' and (select public.is_admin()))
  with check (bucket_id = 'barts-public' and (select public.is_admin()));
create policy "admins delete barts media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'barts-public' and (select public.is_admin()));

create index if not exists product_images_product_position_idx
  on public.product_images(product_id, position);
create index if not exists payments_order_created_idx
  on public.payments(order_id, created_at desc);
create index if not exists payment_events_payment_idx
  on public.payment_events(payment_id, received_at desc);
create index if not exists content_revisions_key_changed_idx
  on public.content_revisions(content_key, changed_at desc);
create index if not exists inventory_events_product_created_idx
  on public.inventory_events(product_id, created_at desc);

revoke all on public.profiles, public.services, public.professionals, public.availability,
  public.schedule_blocks, public.bookings, public.product_categories, public.products,
  public.orders, public.order_items, public.audit_events, public.professional_services,
  public.product_images, public.payments, public.payment_events, public.site_content,
  public.site_settings, public.media_assets, public.content_revisions,
  public.delivery_settings, public.inventory_events from anon, authenticated;

create or replace function public.record_site_content_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.content_revisions (content_key, content, changed_by)
  values (
    old.content_key,
    old.content,
    (select auth.uid())
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists site_content_revision on public.site_content;
create trigger site_content_revision
before update or delete on public.site_content
for each row execute function public.record_site_content_revision();

alter table public.professional_services enable row level security;
alter table public.product_images enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.site_content enable row level security;
alter table public.site_settings enable row level security;
alter table public.media_assets enable row level security;
alter table public.content_revisions enable row level security;
alter table public.delivery_settings enable row level security;
alter table public.inventory_events enable row level security;

-- Remove the earlier broad policies; policies are permissive by default and
-- otherwise combine with OR.
drop policy if exists "profiles update themselves" on public.profiles;
drop policy if exists "admins manage profiles" on public.profiles;
drop policy if exists "public reads active services" on public.services;
drop policy if exists "admins manage catalog" on public.services;
drop policy if exists "public reads active professionals" on public.professionals;
drop policy if exists "admins manage professionals" on public.professionals;
drop policy if exists "admins manage availability" on public.availability;
drop policy if exists "admins manage blocks" on public.schedule_blocks;
drop policy if exists "customers read own bookings" on public.bookings;
drop policy if exists "admins manage bookings" on public.bookings;
drop policy if exists "public reads categories" on public.product_categories;
drop policy if exists "public reads active products" on public.products;
drop policy if exists "admins manage products" on public.products;
drop policy if exists "admins manage categories" on public.product_categories;
drop policy if exists "customers read own orders" on public.orders;
drop policy if exists "admins manage orders" on public.orders;
drop policy if exists "customers read own order items" on public.order_items;
drop policy if exists "admins read audit" on public.audit_events;

create policy "profile owner reads own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profile owner updates own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));
create policy "admins read profiles"
  on public.profiles for select to authenticated
  using ((select public.is_admin()));

create policy "public reads active services"
  on public.services for select to anon, authenticated using (is_active);
create policy "admins manage services"
  on public.services for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "public reads active professionals"
  on public.professionals for select to anon, authenticated using (is_active);
create policy "admins manage professionals"
  on public.professionals for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "professionals read own professional record"
  on public.professionals for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "admins manage availability"
  on public.availability for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "professionals read own availability"
  on public.availability for select to authenticated
  using (exists (
    select 1 from public.professionals p
    where p.id = professional_id and p.profile_id = (select auth.uid())
  ));
create policy "admins manage schedule blocks"
  on public.schedule_blocks for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "public reads active professional service links"
  on public.professional_services for select to anon, authenticated
  using (exists (
    select 1 from public.professionals p
    where p.id = professional_id and p.is_active
  ));
create policy "admins manage professional service links"
  on public.professional_services for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "professionals read own service links"
  on public.professional_services for select to authenticated
  using (exists (
    select 1 from public.professionals p
    where p.id = professional_id and p.profile_id = (select auth.uid())
  ));

create policy "customers read own bookings"
  on public.bookings for select to authenticated
  using (customer_id = (select auth.uid()) or (select public.is_admin()));
create policy "professionals read assigned bookings"
  on public.bookings for select to authenticated
  using (exists (
    select 1
    from public.professionals p
    join public.profiles owner on owner.id = p.profile_id
    where p.id = professional_id
      and owner.id = (select auth.uid())
      and owner.role = 'professional'
  ));
create policy "admins manage bookings"
  on public.bookings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "public reads categories"
  on public.product_categories for select to anon, authenticated using (true);
create policy "public reads active products"
  on public.products for select to anon, authenticated using (is_active);
create policy "admins manage products"
  on public.products for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins manage categories"
  on public.product_categories for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "public reads active product images"
  on public.product_images for select to anon, authenticated
  using (exists (
    select 1 from public.products p
    where p.id = product_id and p.is_active
  ));
create policy "admins manage product images"
  on public.product_images for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "customers read own orders"
  on public.orders for select to authenticated
  using (customer_id = (select auth.uid()) or (select public.is_admin()));
create policy "customers read own order items"
  on public.order_items for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and (o.customer_id = (select auth.uid()) or (select public.is_admin()))
  ));
create policy "admins manage orders"
  on public.orders for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins manage order items"
  on public.order_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins manage audit events"
  on public.audit_events for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins manage payments"
  on public.payments for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins manage payment events"
  on public.payment_events for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "public reads published site content"
  on public.site_content for select to anon, authenticated using (is_published);
create policy "admins manage site content"
  on public.site_content for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "public reads public site settings"
  on public.site_settings for select to anon, authenticated using (is_public);
create policy "admins manage site settings"
  on public.site_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins manage media assets"
  on public.media_assets for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins read content revisions"
  on public.content_revisions for select to authenticated
  using ((select public.is_admin()));
create policy "admins manage delivery settings"
  on public.delivery_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins read inventory events"
  on public.inventory_events for select to authenticated
  using ((select public.is_admin()));

grant select on public.services, public.professionals, public.professional_services,
  public.product_categories, public.products, public.product_images,
  public.site_content, public.site_settings to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.services, public.professionals,
  public.professional_services, public.availability, public.schedule_blocks,
  public.bookings, public.product_categories, public.products, public.product_images,
  public.site_content, public.site_settings, public.media_assets,
  public.delivery_settings to authenticated;
grant select on public.profiles, public.orders, public.order_items, public.payments,
  public.payment_events, public.audit_events, public.content_revisions,
  public.inventory_events to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

create or replace function public.get_booking_slots(
  p_professional_id uuid,
  p_service_id uuid,
  p_date date
)
returns table (starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct slot.starts_at
  from public.availability a
  join public.professionals p
    on p.id = a.professional_id and p.is_active
  join public.professional_services ps
    on ps.professional_id = p.id and ps.service_id = p_service_id
  join public.services s
    on s.id = ps.service_id and s.is_active
  cross join lateral generate_series(
    (p_date + a.start_time) at time zone 'America/Sao_Paulo',
    (p_date + a.end_time) at time zone 'America/Sao_Paulo'
      - make_interval(mins => s.duration_minutes),
    interval '30 minutes'
  ) as slot(starts_at)
  where a.professional_id = p_professional_id
    and a.weekday = extract(dow from p_date)::smallint
    and p_date between (now() at time zone 'America/Sao_Paulo')::date
      and ((now() at time zone 'America/Sao_Paulo')::date + 90)
    and slot.starts_at > now()
    and not exists (
      select 1 from public.schedule_blocks b
      where b.professional_id = p.id
        and tstzrange(b.starts_at, b.ends_at, '[)')
          && tstzrange(slot.starts_at, slot.starts_at + make_interval(mins => s.duration_minutes), '[)')
    )
    and not exists (
      select 1 from public.bookings b
      where b.professional_id = p.id
        and b.status <> 'cancelled'
        and tstzrange(b.starts_at, b.ends_at, '[)')
          && tstzrange(slot.starts_at, slot.starts_at + make_interval(mins => s.duration_minutes), '[)')
    );
$$;

create or replace function public.create_public_booking(
  p_customer_name text,
  p_customer_phone text,
  p_service_id uuid,
  p_professional_id uuid,
  p_starts_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.services%rowtype;
  v_professional public.professionals%rowtype;
  v_local_start timestamp;
  v_local_end timestamp;
  v_booking_id uuid;
begin
  if p_customer_name is null or length(trim(p_customer_name)) not between 3 and 100
     or p_customer_phone is null or length(regexp_replace(p_customer_phone, '\D', '', 'g')) not between 8 and 15 then
    raise exception 'Dados do cliente inválidos' using errcode = '22023';
  end if;
  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'Horário inválido' using errcode = '22023';
  end if;

  select s.* into v_service
  from public.services s
  join public.professional_services ps on ps.service_id = s.id
  where s.id = p_service_id
    and s.is_active
    and ps.professional_id = p_professional_id;
  if not found then
    raise exception 'Serviço indisponível para este profissional' using errcode = '22023';
  end if;

  select p.* into v_professional
  from public.professionals p
  where p.id = p_professional_id and p.is_active;
  if not found then
    raise exception 'Profissional indisponível' using errcode = '22023';
  end if;

  v_local_start := p_starts_at at time zone 'America/Sao_Paulo';
  v_local_end := (p_starts_at + make_interval(mins => v_service.duration_minutes))
    at time zone 'America/Sao_Paulo';

  if v_local_start::date > ((now() at time zone 'America/Sao_Paulo')::date + 90) then
    raise exception 'Agendamentos podem ser feitos com até 90 dias de antecedência'
      using errcode = '22023';
  end if;

  if date_trunc('minute', v_local_start) <> v_local_start
     or v_local_start::date <> v_local_end::date
     or not exists (
       select 1
       from public.availability a
       where a.professional_id = p_professional_id
         and a.weekday = extract(dow from v_local_start)::smallint
         and v_local_start::time >= a.start_time
         and v_local_end::time <= a.end_time
     ) then
    raise exception 'Horário fora da disponibilidade do profissional' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.get_booking_slots(
      p_professional_id,
      p_service_id,
      v_local_start::date
    ) available_slot
    where available_slot.starts_at = p_starts_at
  ) then
    raise exception 'Horário indisponível' using errcode = '23P01';
  end if;

  if exists (
    select 1
    from public.schedule_blocks b
    where b.professional_id = p_professional_id
      and tstzrange(b.starts_at, b.ends_at, '[)')
        && tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_service.duration_minutes), '[)')
  ) then
    raise exception 'Horário bloqueado' using errcode = '23P01';
  end if;

  insert into public.bookings (
    customer_id, customer_name, customer_phone, professional_id, service_id,
    professional_name_snapshot, service_name_snapshot, starts_at, ends_at
  ) values (
    (select auth.uid()), trim(p_customer_name), trim(p_customer_phone),
    v_professional.id, v_service.id, v_professional.display_name, v_service.name,
    p_starts_at, p_starts_at + make_interval(mins => v_service.duration_minutes)
  )
  returning id into v_booking_id;

  insert into public.audit_events (actor_id, action, entity, entity_id)
  values ((select auth.uid()), 'booking.create', 'bookings', v_booking_id::text);
  return v_booking_id;
end;
$$;

create or replace function public.create_customer_order(
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_product public.products%rowtype;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_total bigint := 0;
  v_quantity integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Autenticação necessária' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Itens do pedido inválidos' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Itens do pedido inválidos' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_customer_name, ''))) not between 3 and 100 then
    raise exception 'Nome inválido' using errcode = '22023';
  end if;

  for v_item in
    select product_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
    group by product_id
    order by product_id
  loop
    v_quantity := v_item.quantity;
    if v_item.product_id is null or v_quantity is null or v_quantity < 1 or v_quantity > 50 then
      raise exception 'Quantidade ou produto inválido' using errcode = '22023';
    end if;

    select p.* into v_product
    from public.products p
    where p.id = v_item.product_id and p.is_active
    for update;
    if not found or v_product.stock < v_quantity then
      raise exception 'Produto indisponível ou estoque insuficiente' using errcode = '22023';
    end if;

    v_total := v_total + (v_product.price_cents::bigint * v_quantity);
    if v_total > 2147483647 then
      raise exception 'Total do pedido excede o limite permitido' using errcode = '22003';
    end if;
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'quantity', v_quantity,
      'unit_price_cents', v_product.price_cents
    ));
    update public.products set stock = stock - v_quantity where id = v_product.id;
  end loop;

  insert into public.orders (customer_id, customer_name, customer_phone, total_cents)
  values ((select auth.uid()), trim(p_customer_name), nullif(trim(p_customer_phone), ''), v_total::integer)
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price_cents)
  select v_order_id, item.product_id, item.quantity, item.unit_price_cents
  from jsonb_to_recordset(v_order_items) as item(
    product_id uuid, quantity integer, unit_price_cents integer
  );

  insert into public.inventory_events (product_id, order_id, quantity_delta, reason, actor_id)
  select item.product_id, v_order_id, -item.quantity, 'order_reservation', (select auth.uid())
  from jsonb_to_recordset(v_order_items) as item(
    product_id uuid, quantity integer, unit_price_cents integer
  );
  return v_order_id;
end;
$$;

-- Remove the initial name-based overload. Leaving it callable would let
-- callers bypass the UUID/service-link and availability checks below.
drop function if exists public.create_public_booking(text, text, text, text, timestamptz);

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
revoke all on function public.get_booking_slots(uuid, uuid, date) from public;
grant execute on function public.get_booking_slots(uuid, uuid, date) to anon, authenticated;
revoke all on function public.create_public_booking(text, text, uuid, uuid, timestamptz) from public;
grant execute on function public.create_public_booking(text, text, uuid, uuid, timestamptz) to anon, authenticated;
revoke all on function public.create_customer_order(jsonb, text, text) from public, anon;
grant execute on function public.create_customer_order(jsonb, text, text) to authenticated;
revoke all on function public.prevent_profile_role_escalation() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.record_site_content_revision() from public, anon, authenticated;

-- These records are read-only through the public API. Orders are created by the
-- price/stock-checking function; payment state is reserved for a trusted backend.
revoke all on public.orders, public.order_items, public.payments, public.payment_events,
  public.audit_events, public.inventory_events, public.content_revisions from anon, authenticated;
grant select on public.orders, public.order_items, public.payments, public.payment_events,
  public.audit_events, public.inventory_events, public.content_revisions to authenticated;
