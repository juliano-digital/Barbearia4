create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.app_role as enum ('customer', 'professional', 'admin');
create type public.booking_status as enum ('pending', 'confirmed', 'completed', 'cancelled');
create type public.order_status as enum ('pending', 'paid', 'cancelled', 'refunded');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes > 0),
  price_cents integer not null check (price_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id),
  display_name text not null,
  role_name text,
  photo_url text,
  is_active boolean not null default true
);

create table public.availability (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time)
);

create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (starts_at < ends_at)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  customer_name text not null,
  customer_phone text not null,
  professional_id uuid references public.professionals(id),
  service_id uuid references public.services(id),
  professional_name_snapshot text,
  service_name_snapshot text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.booking_status not null default 'pending',
  created_at timestamptz not null default now(),
  check (starts_at < ends_at),
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
    where (status != 'cancelled')
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.product_categories(id),
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  stock integer not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id),
  customer_name text not null,
  customer_phone text,
  total_cents integer not null check (total_cents >= 0),
  status public.order_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index bookings_starts_at_idx on public.bookings(starts_at);
create index bookings_professional_idx on public.bookings(professional_id, starts_at);
create index products_category_idx on public.products(category_id);

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.create_public_booking(
  p_customer_name text,
  p_customer_phone text,
  p_service_name text,
  p_professional_name text,
  p_starts_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_service public.services%rowtype;
  v_professional public.professionals%rowtype;
  v_booking_id uuid;
begin
  if length(trim(p_customer_name)) < 3 or length(trim(p_customer_phone)) < 8 then
    raise exception 'Dados do cliente inválidos';
  end if;

  select * into v_service from public.services
  where name = p_service_name and is_active
  limit 1;
  if v_service.id is null then raise exception 'Serviço inválido'; end if;

  select * into v_professional from public.professionals
  where display_name = p_professional_name and is_active
  limit 1;
  if v_professional.id is null then raise exception 'Profissional inválido'; end if;

  if p_starts_at <= now() then raise exception 'Horário inválido'; end if;

  insert into public.bookings (
    customer_id, customer_name, customer_phone, professional_id, service_id,
    professional_name_snapshot, service_name_snapshot, starts_at, ends_at
  ) values (
    auth.uid(), trim(p_customer_name), trim(p_customer_phone),
    v_professional.id, v_service.id, v_professional.display_name, v_service.name,
    p_starts_at, p_starts_at + make_interval(mins => v_service.duration_minutes)
  ) returning id into v_booking_id;

  insert into public.audit_events(actor_id, action, entity, entity_id)
  values (auth.uid(), 'booking.create', 'bookings', v_booking_id::text);
  return v_booking_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.professionals enable row level security;
alter table public.availability enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.bookings enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.audit_events enable row level security;

create policy "public reads active services" on public.services for select using (is_active);
create policy "public reads active professionals" on public.professionals for select using (is_active);
create policy "public reads categories" on public.product_categories for select using (true);
create policy "public reads active products" on public.products for select using (is_active);
create policy "profiles read themselves" on public.profiles for select using (auth.uid() = id or public.is_admin());
create policy "profiles update themselves" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "admins manage profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
create policy "customers read own bookings" on public.bookings for select using (auth.uid() = customer_id or public.is_admin());
create policy "admins manage bookings" on public.bookings for all using (public.is_admin()) with check (public.is_admin());
create policy "customers read own orders" on public.orders for select using (auth.uid() = customer_id or public.is_admin());
create policy "customers read own order items" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = auth.uid() or public.is_admin()))
);
create policy "admins manage catalog" on public.services for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage professionals" on public.professionals for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage availability" on public.availability for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage blocks" on public.schedule_blocks for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage products" on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage categories" on public.product_categories for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage orders" on public.orders for all using (public.is_admin()) with check (public.is_admin());
create policy "admins read audit" on public.audit_events for select using (public.is_admin());
