-- ─── ผู้บริหารอ่านทะเบียนพนักงานได้ ───────────────────────────────
/*
 * CEO เป็นคนอนุมัติยอดเงินเดือนของทุกคน (HR-BR-02) แต่กติกาเดิมให้เห็นทะเบียนพนักงาน
 * เฉพาะคนที่ "ใบของตำแหน่งนั้นวิ่งมาหาตัวเอง" — พอสายอนุมัติเปลี่ยน (รอบที่ 15)
 * CEO ก็เห็นพนักงานเหลือ 3 จาก 6 คน หน้ายอดเงินเดือนรออนุมัติจึงรวมได้ไม่ครบ
 * และแสดงยอดผิดโดยไม่มีอะไรเตือน (เจอตอนทดสอบ 16 พ.ย. 2569)
 *
 * ผู้บริหารจึงอ่านทะเบียนได้ทั้งหมด — อ่านอย่างเดียว แก้ยังเป็นของฝ่ายบุคคลเหมือนเดิม
 * (เงินเดือนรายคนอยู่คนละตาราง salary_steps ซึ่งมีนโยบายของตัวเอง)
 */
drop policy if exists employees_read on public.employees;

create policy employees_read on public.employees for select to authenticated
  using (
    id = public.my_employee_id()
    or public.has_role('hr')
    or public.has_role('ceo')
    or boss_id = public.my_employee_id()
    or exists (
      select 1 from public.approval_routes r
       where r.from_role = public.employees.position
         and r.approver_role = any (public.my_roles())
    )
  );
