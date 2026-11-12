-- CRM (админка Алии): хранилище фото заказов и индексы для списков. Только добавления к 0001_core.

-- Приватный bucket для фото этикеток и вещей. Доступ только с сервера (service role),
-- в браузер фото отдаются через /api/crm/photos/<id> подписанной ссылкой.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-photos', 'order-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create index if not exists order_photos_order_idx on order_photos (order_id, created_at);
create index if not exists order_events_order_idx on order_events (order_id, created_at desc);
create index if not exists orders_status_idx on orders (status, created_at desc);
