/* รอบที่ 101 — ให้ฝ่ายบัญชีออกใบเสนอราคาได้ (เจอตอนไล่ทดสอบ 25 พ.ย. 2569)

   รอบที่ 95 ตั้งไว้ว่าใบเสนอราคาเขียนได้เฉพาะฝ่ายขายกับหัวหน้า
   แต่หน้าเว็บของฝ่ายบัญชีมีทั้งปุ่ม "สร้างใบเสนอราคา" และ "ออกใบใหม่แทนใบนี้" มาตั้งแต่ต้น
   พอต่อฐานข้อมูลแล้วกดจริงจึงได้ 403 โดยหน้าจอไม่ขึ้นอะไรเลย

   รอบนี้เปิดให้บทบาทบัญชีเขียนใบเสนอราคาและประวัติการแก้ไขได้
   ส่วนผู้สนใจ/ลูกค้า คำขอก่อนการขาย ดีล และใบงาน ยังเป็นของฝ่ายขายเหมือนเดิม */

create or replace function public.can_write_quotation() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_edit_sales() or public.has_role('acc')
$$;

revoke all on function public.can_write_quotation() from public, anon;
grant execute on function public.can_write_quotation() to authenticated;

drop policy if exists quotations_write  on public.quotations;
drop policy if exists quotations_change on public.quotations;
create policy quotations_write on public.quotations
  for insert to authenticated with check (public.can_write_quotation());
create policy quotations_change on public.quotations
  for update to authenticated
  using (public.can_write_quotation()) with check (public.can_write_quotation());

drop policy if exists quotation_revisions_write  on public.quotation_revisions;
drop policy if exists quotation_revisions_change on public.quotation_revisions;
create policy quotation_revisions_write on public.quotation_revisions
  for insert to authenticated with check (public.can_write_quotation());
create policy quotation_revisions_change on public.quotation_revisions
  for update to authenticated
  using (public.can_write_quotation()) with check (public.can_write_quotation());
