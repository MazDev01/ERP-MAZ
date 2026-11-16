-- pg_net ติดตั้งฟังก์ชันไว้ที่สกีมา net ไม่ใช่ extensions.net
-- (เรียกผิดที่แล้วฐานข้อมูลฟ้อง cross-database references are not implemented)
create or replace function public.notify_push_hook() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cfg  public.hook_config;
  v_kind text;
begin
  select * into v_cfg from public.hook_config where id;
  if v_cfg.url = '' or v_cfg.secret = '' then
    return null;
  end if;

  if new.status not in ('pending', 'approved', 'rejected') then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  v_kind := case tg_table_name
              when 'leave_requests'  then 'leave'
              when 'ot_requests'     then 'ot'
              when 'expense_claims'  then 'expense'
            end;
  if v_kind is null then
    return null;
  end if;

  perform net.http_post(
    url     := v_cfg.url,
    body    := jsonb_build_object('kind', v_kind, 'id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-maz-hook', v_cfg.secret),
    timeout_milliseconds := 5000
  );
  return null;
end $$;
