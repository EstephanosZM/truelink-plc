-- TRUE LINK PLC — Supabase Schema
-- Run this in your Supabase SQL Editor

create extension if not exists "pgcrypto";

-- Settings (single row)
create table if not exists settings (
  id               uuid primary key default gen_random_uuid(),
  warehouse_name   text not null default 'Warehouse',
  warehouse_lat    double precision not null default 0,
  warehouse_lon    double precision not null default 0,
  updated_at       timestamptz default now()
);
create unique index if not exists settings_singleton on settings ((true));
insert into settings (warehouse_name, warehouse_lat, warehouse_lon)
values ('Warehouse', 0, 0) on conflict do nothing;

-- Territories
create table if not exists territories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  color       text not null default '#3b82f6',
  created_at  timestamptz default now()
);

-- Proximity settings (one per territory)
create table if not exists proximity_settings (
  id                  uuid primary key default gen_random_uuid(),
  territory_id        uuid not null references territories(id) on delete cascade unique,
  radius_meters       int not null default 100,
  proximity_enabled   boolean not null default false,
  updated_at          timestamptz default now()
);

-- Outlets
create table if not exists outlets (
  id             uuid primary key default gen_random_uuid(),
  territory_id   uuid not null references territories(id) on delete cascade,
  pep_code       text,
  outlet_name    text not null,
  owner_name     text,
  phone_number   text,
  ot1_id         text,
  land_mark      text,
  latitude       double precision not null,
  longitude      double precision not null,
  route_code     text,
  visit_freq     text,
  visit_day      text,
  visit_week     text,
  status         text not null default 'active',
  notes          text,
  created_at     timestamptz default now()
);
create index if not exists outlets_territory_id on outlets(territory_id);

-- Sales representatives
create table if not exists sales_representatives (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  phone_number   text,
  territory_id   uuid references territories(id) on delete set null,
  created_at     timestamptz default now()
);

-- Route plans
create table if not exists route_plans (
  id             uuid primary key default gen_random_uuid(),
  territory_id   uuid not null references territories(id) on delete cascade,
  generated_at   timestamptz default now(),
  n_days         int not null,
  min_outlets    int not null default 1,
  max_outlets    int not null default 9999,
  status         text not null default 'draft' check (status in ('draft','saved'))
);
create index if not exists route_plans_territory_id on route_plans(territory_id);

-- Route stops
create table if not exists route_stops (
  id                      uuid primary key default gen_random_uuid(),
  route_plan_id           uuid not null references route_plans(id) on delete cascade,
  day_number              int not null,
  outlet_id               uuid not null references outlets(id) on delete cascade,
  sequence                int not null,
  sales_rep_id            uuid references sales_representatives(id) on delete set null,
  visited                 boolean not null default false,
  visited_at              timestamptz,
  checkin_lat             double precision,
  checkin_lon             double precision,
  checkin_distance_m      double precision,
  checkin_within_radius   boolean,
  checkin_flagged         boolean not null default false,
  flag_reason             text
);
create index if not exists route_stops_plan_id on route_stops(route_plan_id);
create index if not exists route_stops_day on route_stops(route_plan_id, day_number);

-- Territory polygons
create table if not exists territory_polygons (
  id              uuid primary key default gen_random_uuid(),
  route_plan_id   uuid not null references route_plans(id) on delete cascade,
  day_number      int not null,
  geojson         jsonb not null,
  created_at      timestamptz default now()
);

-- Brands
create table if not exists brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  logo_url    text,
  created_at  timestamptz default now()
);

-- Flavors
create table if not exists flavors (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  name        text not null,
  created_at  timestamptz default now()
);
create index if not exists flavors_brand_id on flavors(brand_id);

-- Products
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references brands(id) on delete cascade,
  flavor_id        uuid not null references flavors(id) on delete cascade,
  name             text not null,
  sku_code         text unique,
  unit_price       double precision not null default 0,
  description      text,
  status           text not null default 'active',
  created_at       timestamptz default now()
);
create index if not exists products_brand_id on products(brand_id);
create index if not exists products_flavor_id on products(flavor_id);

-- Sales records
create table if not exists sales_records (
  id               uuid primary key default gen_random_uuid(),
  route_plan_id    uuid not null references route_plans(id) on delete cascade,
  day_number       int not null,
  outlet_id        uuid not null references outlets(id) on delete cascade,
  sales_rep_id     uuid references sales_representatives(id) on delete set null,
  product_id       uuid not null references products(id) on delete cascade,
  quantity         int not null,
  unit_price       double precision not null,
  total_price      double precision not null,
  sale_date        date not null,
  notes            text,
  created_at       timestamptz default now()
);
create index if not exists sales_records_plan_id    on sales_records(route_plan_id);
create index if not exists sales_records_outlet_id  on sales_records(outlet_id);
create index if not exists sales_records_rep_id     on sales_records(sales_rep_id);
create index if not exists sales_records_sale_date  on sales_records(sale_date);

-- Row Level Security
alter table settings             enable row level security;
alter table territories          enable row level security;
alter table proximity_settings   enable row level security;
alter table outlets              enable row level security;
alter table sales_representatives enable row level security;
alter table route_plans          enable row level security;
alter table route_stops          enable row level security;
alter table territory_polygons   enable row level security;
alter table brands               enable row level security;
alter table flavors              enable row level security;
alter table products             enable row level security;
alter table sales_records        enable row level security;

create policy "auth_all" on settings              for all to authenticated using (true) with check (true);
create policy "auth_all" on territories           for all to authenticated using (true) with check (true);
create policy "auth_all" on proximity_settings    for all to authenticated using (true) with check (true);
create policy "auth_all" on outlets               for all to authenticated using (true) with check (true);
create policy "auth_all" on sales_representatives for all to authenticated using (true) with check (true);
create policy "auth_all" on route_plans           for all to authenticated using (true) with check (true);
create policy "auth_all" on route_stops           for all to authenticated using (true) with check (true);
create policy "auth_all" on territory_polygons    for all to authenticated using (true) with check (true);
create policy "auth_all" on brands                for all to authenticated using (true) with check (true);
create policy "auth_all" on flavors               for all to authenticated using (true) with check (true);
create policy "auth_all" on products              for all to authenticated using (true) with check (true);
create policy "auth_all" on sales_records         for all to authenticated using (true) with check (true);
