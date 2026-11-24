/* รอบที่ 97 — ลบผู้สนใจที่ยังไม่มีเอกสารผูกอยู่
   หน้าเว็บมีปุ่มลบผู้สนใจอยู่แล้ว และกันไว้ว่าลบได้เฉพาะรายที่ยังไม่มี
   คำขอก่อนการขาย ใบเสนอราคา หรือดีล (leadDeleteBlock ใน crm-store.ts)
   รอบที่ 95 ไม่ได้เปิดสิทธิ์ลบไว้เลย ปุ่มนั้นจึงจะกดแล้วเงียบเมื่อต่อฐานข้อมูล
   ย้ายด่านเดียวกันลงมาไว้ที่ฐานข้อมูล แล้วค่อยเปิดสิทธิ์ลบตามนั้น

   ลบได้เฉพาะฝ่ายขายและหัวหน้า และลบได้เฉพาะรายที่ยังไม่มีเอกสารผูกอยู่จริง
   เอกสารที่ออกไปแล้วยังลบไม่ได้เหมือนเดิม */

create or replace function public.lead_has_docs(p_customer uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.presales_requests r where r.customer_id = p_customer)
      or exists (select 1 from public.quotations q      where q.customer_id = p_customer)
      or exists (select 1 from public.deals d           where d.customer_id = p_customer)
$$;

revoke all on function public.lead_has_docs(uuid) from public, anon;
grant execute on function public.lead_has_docs(uuid) to authenticated;

grant delete on public.customers            to authenticated;
grant delete on public.customer_activities  to authenticated;
grant delete on public.customer_changes     to authenticated;

drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers
  for delete to authenticated
  using (public.can_edit_sales() and not public.lead_has_docs(id));

/* บันทึกการติดต่อและประวัติของรายนั้นหายตามไปด้วย (on delete cascade)
   แต่ถ้าลบทีละรายการต้องเป็นรายที่ยังลบตัวลูกค้าได้อยู่เท่านั้น */
drop policy if exists customer_activities_delete on public.customer_activities;
create policy customer_activities_delete on public.customer_activities
  for delete to authenticated
  using (public.can_edit_sales() and not public.lead_has_docs(customer_id));

drop policy if exists customer_changes_delete on public.customer_changes;
create policy customer_changes_delete on public.customer_changes
  for delete to authenticated
  using (public.can_edit_sales() and not public.lead_has_docs(customer_id));
