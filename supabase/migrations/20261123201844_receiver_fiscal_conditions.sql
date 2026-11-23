-- Explicit recipient conditions; historical records remain unconfirmed.
alter table public.customers
 add column domicile text not null default 'unspecified' check(domicile in ('unspecified','domestic','foreign')),
 add column foreign_address text not null default '' check(length(foreign_address)<=300),
 add column requires_activity boolean not null default false,
 add column requires_email boolean not null default false;
notify pgrst,'reload schema';
