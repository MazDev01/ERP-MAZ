-- ─── ตัวนำหน้าเลขที่เอกสารมาจากค่าตั้งค่า ──────────────────────────
/*
 * เลขใบลา/โอที/ใบเบิกออกโดยทริกเกอร์ในฐานข้อมูล ซึ่งเดิมเขียน 'LV' 'OT' 'EX' ไว้ตรง ๆ
 * ผู้ดูแลเปลี่ยนตัวนำหน้าที่หน้า "เลขที่เอกสาร" แล้วจึงไม่มีผลกับสามใบนี้เลย
 * — โรคเดียวกับจุดลงเวลาและวันหยุด คือหน้าจอตั้งค่าไว้ที่หนึ่ง ระบบอ่านอีกที่หนึ่ง
 *
 * ตรงนี้ให้ทริกเกอร์อ่านจากก้อนค่าตั้งค่า (system_settings.data -> 'docs') แทน
 * ยังไม่ได้ตั้ง หรือตั้งเป็นค่าว่าง ก็ใช้ตัวเดิมเป็นค่าสำรอง เลขจะได้ไม่ขาดสาย
 *
 * หมายเหตุ: เปลี่ยนตัวนำหน้าแล้วเลขเริ่มนับหนึ่งใหม่ของตัวนำหน้านั้น (doc_counters
 * นับแยกตามตัวนำหน้า+ปี) ใบเก่ายังถือเลขเดิมไว้ ไม่ถูกแก้ย้อนหลัง
 */

create or replace function public.doc_prefix(p_key text, p_fallback text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    nullif(trim((select data from public.system_settings where id) #>> array['docs', p_key]), ''),
    p_fallback
  );
$$;

grant execute on function public.doc_prefix(text, text) to authenticated;

create or replace function public.stamp_leave_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.no is null or new.no = '' then
    new.no := public.next_doc_no(public.doc_prefix('leave', 'LV'));
  end if;
  return new;
end $$;

create or replace function public.stamp_ot_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.no is null or new.no = '' then
    new.no := public.next_doc_no(public.doc_prefix('ot', 'OT'));
  end if;
  return new;
end $$;

create or replace function public.stamp_claim_no() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' and (new.no is null or new.no = '') then
    new.no := public.next_doc_no(public.doc_prefix('expense', 'EX'));
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  return new;
end $$;
