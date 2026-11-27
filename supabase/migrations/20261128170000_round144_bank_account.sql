/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 144 · บัญชีธนาคารของพนักงาน — สำหรับใบสรุปเงินเดือนที่ใช้โอนเงิน
   (ยกมาจาก ERP_Test · เจ้าของสั่ง 16 ต.ค. 2569)

   ผู้บริหารใช้ตารางสรุปเงินเดือนของรอบนั้นโอนเงินเข้าบัญชีพนักงานทีเดียวทั้งทีม
   ตารางจึงต้องมีธนาคารและเลขบัญชีอยู่ในแถวเดียวกับยอดสุทธิ

   เลขบัญชีเป็นข้อมูลส่วนตัว — เปิดให้เห็นเท่าที่จำเป็น
     ฝ่ายบุคคล   แก้ได้ (เป็นคนกรอกตอนรับเข้า)
     ผู้บริหาร   อ่านได้ (เป็นคนโอน)
     เจ้าของบัญชี อ่านของตัวเองได้ จะได้ตรวจว่ากรอกถูก
     บทบาทอื่น   ไม่เห็นเลย (รวมถึงผู้จัดการทั่วไป ซึ่งไม่ยุ่งกับเงิน)
   ═══════════════════════════════════════════════════════════════════ */

alter table public.employees
  add column if not exists bank_name text not null default '',
  add column if not exists bank_no   text not null default '';

comment on column public.employees.bank_no is
  'เลขบัญชีรับเงินเดือน — ฝ่ายบุคคลกรอก ผู้บริหารใช้โอน เจ้าของบัญชีดูของตัวเองได้';

/* เลขบัญชีกรอกได้เฉพาะตัวเลขและขีด กันพิมพ์ชื่อคนลงช่องเลขบัญชี */
create or replace function public.bank_no_fit() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.bank_no := trim(coalesce(new.bank_no, ''));
  if new.bank_no <> '' and new.bank_no !~ '^[0-9][0-9 -]{6,24}[0-9]$' then
    raise exception 'เลขบัญชีต้องเป็นตัวเลข (คั่นด้วยขีดหรือเว้นวรรคได้)' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists employees_bank_no on public.employees;
create trigger employees_bank_no before insert or update on public.employees
  for each row execute function public.bank_no_fit();

/*
 * รอบที่ 119 ถอนสิทธิ์อ่านทั้งตารางของบางตารางแล้วคืนทีละช่อง — employees ไม่ได้อยู่ในชุดนั้น
 * แต่ช่องเลขบัญชีอ่อนไหวกว่าช่องอื่น จึงคืนผ่านฟังก์ชันแทนการเปิดทั้งช่องให้ทุกคน
 */
/* สิทธิ์ระดับตารางกลบสิทธิ์ระดับช่อง — ถอนทั้งตารางก่อน แล้วคืนให้ทีละช่องยกเว้นสองช่องนี้
   (บทเรียนเดียวกับรอบที่ 119) เพิ่มช่องใหม่ในตารางนี้ภายหลัง ต้อง grant ช่องนั้นด้วย */
do $$
declare
  v_c text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_c
    from information_schema.columns
   where table_schema = 'public' and table_name = 'employees'
     and column_name not in ('bank_name', 'bank_no');
  execute 'revoke select on public.employees from authenticated, anon';
  execute format('grant select (%s) on public.employees to authenticated', v_c);
end $$;

/*
 * บัญชีรับเงินเดือนของพนักงานที่ขอดูได้ — คนอื่นได้ค่าว่าง
 * อ้างคนด้วย "รหัสพนักงาน" (emp_no) แบบเดียวกับที่หน้าเว็บใช้ทั้งระบบ
 * (หน้าเว็บเก็บ Employee.id = emp_no ไม่ใช่ uuid ของแถว — เจอตอนทดสอบรอบที่ 144)
 */
drop function if exists public.bank_of(uuid);
create or replace function public.bank_of(p_emp text)
  returns table (bank_name text, bank_no text)
language sql stable security definer set search_path = ''
as $$
  select e.bank_name, e.bank_no
    from public.employees e
   where e.emp_no = p_emp
     and (public.has_role('hr') or public.has_role('ceo') or e.id = public.my_employee_id())
$$;

grant execute on function public.bank_of(text) to authenticated;

/** บัญชีของทุกคนในรอบโอน — ใช้กับใบสรุปเงินเดือน (ฝ่ายบุคคลกับผู้บริหารเท่านั้น) */
drop function if exists public.bank_list();
create or replace function public.bank_list()
  returns table (emp_no text, bank_name text, bank_no text)
language sql stable security definer set search_path = ''
as $$
  select e.emp_no, e.bank_name, e.bank_no
    from public.employees e
   where public.has_role('hr') or public.has_role('ceo')
$$;

grant execute on function public.bank_list() to authenticated;

/** ฝ่ายบุคคลบันทึกบัญชีให้พนักงาน — ที่เดียวที่เขียนช่องนี้ได้ */
drop function if exists public.bank_set(uuid, text, text);
create or replace function public.bank_set(p_emp text, p_name text, p_no text)
  returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.has_role('hr') then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  update public.employees
     set bank_name = trim(coalesce(p_name, '')), bank_no = trim(coalesce(p_no, ''))
   where emp_no = p_emp;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.bank_set(text, text, text) to authenticated;

notify pgrst, 'reload schema';
