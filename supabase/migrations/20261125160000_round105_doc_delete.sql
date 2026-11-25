/* รอบที่ 105 — ลบเอกสารแนบของโปรเจคได้
   หน้าเว็บมีปุ่มลบเอกสารอยู่แล้ว (removeProjectDoc) รอบที่ 102 ไม่ได้เปิดสิทธิ์ลบไว้
   ปุ่มนั้นจึงจะกดแล้วเงียบเมื่อต่อฐานข้อมูล — แบบเดียวกับที่เจอมาแล้วสองครั้ง
   เอกสารแนบไม่ใช่เอกสารการเงิน แนบผิดไฟล์แล้วต้องเอาออกได้

   ลบได้เฉพาะผู้จัดการโครงการกับหัวหน้า เหมือนสิทธิ์แนบ */

grant delete on public.project_docs to authenticated;

drop policy if exists project_docs_delete on public.project_docs;
create policy project_docs_delete on public.project_docs
  for delete to authenticated
  using (public.can_edit_pm());
