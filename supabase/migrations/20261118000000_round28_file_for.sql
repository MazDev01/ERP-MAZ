-- ─── ฝ่ายบุคคลยื่นใบแทนคนที่ยังไม่มีบัญชีเข้าระบบได้ ──────────────
/*
 * เดิมกรอกแทนได้เฉพาะ PM กับ GM แต่คนที่ยังไม่มีบัญชี (เด็กฝึกงาน ช่างหน้างาน)
 * ส่งใบลาเป็นกระดาษเข้าฝ่ายบุคคลโดยตรง ไม่ได้ผ่านหัวหน้าโครงการ
 * ถ้าฝ่ายบุคคลกรอกเข้าระบบไม่ได้ ใบพวกนี้ก็ไม่เคยเข้าสายอนุมัติและไม่เข้าเงินเดือน
 *
 * กติกาเดิมยังอยู่ครบ — กรอกแทนได้เฉพาะคนที่ "ยังไม่มีบัญชีเข้าระบบ" เท่านั้น
 * คนที่ล็อกอินเองได้ต้องยื่นเอง ไม่งั้นมีใบในชื่อเขาโดยเจ้าตัวไม่รู้
 */
create or replace function public.can_file_for(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    p_employee = public.my_employee_id()
    or (
      (public.has_role('pm') or public.has_role('gm') or public.has_role('hr'))
      and not exists (select 1 from public.user_accounts a where a.employee_id = p_employee)
    )
$$;
