-- ─── ผลการตรวจเวลาทำงาน และเงินเพิ่ม/เงินหักรายคน ─────────────────
/*
 * สองเรื่องนี้มีผลกับเงินเดือนโดยตรง แต่ยังเก็บอยู่ในเครื่องที่ฝ่ายบุคคลเปิดหน้าอยู่
 *   ผลการตรวจ   วันที่ลืมตอกออก/ไม่มีบันทึกเวลา ฝ่ายบุคคลสรุปว่า "มาทำงานจริง" หรือ "ขาดงาน"
 *   เงินเพิ่ม    Incentive ค่าตำแหน่ง และรายการปรับปรุงด้วยมือ
 * ฝ่ายบุคคลคนละเครื่องจึงเห็นไม่ตรงกัน และยอดเงินเดือนที่คิดได้ก็คนละตัว
 *
 * ย้ายขึ้นฐานข้อมูลให้เป็นชุดเดียวทั้งบริษัท — ฝ่ายบุคคลเขียนได้ พนักงานอ่านของตัวเองได้
 * (ต้องอ่านได้ ไม่งั้นพนักงานเห็นยอดบนสลิปแล้วถามไม่ได้ว่าหักอะไร)
 */

-- ผลการตรวจของวันที่มีปัญหา — หนึ่งคนหนึ่งวันมีผลเดียว
create table if not exists public.time_reviews (
  employee_id uuid not null references public.employees (id) on delete cascade,
  on_date     date not null,
  /* เหตุผลหรือผลการตรวจสอบ ต้องมีเสมอ ไม่ให้สรุปลอย ๆ */
  note        text not null check (length(trim(note)) > 0),
  /* true = สรุปว่าขาดงาน หักเต็มวัน · false = มาทำงานจริง ไม่หัก */
  absent      boolean not null default false,
  decided_by  uuid references public.employees (id),
  decided_at  timestamptz not null default now(),
  primary key (employee_id, on_date)
);

alter table public.time_reviews enable row level security;
grant select, insert, update, delete on public.time_reviews to authenticated;

create policy review_read on public.time_reviews for select to authenticated
  using (employee_id = public.my_employee_id() or public.has_role('hr') or public.has_role('ceo'));
create policy review_write on public.time_reviews for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

-- เงินเพิ่มประจำรอบของแต่ละคน (Incentive · ค่าตำแหน่ง)
create table if not exists public.pay_extras (
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  employee_id uuid not null references public.employees (id) on delete cascade,
  incentive   numeric(12,2) not null default 0 check (incentive >= 0),
  allowance   numeric(12,2) not null default 0 check (allowance >= 0),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.employees (id),
  primary key (month, employee_id)
);

alter table public.pay_extras enable row level security;
grant select, insert, update, delete on public.pay_extras to authenticated;

create policy extras_read on public.pay_extras for select to authenticated
  using (employee_id = public.my_employee_id() or public.has_role('hr') or public.has_role('ceo'));
create policy extras_write on public.pay_extras for all to authenticated
  using (public.has_role('hr')) with check (public.has_role('hr'));

/* รายการปรับปรุงด้วยมือใช้ตาราง pay_adjusts ที่มีอยู่แล้ว — ให้ผู้บริหารอ่านได้ด้วย
   (ของเดิมอ่านได้เฉพาะเจ้าตัวกับฝ่ายบุคคล แต่ CEO ต้องเซ็นยอดที่รวมรายการพวกนี้) */
drop policy if exists adjust_read on public.pay_adjusts;
create policy adjust_read on public.pay_adjusts for select to authenticated
  using (employee_id = public.my_employee_id() or public.has_role('hr') or public.has_role('ceo'));
