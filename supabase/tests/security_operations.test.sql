create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(10);

select extensions.ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.profiles'::regclass),
  'profiles has row-level security enabled'
);
select extensions.ok(
  not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
  'authenticated users cannot update profile role'
);
select extensions.ok(
  has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
    and has_column_privilege('authenticated', 'public.profiles', 'phone', 'UPDATE'),
  'authenticated users can update only permitted profile fields'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous users cannot read profiles'
);
select extensions.ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.bookings'::regclass
      and c.conname = 'bookings_professional_time_excl'
      and c.contype = 'x'
  ),
  'booking overlaps are excluded per professional'
);
select extensions.ok(
  has_function_privilege(
    'anon',
    'public.create_public_booking(text,text,uuid,uuid,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients can submit a public booking request'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.create_customer_order(jsonb,text,text)', 'EXECUTE'),
  'anonymous clients cannot create customer orders'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.create_customer_order(jsonb,text,text)', 'EXECUTE'),
  'authenticated customers can create orders through the validated function'
);
select extensions.ok(
  to_regprocedure('public.create_public_booking(text,text,text,text,timestamptz)') is null,
  'the unsafe name-based booking RPC is removed'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.payments', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.orders', 'UPDATE'),
  'payment and order states are not directly writable by clients'
);

select * from extensions.finish();
rollback;
