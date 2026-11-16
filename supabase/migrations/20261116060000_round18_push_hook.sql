-- ─── ฐานข้อมูลเรียกแจ้งเตือนเอง (กันพลาด) ─────────────────────────
/*
 * ของเดิมหน้าจอเป็นคนบอกเซิร์ฟเวอร์ว่า "ใบนี้เพิ่งเปลี่ยน" หลังยื่น/อนุมัติสำเร็จ
 * ซึ่งพอใช้ได้ แต่ถ้าเน็ตของผู้ใช้หลุดพอดีหลังใบเข้าระบบ แจ้งเตือนก็ไม่ออก
 * และไม่มีใครรู้ว่าหายไป
 *
 * ตรงนี้ให้ฐานข้อมูลเป็นคนเรียกเองทุกครั้งที่สถานะใบเปลี่ยน ไม่ว่าจะมาจากหน้าจอไหน
 * ยิงเป็น HTTP ออกไปหา /api/push/hook ด้วย pg_net (ส่งแบบไม่รอคำตอบ ไม่หน่วงธุรกรรม)
 *
 * สองทางนี้ใช้ตัวส่งเดียวกันและกันส่งซ้ำด้วยตาราง push_sent — ใครจองคู่ (ใบ, สถานะ)
 * ได้ก่อนเป็นคนส่ง อีกทางเงียบไป เครื่องปลายทางจึงไม่สั่นสองรอบ
 */

create extension if not exists pg_net with schema extensions;

-- ใบไหนสถานะไหนส่งแจ้งเตือนไปแล้ว
create table if not exists public.push_sent (
  doc_id  uuid not null,
  status  text not null,
  sent_at timestamptz not null default now(),
  primary key (doc_id, status)
);

alter table public.push_sent enable row level security;
revoke all on public.push_sent from public, anon, authenticated;
/* ไม่มีนโยบายใด = ผู้ใช้ทั่วไปอ่านไม่ได้เลย ตารางนี้เป็นของระบบ */

-- ที่อยู่และกุญแจลับของปลายทาง — ตั้งค่าด้วยกุญแจระบบ ไม่เก็บไว้ในโค้ด
create table if not exists public.hook_config (
  id     boolean primary key default true check (id),
  url    text not null default '',
  secret text not null default ''
);

insert into public.hook_config (id) values (true) on conflict (id) do nothing;

alter table public.hook_config enable row level security;
revoke all on public.hook_config from public, anon, authenticated;

/*
 * ส่งต่อให้ปลายทางรู้ว่าใบไหนเปลี่ยน
 * ยิงเฉพาะสถานะที่มีคนต้องรู้ และเฉพาะตอนที่สถานะเปลี่ยนจริง
 * ยังไม่ได้ตั้งค่า url/กุญแจ = ไม่ทำอะไร ระบบเดินต่อได้ตามปกติ
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

  perform extensions.net.http_post(
    url     := v_cfg.url,
    body    := jsonb_build_object('kind', v_kind, 'id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-maz-hook', v_cfg.secret),
    timeout_milliseconds := 5000
  );
  return null;
end $$;

drop trigger if exists leave_push_hook on public.leave_requests;
create trigger leave_push_hook after insert or update of status on public.leave_requests
  for each row execute function public.notify_push_hook();

drop trigger if exists ot_push_hook on public.ot_requests;
create trigger ot_push_hook after insert or update of status on public.ot_requests
  for each row execute function public.notify_push_hook();

drop trigger if exists claim_push_hook on public.expense_claims;
create trigger claim_push_hook after insert or update of status on public.expense_claims
  for each row execute function public.notify_push_hook();
