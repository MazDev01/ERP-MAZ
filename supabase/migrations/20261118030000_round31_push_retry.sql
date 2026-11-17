-- ─── ยิงแจ้งเตือนพลาดแล้วต้องยิงซ้ำ ───────────────────────────────
/*
 * ฐานข้อมูลยิง HTTP ไปหา /api/push/hook เองทุกครั้งที่สถานะใบเปลี่ยน (round18)
 * แต่ของจริงยิงพลาดเป็นครั้งคราว — จาก 47 ครั้งพลาด 8 ครั้ง
 * ("Error in the HTTP2 framing layer" และ timeout) แจ้งเตือนรอบนั้นจึงหายไปเงียบ ๆ
 * ผู้อนุมัติไม่รู้ว่ามีใบใหม่จนกว่าจะเปิดแอปเอง (เจอตอนทดสอบบนเว็บจริง 17 พ.ย. 2569)
 *
 * ที่นี่เก็บงานที่ต้องแจ้งไว้ในตารางก่อน (push_outbox) แล้วค่อยยิง
 * ปลายทางส่งสำเร็จเมื่อไรเป็นคนมาปิดงานเอง ถ้ายังไม่ปิดภายในหนึ่งนาที = ยิงใหม่
 * ส่งซ้ำไม่ทำให้เครื่องสั่นสองรอบ เพราะ push_sent จองคู่ (ใบ, สถานะ) ไว้อยู่แล้ว
 */

create table if not exists public.push_outbox (
  doc_id   uuid not null,
  kind     text not null check (kind in ('leave', 'ot', 'expense')),
  status   text not null,
  tries    int  not null default 0,
  made_at  timestamptz not null default now(),
  last_at  timestamptz,
  done_at  timestamptz,
  primary key (doc_id, status)
);

alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from public, anon, authenticated;
/* ไม่มีนโยบาย = ผู้ใช้ทั่วไปแตะไม่ได้เลย ตารางนี้เป็นของระบบ */

create index if not exists push_outbox_todo on public.push_outbox (done_at, last_at);

/** ยิงงานหนึ่งใบออกไป (ใช้ทั้งตอนเกิดใบและตอนยิงซ้ำ) */
create or replace function public.push_fire(p_doc uuid, p_kind text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cfg public.hook_config;
begin
  select * into v_cfg from public.hook_config where id;
  if v_cfg.url = '' or v_cfg.secret = '' then
    return;
  end if;
  perform extensions.net.http_post(
    url     := v_cfg.url,
    body    := jsonb_build_object('kind', p_kind, 'id', p_doc),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-maz-hook', v_cfg.secret),
    timeout_milliseconds := 5000
  );
  update public.push_outbox
     set tries = tries + 1, last_at = now()
   where doc_id = p_doc and status = p_status;
end $$;

/* ปลายทางเรียกกลับมาปิดงานเมื่อส่งถึงเครื่องแล้ว (หรือไม่มีเครื่องให้ส่ง) */
create or replace function public.push_done(p_doc uuid, p_status text)
returns void language sql security definer set search_path = '' as $$
  update public.push_outbox set done_at = now()
   where doc_id = p_doc and status = p_status and done_at is null;
$$;

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

  insert into public.push_outbox (doc_id, kind, status)
  values (new.id, v_kind, new.status)
  on conflict (doc_id, status) do nothing;

  perform public.push_fire(new.id, v_kind, new.status);
  return null;
end $$;

/*
 * ยิงซ้ำงานที่ยังไม่ถูกปิด — เรียกทุกนาทีโดย pg_cron
 * เว้นอย่างน้อยหนึ่งนาทีหลังยิงครั้งก่อน และเลิกยิงหลังครั้งที่ห้า
 * (ยิงไม่ติดห้าครั้งแปลว่าปลายทางล่มจริง ไม่ใช่เน็ตสะดุด — ปล่อยให้คนเปิดแอปเห็นเอง)
 */
create or replace function public.push_retry() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select doc_id, kind, status from public.push_outbox
     where done_at is null and tries < 5
       and coalesce(last_at, made_at) < now() - interval '1 minute'
       and made_at > now() - interval '1 day'
     order by made_at
     limit 20
  loop
    perform public.push_fire(r.doc_id, r.kind, r.status);
    n := n + 1;
  end loop;
  /* ของเก่ากว่าเจ็ดวันไม่ต้องเก็บไว้ให้ตารางบวม */
  delete from public.push_outbox where made_at < now() - interval '7 days';
  return n;
end $$;

create extension if not exists pg_cron;

select cron.unschedule('push-retry') where exists (select 1 from cron.job where jobname = 'push-retry');
select cron.schedule('push-retry', '* * * * *', $$select public.push_retry()$$);
