-- ─── ไฟล์แนบเปิดได้จริง และใบที่ยื่นแล้วแก้ไม่ได้ ────────────────
/*
 * สามเรื่องในไฟล์เดียว เพราะเป็นช่องโหว่ชุดเดียวกัน (ผลตรวจ 17 พ.ย. 2569)
 *
 * 1 ไฟล์แนบเปิดไม่ได้เลยสักคน
 *   นโยบายเดิมเขียน a.path = name ซึ่ง name ไปจับคอลัมน์ attachments.name
 *   (ชื่อไฟล์ที่ผู้ใช้เห็น) ไม่ใช่ storage.objects.name (ที่อยู่ไฟล์ในถัง)
 *   เงื่อนไขจึงแทบไม่มีทางเป็นจริง — เจ้าของไฟล์เองก็ขอลิงก์เปิดไม่ได้
 *   และนโยบายอัปโหลดเดิมเช็กแค่ชื่อถัง ใครก็วางไฟล์ทับที่ไหนก็ได้
 *
 * 2 ทริกเกอร์กันสายอนุมัติปลอม (guard_leave_request/guard_ot_request/route_of)
 *   มีอยู่บนฐานข้อมูลจริงแต่ไม่เคยอยู่ในไฟล์ migration — ฐานข้อมูลที่สร้างใหม่
 *   จะไม่มี และผู้ยื่นจะเลือกผู้อนุมัติเองได้ เก็บเข้าไฟล์เสียให้ตรงกัน
 *
 * 3 ใบที่ยื่นแล้วเจ้าตัวยังแก้ได้ (เจ้าของตัดสิน 17 พ.ย. 2569 ว่าแก้ไม่ได้
 *   ให้ยกเลิกแล้วยื่นใหม่) ของเดิมแก้วันลาจาก 1 เป็น 5 วันได้ ซึ่งข้ามการตรวจ
 *   สิทธิ์วันลาที่ file_leave ทำไว้ และเปลี่ยนผู้อนุมัติหลังยื่นได้ด้วย
 */

-- ── 1 ไฟล์แนบ ────────────────────────────────────────────────────
/* ใครมีสิทธิ์เห็นเอกสารเจ้าของไฟล์นี้ — ใช้ทั้งตอนอ่านและตอนอัปโหลด */
create or replace function public.can_see_doc(p_kind text, p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'leave' then exists (
      select 1 from public.leave_requests r
       where r.id = p_owner
         and (r.employee_id = public.my_employee_id()
              or r.approver_role = any (public.my_roles())
              or public.has_role('hr')))
    when 'ot' then exists (
      select 1 from public.ot_requests r
       where r.id = p_owner
         and (r.employee_id = public.my_employee_id()
              or r.approver_role = any (public.my_roles())
              or public.has_role('hr')))
    when 'expense' then exists (
      select 1 from public.expense_claims c
       where c.id = p_owner
         and (c.employee_id = public.my_employee_id()
              or c.approver_role = any (public.my_roles())
              or public.has_role('hr')))
    when 'employee' then p_owner = public.my_employee_id() or public.has_role('hr')
    when 'payroll' then public.has_role('hr') or public.has_role('ceo')
    else false
  end;
$$;

grant execute on function public.can_see_doc(text, uuid) to authenticated;

/* ที่อยู่ไฟล์เป็น <ชนิด>/<รหัสเอกสาร>/<เวลา>-<ชื่อไฟล์> — อ่านรหัสออกมาแบบไม่พัง */
create or replace function public.doc_owner_of(p_path text) returns uuid
language plpgsql immutable set search_path = '' as $$
declare
  v text := split_part(p_path, '/', 2);
begin
  return v::uuid;
exception when others then
  return null;
end $$;

grant execute on function public.doc_owner_of(text) to authenticated;

drop policy if exists docs_read on storage.objects;
create policy docs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'docs'
    and exists (
      select 1 from public.attachments a
       where a.path = storage.objects.name
         and (a.uploaded_by = public.my_employee_id()
              or public.has_role('hr')
              or public.can_see_doc(a.owner_kind, a.owner_id))
    )
  );

/* อัปโหลดได้เฉพาะเข้าเอกสารที่ตัวเองมีสิทธิ์เห็น และชนิดต้องเป็นที่รู้จัก */
drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'docs'
    and split_part(name, '/', 1) in ('leave', 'ot', 'expense', 'employee', 'payroll')
    and public.doc_owner_of(name) is not null
    and public.can_see_doc(split_part(name, '/', 1), public.doc_owner_of(name))
  );

drop policy if exists docs_delete on storage.objects;
create policy docs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'docs'
    and exists (
      select 1 from public.attachments a
       where a.path = storage.objects.name
         and (a.uploaded_by = public.my_employee_id() or public.has_role('hr'))
    )
  );

-- ── 2 สายอนุมัติมาจากฐานข้อมูลเสมอ ───────────────────────────────
/* ฟังก์ชันและทริกเกอร์ชุดนี้มีอยู่บนฐานข้อมูลจริงแล้ว เขียนซ้ำให้ไฟล์ตรงกับของจริง */
create or replace function public.route_of(p_kind text, p_employee uuid) returns text
language sql stable security definer set search_path = '' as $$
  select r.approver_role
    from public.employees e
    join public.approval_routes r on r.kind = p_kind and r.from_role = e.position
   where e.id = p_employee
$$;

grant execute on function public.route_of(text, uuid) to authenticated;

-- ── 3 ใบที่ยื่นแล้วแก้เนื้อหาไม่ได้ ──────────────────────────────
/*
 * ยกเลิกได้ ตัดสินได้ (ฟังก์ชัน decide_request) แต่แก้เนื้อหาไม่ได้
 * ช่องที่ห้ามขยับคือช่องที่เปลี่ยนความหมายของใบหรือเปลี่ยนว่าใครเป็นคนอนุมัติ
 */
create or replace function public.lock_leave_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.employee_id is distinct from old.employee_id
     or new.leave_type is distinct from old.leave_type
     or new.from_date is distinct from old.from_date
     or new.to_date is distinct from old.to_date
     or new.days is distinct from old.days
     or new.half is distinct from old.half
     or new.start_min is distinct from old.start_min
     or new.end_min is distinct from old.end_min
     or new.hours is distinct from old.hours
     or new.approver_role is distinct from old.approver_role
     or new.no is distinct from old.no then
    raise exception 'locked' using errcode = 'P0001',
      hint = 'ใบลาที่ยื่นแล้วแก้ไม่ได้ — ยกเลิกแล้วยื่นใหม่';
  end if;
  return new;
end $$;

create or replace function public.lock_ot_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.employee_id is distinct from old.employee_id
     or new.work_date is distinct from old.work_date
     or new.start_min is distinct from old.start_min
     or new.end_min is distinct from old.end_min
     or new.hours is distinct from old.hours
     or new.approver_role is distinct from old.approver_role
     or new.no is distinct from old.no then
    raise exception 'locked' using errcode = 'P0001',
      hint = 'ใบขอโอทีที่ยื่นแล้วแก้ไม่ได้ — ยกเลิกแล้วยื่นใหม่';
  end if;
  return new;
end $$;

drop trigger if exists leave_lock_edit on public.leave_requests;
create trigger leave_lock_edit before update on public.leave_requests
  for each row execute function public.lock_leave_edit();

drop trigger if exists ot_lock_edit on public.ot_requests;
create trigger ot_lock_edit before update on public.ot_requests
  for each row execute function public.lock_ot_edit();
