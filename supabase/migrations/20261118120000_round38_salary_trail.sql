-- ─── ประวัติเงินเดือนต้องรู้ว่าใครแก้ และลบทิ้งไม่ได้ ────────────
/*
 * salary_steps คือประวัติค่าจ้างของพนักงาน (ขั้นละแถว มีวันที่มีผล)
 * เป็นตัวตั้งต้นของเงินเดือนทุกเดือน จึงเป็นข้อมูลที่ต้องตรวจย้อนหลังได้
 *
 * ไล่ตรวจ backend 18 พ.ย. 2569 พบสองช่อง
 *   1) ช่อง created_by ว่างทุกแถว เพราะหน้าจอไม่ได้ส่งมา — ไม่รู้ว่าใครขึ้นเงินเดือนให้ใคร
 *   2) นโยบายให้ฝ่ายบุคคลทำได้ทุกอย่าง (ALL) จึงลบประวัติทิ้งได้ ร่องรอยหายทั้งแถว
 *
 * แก้เป็น: ฐานข้อมูลเติมชื่อคนทำเอง และประวัติเพิ่มได้อย่างเดียว
 * กรอกผิดให้บันทึกขั้นใหม่ทับ ไม่ใช่ลบของเก่า (กติกาเดียวกับใบลาที่ยกเลิกแล้วยังอยู่)
 * การแก้ตำแหน่ง/สถานะพนักงานก็บันทึกลงสมุดบันทึกกลางด้วย
 */
alter table public.salary_steps alter column created_by set default auth.uid();

drop policy if exists salary_write on public.salary_steps;
create policy salary_insert on public.salary_steps for insert to authenticated
  with check (public.has_role('hr'));
/* ไม่มีนโยบาย update/delete = ลบหรือแก้ประวัติไม่ได้เลย แม้แต่ฝ่ายบุคคล */

/* ใครแก้ตำแหน่ง สถานะ หรือประเภทการจ้างของพนักงาน ต้องมีร่องรอย */
create or replace function public.log_employee_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.position is distinct from old.position
     or new.status is distinct from old.status
     or new.emp_type is distinct from old.emp_type
     or new.left_at is distinct from old.left_at then
    insert into public.audit_log (actor, action, target, detail)
    values (auth.uid(), 'employee_change', new.id,
            jsonb_build_object(
              'position', case when new.position is distinct from old.position
                               then jsonb_build_object('from', old.position, 'to', new.position) end,
              'status', case when new.status is distinct from old.status
                             then jsonb_build_object('from', old.status, 'to', new.status) end,
              'emp_type', case when new.emp_type is distinct from old.emp_type
                               then jsonb_build_object('from', old.emp_type, 'to', new.emp_type) end,
              'left_at', case when new.left_at is distinct from old.left_at
                              then jsonb_build_object('from', old.left_at, 'to', new.left_at) end));
  end if;
  return new;
end $$;

revoke all on function public.log_employee_change() from public, anon, authenticated;

drop trigger if exists employees_change_log on public.employees;
create trigger employees_change_log after update on public.employees
  for each row execute function public.log_employee_change();
