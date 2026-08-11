create index if not exists orders_market_instrument_id_idx
  on public.orders(market_instrument_id)
  where market_instrument_id is not null;

create index if not exists positions_market_instrument_id_idx
  on public.positions(market_instrument_id)
  where market_instrument_id is not null;