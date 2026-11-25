/* รอบที่ 110 — ตารางงานของฝ่ายโครงการ (นัดหมาย/กิจกรรม)

   เดิมเก็บใน localStorage ทั้งก้อน (maz-erp.pm-schedule.v5) — นัดที่ PM สร้าง
   ผู้เข้าร่วมบนเครื่องอื่นจึงไม่เห็นเลย ทั้งที่ใบนัดมีรายชื่อคนที่ต้องกันเวลาไว้
   (ผู้ใช้สั่ง 25 พ.ย. 2569 ให้ย้ายขึ้นฐานข้อมูล)

   ใบนัดเก็บทั้งใบในแถวเดียว ส่วนประวัติการแก้แยกตาราง เพราะเป็นของที่ต่อท้ายเรื่อย ๆ
   และห้ามแก้ย้อนหลัง · ยกเลิกแล้วเก็บใบไว้เป็นประวัติ ไม่ลบทิ้ง (ยูสเคส PM-06 BR-03) */

create table if not exists public.pm_events (
  /* รหัสออกจากฝั่งหน้าจอ เพราะกดบันทึกแล้วหน้าจอต้องเลือกใบนั้นต่อทันที ไม่รอฐานข้อมูลตอบ */
  id          uuid primary key,
  on_date     date not null,
  /* วันสิ้นสุดของนัดข้ามวัน — ว่าง = จบวันเดียวกับที่เริ่ม */
  date_end    date,
  /* เวลาเริ่ม-จบ HH:mm */
  from_time   text not null default '',
  to_time     text not null default '',
  kind        text not null default '',
  /* สีที่ผู้ใช้เลือกเอง — ว่าง = ใช้สีของประเภท */
  col         text not null default '',
  title       text not null check (btrim(title) <> ''),
  place       text not null default '',
  /* เลขที่โปรเจค (PJ-…) ที่นัดนี้เกี่ยวข้อง — ว่าง = ไม่ผูกกับโปรเจคไหน */
  pj          text not null default '',
  /* รหัสพนักงานที่ต้องเข้าร่วม */
  who         text[] not null default '{}',
  /* สิ่งที่ต้องเตรียม — เป็นค่าตั้งต้นของช่องรายละเอียด */
  todo        text[] not null default '{}',
  /* ใครสร้างนัดนี้ — ใบเก่าที่ไม่มีค่าถือว่า PM สร้าง */
  by_role     text not null default 'pm' check (by_role in ('pm', 'gm', 'ps', 'sales')),
  /* นัดของทีมก่อนการขายต้องผูกกับคำขอที่ตัวเองรับผิดชอบ กันไม่ให้กลายเป็นปฏิทินส่วนตัว */
  ps_no       text not null default '',
  /* รายละเอียดที่พิมพ์เอง — null = ยังไม่เคยเขียน (ให้ใช้ todo เป็นค่าตั้งต้น) · '' = เขียนแล้วลบจนว่าง */
  note        text,
  cancel_at   timestamptz,
  cancel_by   text not null default '',
  cancel_why  text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid references public.employees (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint pm_events_ps_needs_no check (by_role <> 'ps' or btrim(ps_no) <> ''),
  constraint pm_events_span check (date_end is null or date_end >= on_date)
);

create index if not exists pm_events_date_idx on public.pm_events (on_date);
create index if not exists pm_events_pj_idx on public.pm_events (pj) where pj <> '';

drop trigger if exists pm_events_touch on public.pm_events;
create trigger pm_events_touch before update on public.pm_events
  for each row execute function public.touch_updated_at();

/* ─── ประวัติการแก้ที่ผู้เข้าร่วมต้องรู้ ──────────────────────────
   เปลี่ยนวัน เวลา หรือรายชื่อผู้เข้าร่วมเท่านั้น (แก้หัวข้อ/สถานที่/สีไม่ต้องกวนใคร)
   คนที่ถูกถอดออกจะไม่เห็นนัดนี้ในปฏิทินตัวเองอีก ใบนี้จึงเป็นที่เดียวที่ยังจำได้ว่าเคยถูกเชิญ
   ต่อท้ายได้ แก้หรือลบไม่ได้ */
create table if not exists public.pm_event_edits (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.pm_events (id) on delete cascade,
  at           timestamptz not null default now(),
  by_name      text not null default '',
  date_before  text not null default '',
  date_after   text not null default '',
  time_before  text not null default '',
  time_after   text not null default '',
  added        text[] not null default '{}',
  removed      text[] not null default '{}'
);

create index if not exists pm_event_edits_event_idx on public.pm_event_edits (event_id, at);

/* ─── สิทธิ์ ────────────────────────────────────────────────────────
   อ่าน: พนักงานทุกคนที่ล็อกอิน — ต้องเห็นนัดที่ตัวเองถูกเชิญในปฏิทินของตัวเอง
   เขียน: PM · GM · ทีมก่อนการขาย · ฝ่ายขาย (ตามที่เจ้าของกำหนด 24-25 ก.ย. 2569)
          พนักงานทั่วไปดูอย่างเดียว · ลบไม่ได้ ยกเลิกแล้วเก็บใบไว้ */
alter table public.pm_events      enable row level security;
alter table public.pm_event_edits enable row level security;

revoke all on public.pm_events      from public, anon;
revoke all on public.pm_event_edits from public, anon;
grant select, insert, update on public.pm_events      to authenticated;
grant select, insert         on public.pm_event_edits to authenticated;

create or replace function public.can_plan_schedule() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('pm') or public.has_role('gm')
      or public.has_role('ps') or public.has_role('sales') or public.has_role('ceo')
$$;

revoke all on function public.can_plan_schedule() from public, anon;
grant execute on function public.can_plan_schedule() to authenticated;

drop policy if exists pm_events_read       on public.pm_events;
drop policy if exists pm_events_write      on public.pm_events;
drop policy if exists pm_events_change     on public.pm_events;
drop policy if exists pm_event_edits_read  on public.pm_event_edits;
drop policy if exists pm_event_edits_write on public.pm_event_edits;

create policy pm_events_read on public.pm_events
  for select to authenticated using (public.my_employee_id() is not null);
create policy pm_events_write on public.pm_events
  for insert to authenticated with check (public.can_plan_schedule());
create policy pm_events_change on public.pm_events
  for update to authenticated
  using (public.can_plan_schedule()) with check (public.can_plan_schedule());

create policy pm_event_edits_read on public.pm_event_edits
  for select to authenticated using (public.my_employee_id() is not null);
create policy pm_event_edits_write on public.pm_event_edits
  for insert to authenticated with check (public.can_plan_schedule());

/* ─── ยกเลิกนัด ────────────────────────────────────────────────────
   เหตุผลเป็นของบังคับ — ข้อความแจ้งเตือนที่ผู้เข้าร่วมได้รับคือเหตุผลบรรทัดนี้
   ยกเลิกแล้วยกเลิกซ้ำไม่ได้ ของเดิมต้องไม่ถูกทับ */
create or replace function public.pm_event_cancel(p_event uuid, p_by text, p_why text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if not public.can_plan_schedule() then
    raise exception 'ไม่มีสิทธิ์ยกเลิกนัดหมาย';
  end if;
  if btrim(coalesce(p_why, '')) = '' then
    raise exception 'ต้องบอกเหตุผลที่ยกเลิก';
  end if;
  update public.pm_events
     set cancel_at = now(), cancel_by = coalesce(p_by, ''), cancel_why = btrim(p_why)
   where id = p_event and cancel_at is null;
  if not found then
    raise exception 'ไม่พบนัดนี้ หรือยกเลิกไปแล้ว';
  end if;
end $$;

revoke all on function public.pm_event_cancel(uuid, text, text) from public, anon;
grant execute on function public.pm_event_cancel(uuid, text, text) to authenticated;
