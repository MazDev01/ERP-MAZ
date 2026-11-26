/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 133 · วันที่ผู้สนใจถูกปฏิเสธ (ยกมาจาก ERP_Test)

   Pipeline ของฝ่ายขายเอารายที่ปฏิเสธออกจากกระดานเมื่อครบหนึ่งเดือน
   (ยังดูได้ในแท็บปฏิเสธของหน้าผู้สนใจ) จึงต้องรู้ว่าปฏิเสธวันไหน
   ═══════════════════════════════════════════════════════════════════ */

alter table public.customers
  add column if not exists rejected_at date;

comment on column public.customers.rejected_at is 'วันที่เปลี่ยนเป็นปฏิเสธ — Pipeline เอาออกจากกระดานเมื่อครบหนึ่งเดือน';

/* ลงวันให้เองตอนสถานะเปลี่ยนเป็นปฏิเสธ · กลับมาเป็นอย่างอื่นก็ล้างทิ้ง */
create or replace function public.customer_rejected_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'ปฏิเสธ' and coalesce(old.status, '') <> 'ปฏิเสธ' then
    new.rejected_at := (now() at time zone 'Asia/Bangkok')::date;
  elsif new.status <> 'ปฏิเสธ' then
    new.rejected_at := null;
  end if;
  return new;
end $$;

drop trigger if exists customers_rejected_at on public.customers;
create trigger customers_rejected_at before insert or update of status on public.customers
  for each row execute function public.customer_rejected_at();

/* ของเดิมที่ปฏิเสธไปแล้ว — เอาวันจากประวัติการเปลี่ยนสถานะ ไม่มีก็ใช้วันที่สร้าง */
update public.customers c
   set rejected_at = coalesce(
         (select max(ch.at::date) from public.customer_changes ch
           where ch.customer_id = c.id and ch.kind = 'status' and ch.to_value = 'ปฏิเสธ'),
         c.created_at::date)
 where c.status = 'ปฏิเสธ' and c.rejected_at is null;

notify pgrst, 'reload schema';
