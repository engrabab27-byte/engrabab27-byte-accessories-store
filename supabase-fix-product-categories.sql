begin;

alter table public.products
    drop constraint if exists products_category_check;

alter table public.products
    add constraint products_category_check
    check (category in (
        'chains',
        'bracelets',
        'rings',
        'earrings',
        'anklets',
        'bangles',
        'sets',
        'misc'
    ));

commit;

select conname, pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where conrelid = 'public.products'::regclass
  and conname = 'products_category_check';
