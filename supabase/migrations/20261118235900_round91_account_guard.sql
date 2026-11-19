-- ─── FIX-2 ฝ่ายบุคคลให้สิทธิ์ CEO ไม่ได้ และแก้บัญชีของตัวเองไม่ได้ ───
-- /api/accounts ใช้กุญแจ service role แก้ user_accounts หลังตรวจแค่ว่าคนเรียกเป็น HR
-- เดิม HR เพิ่ม ceo ให้ตัวเองแล้วกดอนุมัติเงินเดือนแทน CEO ได้
-- ฟังก์ชันนี้รันด้วยสิทธิ์ของคนเรียก (ไม่ใช่ security definer) จึงรู้ว่าใครเรียกจริง
create or replace function public.can_set_account(p_employee text, p_roles text[] default null)
returns text
language plpgsql stable set search_path = '' as $$
declare
  v_target uuid;
  v_target_roles text[];
begin
  if not public.has_role('hr') then return 'not_hr'; end if;
  select e.id into v_target from public.employees e
   where e.id::text = p_employee or e.emp_no = p_employee;
  if v_target is null then return 'no_employee'; end if;
  if v_target = public.my_employee_id() then return 'own_account'; end if;
  select a.roles into v_target_roles from public.user_accounts a where a.employee_id = v_target;
  if not public.has_role('ceo')
     and ('ceo' = any (coalesce(p_roles, '{}')) or 'ceo' = any (coalesce(v_target_roles, '{}'))) then
    return 'ceo_only';
  end if;
  return null;
end $$;
grant execute on function public.can_set_account(text, text[]) to authenticated;
