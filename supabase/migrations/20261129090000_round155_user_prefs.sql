/*
 * รอบที่ 155 — ค่าตั้งส่วนตัวและร่างที่ยังไม่ยืนยัน เก็บที่ระบบ ไม่ใช่ที่เครื่อง
 *
 * ของเดิมอยู่ใน localStorage ของเบราว์เซอร์ที่เปิด ผลคือ
 *   · เปลี่ยนเครื่องหรือเปลี่ยนเบราว์เซอร์ ค่าที่ตั้งไว้หายทั้งชุด
 *   · ล้างข้อมูลเว็บหรือใช้โหมดส่วนตัว ร่างโปรเจคใหม่ของฝ่ายโครงการหายไปเลย
 *   · เครื่องเดียวกันหลายคนใช้ ค่าของคนก่อนติดมาให้คนหลัง
 *
 * ตารางนี้เก็บเป็นคู่ "คีย์ → ค่า" รายคน ไม่ได้บังคับรูปแบบของค่า
 * เพราะแต่ละหน้าจอเก็บคนละรูป (เปิด/ปิดการ์ด · ลำดับคอลัมน์ · ร่างโปรเจค)
 * ค่าที่เก็บได้จึงจำกัดด้วยรายชื่อคีย์ที่อนุญาต ไม่ใช่ที่โครงสร้างของค่า
 *
 * ใครเห็นของตัวเองเท่านั้น — ไม่มีใครรวมถึงฝ่ายบุคคลอ่านค่าตั้งส่วนตัวของคนอื่นได้
 */

create table if not exists public.user_prefs (
  employee_id uuid not null references public.employees (id) on delete cascade,
  /* คีย์ = ชื่อชุดข้อมูลของหน้าจอ (ชื่อเดียวกับที่เคยใช้ใน localStorage) */
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (employee_id, key)
);

/* คีย์ที่รับ — กันคนเขียนสคริปต์ยิงข้อมูลอะไรก็ได้เข้ามาเก็บฟรี */
create or replace function public.pref_key_ok(p_key text)
returns boolean
language sql
immutable
as $$
  select p_key in (
    'maz-erp.dashboard-cards.v1',   -- การ์ดบนหน้าแรกที่เลือกเปิด
    'maz-erp.botnav.v1',            -- แถบล่างบนมือถือ
    'maz-erp.pipeline-cols.v1',     -- ลำดับคอลัมน์กระดานงานขาย
    'maz-erp.pm-project-new.v1'     -- ร่างโปรเจคใหม่ของฝ่ายโครงการ
  )
$$;

alter table public.user_prefs enable row level security;

drop policy if exists prefs_own_read on public.user_prefs;
create policy prefs_own_read on public.user_prefs
  for select using (employee_id = public.my_employee_id());

drop policy if exists prefs_own_write on public.user_prefs;
create policy prefs_own_write on public.user_prefs
  for insert with check (
    employee_id = public.my_employee_id() and public.pref_key_ok(key)
  );

drop policy if exists prefs_own_change on public.user_prefs;
create policy prefs_own_change on public.user_prefs
  for update using (employee_id = public.my_employee_id())
  with check (employee_id = public.my_employee_id() and public.pref_key_ok(key));

drop policy if exists prefs_own_drop on public.user_prefs;
create policy prefs_own_drop on public.user_prefs
  for delete using (employee_id = public.my_employee_id());

grant select, insert, update, delete on public.user_prefs to authenticated;

/** ค่าตั้งส่วนตัวทั้งชุดของคนที่ล็อกอิน — หน้าจออ่านครั้งเดียวตอนเปิดแอป */
create or replace function public.prefs_all()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(p.key, p.value), '{}'::jsonb)
    from public.user_prefs p
   where p.employee_id = public.my_employee_id()
$$;

/**
 * บันทึกค่าตั้งหนึ่งชุด — ค่าว่าง (null) คือลบทิ้ง กลับไปใช้ค่าตั้งต้น
 * คืน false เมื่อคีย์ไม่อยู่ในรายชื่อที่รับ หรือบัญชีนี้ยังไม่ผูกกับพนักงาน
 */
create or replace function public.pref_set(p_key text, p_value jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.my_employee_id();
begin
  if v_me is null or not public.pref_key_ok(p_key) then
    return false;
  end if;
  if p_value is null then
    delete from public.user_prefs where employee_id = v_me and key = p_key;
    return true;
  end if;
  insert into public.user_prefs (employee_id, key, value)
       values (v_me, p_key, p_value)
  on conflict (employee_id, key)
    do update set value = excluded.value, updated_at = now();
  return true;
end $$;

revoke all on function public.prefs_all() from public;
revoke all on function public.pref_set(text, jsonb) from public;
grant execute on function public.prefs_all() to authenticated;
grant execute on function public.pref_set(text, jsonb) to authenticated;
