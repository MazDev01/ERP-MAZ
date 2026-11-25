/* รอบที่ 108 — กระดาน "แผนติดตาม" ของพนักงานขาย ย้ายจากเบราว์เซอร์มาลงฐานข้อมูล

   เดิมคอลัมน์ ตำแหน่งการ์ด และประวัติการย้ายเก็บใน localStorage ของเครื่องที่ใช้
   เปลี่ยนเครื่องแล้วกระดานไม่ตามไป และล้าง cache แล้วหายทั้งหมด (ผู้ใช้สั่ง 25 พ.ย. 2569)

   กระดานเป็นของแต่ละคน ไม่ใช่ของทีม — แต่ละแถวผูกกับพนักงานเจ้าของกระดาน
   และนโยบายปล่อยให้เห็นเฉพาะกระดานของตัวเอง หัวหน้าก็ไม่เห็นกระดานลูกทีม
   ไม่ผูกกับขั้นการขาย ไม่เปิดงานจริง ไม่นับในรายงาน — เป็นแผนส่วนตัวล้วน ๆ */

/* ─── คอลัมน์ที่พนักงานตั้งเอง ───────────────────────────────────────
   "ยังไม่จัด" ไม่มีแถวในตาราง เป็นคอลัมน์หน้าสุดที่หน้าจอสร้างให้เสมอ
   pos = ลำดับซ้ายไปขวา เลื่อนคอลัมน์ = สลับค่า pos */
create table if not exists public.followup_cols (
  id         uuid primary key default gen_random_uuid(),
  emp_id     uuid not null default public.my_employee_id()
               references public.employees (id) on delete cascade,
  name       text not null check (btrim(name) <> ''),
  /* คลาสสีของป้าย (t-ok, t-late, ...) — ชุดเดียวกับป้ายสถานะทั้งระบบ */
  cls        text not null default '',
  pos        int  not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists followup_cols_emp_idx on public.followup_cols (emp_id, pos, created_at);

/* ─── การ์ดบนกระดาน ────────────────────────────────────────────────
   แถวหนึ่ง = ผู้สนใจหนึ่งรายบนกระดานของพนักงานหนึ่งคน
   col_id ว่าง = อยู่คอลัมน์ "ยังไม่จัด" · ลบคอลัมน์แล้วการ์ดกลับไปยังไม่จัดเอง
   seen_at = วันที่การ์ดโผล่บนกระดานครั้งแรก ใช้นับวันเมื่อยังไม่เคยย้าย */
create table if not exists public.followup_cards (
  emp_id      uuid not null default public.my_employee_id()
                references public.employees (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  col_id      uuid references public.followup_cols (id) on delete set null,
  seen_at     timestamptz not null default now(),
  moved_at    timestamptz,
  primary key (emp_id, customer_id)
);

/* ─── ประวัติการย้าย ──────────────────────────────────────────────
   เก็บ "ชื่อคอลัมน์ ณ ตอนย้าย" ไม่ใช่รหัส — เปลี่ยนชื่อหรือลบคอลัมน์ทีหลัง
   ประวัติยังอ่านรู้เรื่อง · แก้หรือลบประวัติไม่ได้ */
create table if not exists public.followup_moves (
  id          uuid primary key default gen_random_uuid(),
  emp_id      uuid not null default public.my_employee_id()
                references public.employees (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  from_name   text not null default '',
  to_name     text not null default '',
  by_name     text not null default '',
  at          timestamptz not null default now()
);

create index if not exists followup_moves_card_idx on public.followup_moves (emp_id, customer_id, at);

/* ─── สิทธิ์ ────────────────────────────────────────────────────────
   เห็นและแก้ได้เฉพาะกระดานของตัวเอง · ประวัติเขียนได้แต่แก้/ลบไม่ได้ */
alter table public.followup_cols  enable row level security;
alter table public.followup_cards enable row level security;
alter table public.followup_moves enable row level security;

revoke all on public.followup_cols  from public, anon;
revoke all on public.followup_cards from public, anon;
revoke all on public.followup_moves from public, anon;
grant select, insert, update, delete on public.followup_cols  to authenticated;
grant select, insert, update, delete on public.followup_cards to authenticated;
grant select, insert                 on public.followup_moves to authenticated;

drop policy if exists followup_cols_own  on public.followup_cols;
drop policy if exists followup_cards_own on public.followup_cards;
drop policy if exists followup_moves_see on public.followup_moves;
drop policy if exists followup_moves_add on public.followup_moves;

create policy followup_cols_own on public.followup_cols
  for all to authenticated
  using (emp_id = public.my_employee_id())
  with check (emp_id = public.my_employee_id() and public.can_see_sales());

create policy followup_cards_own on public.followup_cards
  for all to authenticated
  using (emp_id = public.my_employee_id())
  with check (emp_id = public.my_employee_id() and public.can_see_sales());

create policy followup_moves_see on public.followup_moves
  for select to authenticated using (emp_id = public.my_employee_id());
create policy followup_moves_add on public.followup_moves
  for insert to authenticated
  with check (emp_id = public.my_employee_id() and public.can_see_sales());

/* ─── ย้ายการ์ดในคำสั่งเดียว ───────────────────────────────────────
   เปลี่ยนคอลัมน์ + ลงประวัติพร้อมกัน จะได้ไม่มีกรณีย้ายแล้วประวัติหาย
   p_to ว่าง = ย้ายกลับไปยังไม่จัด · ชื่อคอลัมน์หามาจากตารางตอนนี้ */
create or replace function public.followup_move(p_customer uuid, p_to uuid, p_by text default '')
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_emp  uuid := public.my_employee_id();
  v_from uuid;
  v_fn   text;
  v_tn   text;
  v_new  boolean := false;
begin
  if v_emp is null then
    raise exception 'ไม่พบพนักงานของผู้ใช้นี้';
  end if;

  select col_id into v_from from public.followup_cards
   where emp_id = v_emp and customer_id = p_customer;
  if not found then
    v_new := true;
  end if;

  if not v_new and coalesce(v_from::text, '') = coalesce(p_to::text, '') then
    return;
  end if;

  select name into v_fn from public.followup_cols where id = v_from and emp_id = v_emp;
  select name into v_tn from public.followup_cols where id = p_to  and emp_id = v_emp;
  if p_to is not null and v_tn is null then
    raise exception 'ไม่พบคอลัมน์นี้บนกระดานของคุณ';
  end if;

  insert into public.followup_cards (emp_id, customer_id, col_id, moved_at)
  values (v_emp, p_customer, p_to, now())
  on conflict (emp_id, customer_id)
    do update set col_id = excluded.col_id, moved_at = now();

  insert into public.followup_moves (emp_id, customer_id, from_name, to_name, by_name)
  values (v_emp, p_customer, coalesce(v_fn, 'ยังไม่จัด'), coalesce(v_tn, 'ยังไม่จัด'), p_by);
end $$;

revoke all on function public.followup_move(uuid, uuid, text) from public, anon;
grant execute on function public.followup_move(uuid, uuid, text) to authenticated;

/* ─── ลบคอลัมน์ ────────────────────────────────────────────────────
   การ์ดในคอลัมน์กลับไปยังไม่จัด และลงประวัติให้ทุกใบก่อนลบ */
create or replace function public.followup_drop_col(p_col uuid, p_by text default '')
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_emp  uuid := public.my_employee_id();
  v_name text;
begin
  select name into v_name from public.followup_cols where id = p_col and emp_id = v_emp;
  if v_name is null then
    raise exception 'ไม่พบคอลัมน์นี้บนกระดานของคุณ';
  end if;

  insert into public.followup_moves (emp_id, customer_id, from_name, to_name, by_name)
  select v_emp, customer_id, v_name, 'ยังไม่จัด', p_by
    from public.followup_cards
   where emp_id = v_emp and col_id = p_col;

  delete from public.followup_cols where id = p_col and emp_id = v_emp;
end $$;

revoke all on function public.followup_drop_col(uuid, text) from public, anon;
grant execute on function public.followup_drop_col(uuid, text) to authenticated;
