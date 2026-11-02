delete from public.products
where id in (
    'n-01', 'e-01', 'b-01', 'r-01',
    'n-02', 'e-02', 'b-02', 'r-02',
    'a-01', 'a-02', 'm-01', 'm-02'
);
