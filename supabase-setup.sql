create table if not exists public.products (
    id text primary key,
    name text not null check (char_length(name) between 1 and 90),
    category text not null check (category in ('chains', 'bracelets', 'rings', 'earrings', 'anklets', 'bangles', 'sets', 'misc')),
    category_name text not null,
    price numeric(10, 2) not null check (price > 0 and price <= 1000000),
    old_price numeric(10, 2),
    description text not null default '' check (char_length(description) <= 300),
    image text not null,
    alt text not null default '',
    badge text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check
    check (category in ('chains', 'bracelets', 'rings', 'earrings', 'anklets', 'bangles', 'sets', 'misc'));

alter table public.products
    add column if not exists images jsonb not null default '[]'::jsonb;

update public.products
set images = jsonb_build_array(image)
where images = '[]'::jsonb and image <> '';

create table if not exists public.orders (
    id uuid primary key,
    customer_name text not null,
    customer_phone text not null,
    customer_address text not null,
    total_amount numeric(12, 2) not null,
    paid_amount numeric(12, 2) not null,
    remaining_amount numeric(12, 2) not null,
    delivery_fee numeric(12, 2),
    phone text not null,
    whatsapp text not null,
    governorate text not null,
    city text not null,
    address text not null,
    items jsonb not null,
    total numeric(12, 2) not null,
    deposit numeric(12, 2) not null,
    remaining numeric(12, 2) not null,
    payment_method text not null check (payment_method in ('Vodafone Cash', 'InstaPay')),
    payment_option text not null default 'deposit' check (payment_option in ('deposit', 'full')),
    shipping_method text not null default 'توصيل للعنوان',
    receipt_path text not null,
    status text not null default 'new' check (status in ('new', 'reviewed', 'confirmed', 'cancelled')),
    created_at timestamptz not null default now()
);

alter table public.orders
    add column if not exists phone text,
    add column if not exists whatsapp text,
    add column if not exists governorate text,
    add column if not exists city text,
    add column if not exists address text,
    add column if not exists total numeric(12, 2),
    add column if not exists deposit numeric(12, 2),
    add column if not exists remaining numeric(12, 2),
    add column if not exists payment_method text,
    add column if not exists payment_option text,
    add column if not exists shipping_method text not null default 'توصيل للعنوان',
    add column if not exists receipt_path text,
    add column if not exists status text not null default 'new',
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists customer_phone text,
    add column if not exists customer_address text,
    add column if not exists total_amount numeric(12, 2),
    add column if not exists paid_amount numeric(12, 2),
    add column if not exists remaining_amount numeric(12, 2),
    add column if not exists delivery_fee numeric(12, 2);

alter table public.orders drop constraint if exists orders_delivery_fee_check;
alter table public.orders add constraint orders_delivery_fee_check
    check (delivery_fee is null or delivery_fee >= 0);

update public.orders
set customer_phone = coalesce(nullif(customer_phone, ''), nullif(phone, ''), nullif(whatsapp, '')),
    customer_address = coalesce(
        nullif(customer_address, ''),
        nullif(address, ''),
        concat_ws('، ', nullif(btrim(governorate), ''), nullif(btrim(city), ''), nullif(btrim(address), ''))
    ),
    total_amount = coalesce(total_amount, total),
    paid_amount = coalesce(paid_amount, deposit),
    remaining_amount = coalesce(remaining_amount, remaining);

update public.orders
set phone = coalesce(nullif(phone, ''), customer_phone),
    whatsapp = coalesce(nullif(whatsapp, ''), customer_phone),
    address = coalesce(nullif(address, ''), customer_address),
    total = coalesce(total, total_amount),
    deposit = coalesce(deposit, paid_amount),
    remaining = coalesce(remaining, remaining_amount),
    payment_option = coalesce(
        payment_option,
        case when paid_amount >= total_amount then 'full' else 'deposit' end
    );

alter table public.orders
    alter column customer_phone set not null,
    alter column customer_address set not null,
    alter column total_amount set not null,
    alter column paid_amount set not null,
    alter column remaining_amount set not null,
    alter column payment_option set default 'deposit',
    alter column payment_option set not null;

alter table public.orders drop constraint if exists orders_payment_option_check;
alter table public.orders add constraint orders_payment_option_check
    check (payment_option in ('deposit', 'full'));

create table if not exists public.store_settings (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.store_settings enable row level security;

drop policy if exists "Public can read products" on public.products;
create policy "Public can read products"
    on public.products for select to anon, authenticated using (true);

drop policy if exists "Admin manages products" on public.products;
create policy "Admin manages products"
    on public.products for all to authenticated
    using (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid)
    with check (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid);

drop policy if exists "Admin reads orders" on public.orders;
create policy "Admin reads orders"
    on public.orders for select to authenticated
    using (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid);

drop policy if exists "Admin updates orders" on public.orders;
create policy "Admin updates orders"
    on public.orders for update to authenticated
    using (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid)
    with check (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid);

drop policy if exists "Admin deletes orders" on public.orders;
create policy "Admin deletes orders"
    on public.orders for delete to authenticated
    using (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid);

revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;

revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated;
grant update (status, delivery_fee), delete on public.orders to authenticated;

drop policy if exists "Public can read store settings" on public.store_settings;
create policy "Public can read store settings"
    on public.store_settings for select to anon, authenticated using (true);

drop policy if exists "Admin manages store settings" on public.store_settings;
create policy "Admin manages store settings"
    on public.store_settings for all to authenticated
    using (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid)
    with check (auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid);

revoke all on public.store_settings from anon, authenticated;
grant select on public.store_settings to anon, authenticated;
grant insert, update, delete on public.store_settings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('products', 'products', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
    ('order-receipts', 'order-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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

drop policy if exists "Customers upload order receipts" on storage.objects;
create policy "Customers upload order receipts"
    on storage.objects for insert to anon, authenticated
    with check (
        bucket_id = 'order-receipts'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/receipt\.(jpg|png|webp)$'
        and coalesce((metadata->>'size')::bigint, 0) between 1 and 5242880
        and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
    );

drop policy if exists "Admin reads order receipts" on storage.objects;
create policy "Admin reads order receipts"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'order-receipts'
        and auth.uid() = '3e8f1da7-10f7-4d57-9d20-cb81446e9982'::uuid
    );

create or replace function public.create_order(order_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
    order_id uuid;
    customer_name text;
    customer_phone text;
    customer_address text;
    phone text;
    whatsapp text;
    governorate text;
    city text;
    address text;
    payment_method text;
    payment_option text;
    receipt_path text;
    item jsonb;
    product_row public.products%rowtype;
    order_items jsonb := '[]'::jsonb;
    unit_price numeric(10, 2);
    line_total numeric(12, 2);
    order_total numeric(12, 2) := 0;
    order_deposit numeric(12, 2);
begin
    if jsonb_typeof(order_data) <> 'object'
        or jsonb_typeof(order_data->'items') <> 'array'
        or jsonb_array_length(order_data->'items') not between 1 and 30 then
        raise exception 'بيانات الطلب أو قائمة المنتجات غير صالحة';
    end if;

    order_id := (order_data->>'id')::uuid;
    customer_name := btrim(order_data->>'customer_name');
    customer_phone := btrim(order_data->>'customer_phone');
    customer_address := btrim(order_data->>'customer_address');
    phone := customer_phone;
    whatsapp := customer_phone;
    governorate := btrim(order_data->>'governorate');
    city := btrim(order_data->>'city');
    address := customer_address;
    payment_method := order_data->>'payment_method';
    payment_option := order_data->>'payment_option';
    receipt_path := order_data->>'receipt_path';

    if customer_name is null or char_length(customer_name) not between 1 and 120
        or customer_phone is null or customer_phone !~ '^01[0125][0-9]{8}$'
        or customer_address is null or char_length(customer_address) not between 1 and 700
        or governorate is null or char_length(governorate) not between 1 and 80
        or city is null or char_length(city) not between 1 and 80
        or address is null or char_length(address) not between 1 and 700
        or payment_method not in ('Vodafone Cash', 'InstaPay')
        or payment_option is null
        or payment_option not in ('deposit', 'full')
        or receipt_path !~ ('^' || order_id::text || '/receipt\.(jpg|png|webp)$') then
        raise exception 'بيانات التوصيل أو الدفع غير صالحة';
    end if;

    if not exists (
        select 1 from storage.objects
        where bucket_id = 'order-receipts' and name = receipt_path
    ) then
        raise exception 'إيصال التحويل غير موجود';
    end if;

    for item in select value from jsonb_array_elements(order_data->'items')
    loop
        if jsonb_typeof(item) <> 'object'
            or coalesce(item->>'quantity', '') !~ '^[0-9]+$'
            or (item->>'quantity')::integer not between 1 and 20
            or coalesce(item->>'id', '') = '' then
            raise exception 'تفاصيل أحد المنتجات غير صالحة';
        end if;

        select * into product_row from public.products where id = item->>'id';
        if not found then
            raise exception 'أحد المنتجات لم يعد متاحًا';
        end if;

        unit_price := product_row.price;
        line_total := unit_price * (item->>'quantity')::integer;
        order_total := order_total + line_total;
        order_items := order_items || jsonb_build_array(jsonb_build_object(
            'productId', product_row.id,
            'name', product_row.name,
            'images', coalesce(product_row.images, '[]'::jsonb),
            'unitPrice', unit_price,
            'quantity', (item->>'quantity')::integer,
            'lineTotal', line_total
        ));
    end loop;

    order_total := round(order_total, 2);
    order_deposit := case
        when payment_option = 'full' then order_total
        else round(order_total * 0.5, 2)
    end;

    insert into public.orders (
        id, customer_name, customer_phone, customer_address, total_amount, paid_amount, remaining_amount,
        delivery_fee, phone, whatsapp, governorate, city, address, items, total, deposit, remaining,
        payment_method, payment_option, status, receipt_path
    ) values (
        order_id, customer_name, customer_phone, customer_address, order_total, order_deposit,
        order_total - order_deposit, null, phone, whatsapp, governorate, city, address, order_items,
        order_total, order_deposit, order_total - order_deposit,
        payment_method, payment_option, 'new', receipt_path
    );

    return jsonb_build_object(
        'id', order_id,
        'total_amount', order_total,
        'paid_amount', order_deposit,
        'remaining_amount', order_total - order_deposit,
        'delivery_fee', null,
        'total', order_total,
        'deposit', order_deposit,
        'remaining', order_total - order_deposit,
        'payment_option', payment_option,
        'receipt_path', receipt_path
    );
end;
$$;

alter function public.create_order(jsonb) owner to postgres;
revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon, authenticated;
