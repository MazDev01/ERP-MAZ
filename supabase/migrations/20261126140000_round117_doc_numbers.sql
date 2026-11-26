/* รอบที่ 117 — รูปแบบเลขเอกสารตามที่บัญชียืนยัน (issue #1 · 25 พ.ย. 2569)

   ของเดิมทุกอย่างเป็น <คำนำหน้า>-<พ.ศ.>-<ลำดับ 4 หลัก> รีเซ็ตรายปี
   ของจริงที่บัญชีใช้อยู่เป็นแบบนี้

   1. ใบเสนอราคา  MAZ{YY}-{MM}{NNNN}   เช่น MAZ26-060041
      YY = ปี ค.ศ. สองหลักท้าย (ตามเอกสารจริงที่ส่งมา — ปี 2026 เขียน 26)
      ลำดับรีเซ็ตทุกเดือน · ใช้ชุดเดียวกันทุกผู้ออกเอกสาร (เมธา / ไอเมซเมกเกอร์ / ในนามบุคคล)
   2. ใบแจ้งหนี้   เลขเดียวกับใบเสนอราคา เปลี่ยนตัวอักษรหน้าเป็น INV
      เช่น MAZ26-060041 → INV26-060041 · ทุกงวดของดีลใช้เลขเดียวกัน
      จึงต้องเลิกบังคับว่าเลขใบแจ้งหนี้ห้ามซ้ำ (ยังห้ามซ้ำที่ "ดีล + งวด" เหมือนเดิม)
   3. ใบเสร็จ      {พ.ศ.}{เดือน}-{NNN}  เช่น 256907-002 · รีเซ็ตทุกเดือน

   ตัวอักษรหน้าของใบเสนอราคายังอ่านจากค่าตั้งค่าระบบได้ (docs.quotationMaz)
   ส่วนใบเสร็จไม่มีตัวอักษรหน้าในรูปแบบใหม่ ค่าตั้งค่าของใบเสร็จจึงไม่ถูกใช้แล้ว */

/* ─── ตัวช่วย: ลำดับรายเดือน ─────────────────────────────────────
   เก็บตัวนับใน doc_counters เหมือนของเดิม แต่คีย์เป็น <ชนิด>:<ปีเดือน>
   จึงรีเซ็ตเองทุกเดือนโดยไม่ต้องมีงานล้างค่า */
create or replace function public.next_month_no(p_key text, p_period text, p_year int)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_no int;
begin
  insert into public.doc_counters (prefix, year_be, last_no)
  values (p_key || ':' || p_period, p_year, 1)
  on conflict (prefix, year_be) do update set last_no = public.doc_counters.last_no + 1
  returning last_no into v_no;
  return v_no;
end $$;

revoke all on function public.next_month_no(text, text, int) from public, anon;
grant execute on function public.next_month_no(text, text, int) to authenticated;

/* ─── 1 ใบเสนอราคา ───────────────────────────────────────────────── */
create or replace function public.next_quotation_no()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_be    int  := extract(year from v_today)::int + 543;
  v_yy    text := lpad((extract(year from v_today)::int % 100)::text, 2, '0');
  v_mm    text := lpad(extract(month from v_today)::text, 2, '0');
  v_pre   text := coalesce(nullif(public.pay_settings() #>> array['docs', 'quotationMaz'], ''), 'MAZ');
  v_no    int;
begin
  /* ชุดเดียวกันทุกผู้ออกเอกสาร — ตัวนับไม่แยกตามคำนำหน้า */
  v_no := public.next_month_no('QUO', v_yy || v_mm, v_be);
  return v_pre || v_yy || '-' || v_mm || lpad(v_no::text, 4, '0');
end $$;

revoke all on function public.next_quotation_no() from public, anon;
grant execute on function public.next_quotation_no() to authenticated;

/* ออกเลขให้ตอนบันทึก ถ้าหน้าจอไม่ได้ส่งเลขมา — เลขจึงมาจากฐานข้อมูลเสมอ
   สองคนกดออกใบพร้อมกันจะได้ไม่ได้เลขซ้ำกัน */
create or replace function public.stamp_quotation_no() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.no is null or new.no = '' then new.no := public.next_quotation_no(); end if;
  return new;
end $$;

drop trigger if exists quotations_no on public.quotations;
create trigger quotations_no before insert on public.quotations
  for each row execute function public.stamp_quotation_no();

/* ─── 2 ใบแจ้งหนี้ = เลขใบเสนอราคา เปลี่ยนตัวอักษรหน้าเป็น INV ───
   ทุกงวดของดีลใช้เลขเดียวกัน จึงเลิกบังคับว่าเลขห้ามซ้ำ
   ความไม่ซ้ำที่จำเป็นคือ "ดีลเดียวกันห้ามมีงวดซ้ำ" ซึ่งมีอยู่แล้ว */
alter table public.invoices drop constraint if exists invoices_no_key;

create or replace function public.invoice_no_of(p_deal uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quo   text;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_yy    text := lpad((extract(year from v_today)::int % 100)::text, 2, '0');
  v_mm    text := lpad(extract(month from v_today)::text, 2, '0');
begin
  select q.no into v_quo
    from public.deals d
    join public.quotations q on q.id = d.quotation_id
   where d.id = p_deal;

  /* มีใบเสนอราคา: ตัดตัวอักษรหน้าออกแล้วใส่ INV แทน (MAZ26-060041 → INV26-060041) */
  if v_quo is not null then
    return 'INV' || regexp_replace(v_quo, '^[A-Za-z]+', '');
  end if;
  /*
   * ไม่มีใบเสนอราคา (ดีลที่ตั้งเอง): หยิบเลขจากตัวนับ "ชุดเดียวกับใบเสนอราคา"
   * ห้ามใช้ตัวนับแยก เพราะเลขจะไปซ้ำกับใบที่แปลงมาจากใบเสนอราคาของดีลอื่น
   * (เจอตอนทดสอบ 26 พ.ย. 2569 — ทั้งสองทางออกมาเป็น INV26-110001 เหมือนกัน)
   * ผลคือเลขใบเสนอราคาจะข้ามไปหนึ่งเลข ซึ่งยอมรับได้กว่าเลขเอกสารซ้ำ
   */
  return 'INV' || v_yy || '-' || v_mm ||
         lpad(public.next_month_no('QUO', v_yy || v_mm, extract(year from v_today)::int + 543)::text, 4, '0');
end $$;

revoke all on function public.invoice_no_of(uuid) from public, anon;
grant execute on function public.invoice_no_of(uuid) to authenticated;

/* เขียนทับตัวเดิมที่ออกเลขแบบรายปี — ชื่อฟังก์ชันและทริกเกอร์คงเดิม */
create or replace function public.stamp_invoice_no() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.no is null or new.no = '' then new.no := public.invoice_no_of(new.deal_id); end if;
  return new;
end $$;

/* ─── 3 ใบเสร็จ {พ.ศ.}{เดือน}-{NNN} ─────────────────────────────── */
create or replace function public.next_receipt_no()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_be    int  := extract(year from v_today)::int + 543;
  v_mm    text := lpad(extract(month from v_today)::text, 2, '0');
  v_no    int  := public.next_month_no('RCP', v_be::text || v_mm, v_be);
begin
  return v_be::text || v_mm || '-' || lpad(v_no::text, 3, '0');
end $$;

revoke all on function public.next_receipt_no() from public, anon;
grant execute on function public.next_receipt_no() to authenticated;

create or replace function public.stamp_receipt_no() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.no is null or new.no = '' then new.no := public.next_receipt_no(); end if;
  return new;
end $$;
