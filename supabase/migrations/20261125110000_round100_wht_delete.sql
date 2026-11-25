/* รอบที่ 100 — ลบรายการภาษีหัก ณ ที่จ่ายที่กรอกผิดได้
   ตารางนี้เป็นรายการงานของฝ่ายบัญชีไว้ทำ ภ.ง.ด.53/3 ประจำเดือน ยังไม่ใช่เอกสารที่ส่งออกไป
   หน้าเว็บมีปุ่มลบอยู่แล้ว (removeWht ใน acc-store.ts) รอบที่ 99 ไม่ได้เปิดสิทธิ์ลบไว้
   ปุ่มนั้นจึงจะกดแล้วเงียบเมื่อต่อฐานข้อมูล

   ลบได้เฉพาะฝ่ายบัญชีกับผู้บริหาร เหมือนสิทธิ์เขียนของตารางนี้ */

grant delete on public.wht_rows to authenticated;

drop policy if exists wht_rows_delete on public.wht_rows;
create policy wht_rows_delete on public.wht_rows
  for delete to authenticated
  using (public.can_edit_acc());
