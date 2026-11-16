-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ รอบที่ 13 — บทบาทต้องใช้ได้แม้บัญชีจะไม่ใช่พนักงาน                 ║
-- ╚══════════════════════════════════════════════════════════════════╝
/*
 * has_role() เขียนไว้ตั้งแต่รอบแรก โดยบังคับว่าบัญชีต้องผูกกับแถวในทะเบียนพนักงาน
 * พอแยกบัญชีออกจากทะเบียน (รอบที่ 10) ผู้บริหารซึ่งไม่มีแถวในทะเบียนจึงตกทุกด่าน
 * ที่ใช้ has_role — เปิดหน้า "ยอดเงินเดือนรออนุมัติ" แล้วไม่เห็นอะไรเลย
 * ทั้งที่ฝ่ายบุคคลส่งยอดมาแล้ว (เจอตอนทดสอบสายเงินเดือน 16 พ.ย. 2569)
 *
 * แก้ให้ไม่ต้องมีแถวในทะเบียน แต่ยังเข้มเท่าเดิมในเรื่องที่สำคัญ
 *   บัญชีต้องยังใช้งานได้ (ไม่ถูกระงับ)
 *   ถ้าผูกกับพนักงาน พนักงานคนนั้นต้องยังไม่พ้นสภาพ
 */
create or replace function public.has_role(r text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.user_accounts a
      left join public.employees e on e.id = a.employee_id
     where a.user_id = auth.uid()
       and a.status = 'active'
       and (a.employee_id is null or e.status = 'active')
       and r = any (a.roles)
  )
$$;

/* บทบาททั้งหมดของคนที่ล็อกอิน — บัญชีที่ถูกระงับต้องไม่เหลือบทบาทไว้ใช้ */
create or replace function public.my_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(roles, '{}')
    from public.user_accounts
   where user_id = auth.uid() and status = 'active'
$$;
