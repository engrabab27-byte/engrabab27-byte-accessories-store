begin;

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.orders no force row level security;

drop policy if exists "Public can read products" on public.products;
create policy "Public can read products"
    on public.products for select to anon, authenticated
    using (true);

drop policy if exists "Admin manages products" on public.products;
create policy "Admin manages products"
    on public.products for all to authenticated
    using (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid)
    with check (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid);

revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

drop policy if exists "Admin reads orders" on public.orders;
create policy "Admin reads orders"
    on public.orders for select to authenticated
    using (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid);

drop policy if exists "Admin updates orders" on public.orders;
create policy "Admin updates orders"
    on public.orders for update to authenticated
    using (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid)
    with check (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid);

revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated;
grant update (status, delivery_fee) on public.orders to authenticated;

drop policy if exists "Public reads product images" on storage.objects;
create policy "Public reads product images"
    on storage.objects for select to anon, authenticated
    using (bucket_id = 'products');

drop policy if exists "Admin manages product images" on storage.objects;
create policy "Admin manages product images"
    on storage.objects for all to authenticated
    using (
        bucket_id = 'products'
        and auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid
    )
    with check (
        bucket_id = 'products'
        and auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid
    );

grant select on storage.objects to anon, authenticated;
grant insert, update, delete on storage.objects to authenticated;

drop policy if exists "Customers upload order receipts" on storage.objects;
create policy "Customers upload order receipts"
    on storage.objects for insert to anon, authenticated
    with check (
        bucket_id = 'order-receipts'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/receipt\.(jpg|png|webp)$'
        and coalesce((metadata->>'size')::bigint, 0) between 1 and 5242880
        and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
    );
grant insert on storage.objects to anon;

alter function public.create_order(jsonb) security definer;
alter function public.create_order(jsonb) owner to postgres;
alter function public.create_order(jsonb) set search_path to '';
alter function public.create_order(jsonb) set row_security to off;
revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon, authenticated;

commit;
