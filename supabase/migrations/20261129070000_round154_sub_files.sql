/*
 * รอบที่ 154 — ไฟล์ที่พนักงานส่งงาน ต้องเปิดได้จริงจากหน้าตรวจงาน
 *
 * ของเดิมไฟล์อยู่ใน IndexedDB ของเครื่องคนส่ง คนตรวจเห็นแต่ชื่อ กดเปิดไม่ได้
 * หน้าจอรอบนี้ส่งไฟล์ขึ้นถัง "docs" ใต้ project/<รหัสโปรเจค>/ แล้วเก็บที่อยู่ไว้ในรอบที่ส่ง
 *
 * แต่พอทดสอบบนหน้าจอจริง พนักงานอัปไม่ผ่าน: "new row violates row-level security policy"
 * เพราะ can_see_project() เทียบ my_employee_id() (uuid) กับ project_tasks.whos
 * ซึ่งเก็บ "รหัสพนักงาน" (E05) ไม่ใช่ uuid — เงื่อนไขนี้จึงไม่เคยจริงสำหรับคนทำงาน
 * ตัวเทียบที่ถูกต้องมีอยู่แล้วคือ owns_task() (ใช้ในนโยบายของ project_tasks)
 *
 * แก้จุดเดียวนี้ทำให้คนถืองานทั้งอัปไฟล์ อ่านไฟล์ และลงทะเบียนไฟล์แนบของโปรเจคได้
 * (นโยบาย docs_insert · docs_read · att_insert · att_read เรียก can_see_project ทั้งหมด)
 */

create or replace function public.can_see_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.projects p where p.id = p_project)
     and (public.has_role('pm') or public.has_role('gm') or public.has_role('ceo')
          or exists (
            select 1 from public.project_tasks t
             where t.project_id = p_project
               and public.owns_task(t.whos)))
$$;
