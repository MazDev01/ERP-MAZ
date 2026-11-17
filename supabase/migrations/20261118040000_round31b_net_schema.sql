-- ─── pg_net อยู่สกีมา net ไม่ใช่ extensions.net ───────────────────
/*
 * round31 เขียน extensions.net.http_post ตามของเดิมก่อน round18b
 * ของจริงบนคลาวด์ pg_net ติดตั้งอยู่ที่สกีมา net เฉย ๆ
 * เรียกผิดที่แล้วทริกเกอร์โยน "cross-database references are not implemented"
 * ซึ่งทำให้ "ยื่นใบลาไม่ได้เลย" ไม่ใช่แค่แจ้งเตือนไม่ออก (เจอตอนทดสอบบนเว็บจริง 17 พ.ย. 2569)
 *
 * บทเรียนเดียวกับ round18b — ที่นี่แก้ให้ตรงและไม่ให้พลาดซ้ำ
 */
create or replace function public.push_fire(p_doc uuid, p_kind text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cfg public.hook_config;
begin
  select * into v_cfg from public.hook_config where id;
  if v_cfg.url = '' or v_cfg.secret = '' then
    return;
  end if;
  perform net.http_post(
    url     := v_cfg.url,
    body    := jsonb_build_object('kind', p_kind, 'id', p_doc),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-maz-hook', v_cfg.secret),
    timeout_milliseconds := 5000
  );
  update public.push_outbox
     set tries = tries + 1, last_at = now()
   where doc_id = p_doc and status = p_status;
end $$;

/*
 * แจ้งเตือนพังต้องไม่ทำให้ยื่นใบไม่ได้
 * ใบเข้าระบบคือเรื่องหลัก แจ้งเตือนเป็นเรื่องรอง ถ้าส่วนรองพังให้บันทึกไว้แล้วเดินต่อ
 * งานที่ค้างอยู่ในคิวจะถูกยิงซ้ำโดย pg_cron ทุกนาทีอยู่แล้ว
 */
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

  begin
    insert into public.push_outbox (doc_id, kind, status)
    values (new.id, v_kind, new.status)
    on conflict (doc_id, status) do nothing;

    perform public.push_fire(new.id, v_kind, new.status);
  exception
    when others then
      /* บันทึกไว้ให้ตามได้ แต่ห้ามล้มธุรกรรมของใบ */
      insert into public.audit_log (actor, action, detail)
      values (null, 'push_hook_failed',
              jsonb_build_object('doc', new.id, 'kind', v_kind, 'err', sqlerrm));
  end;
  return null;
end $$;
