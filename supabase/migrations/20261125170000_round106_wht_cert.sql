/* รอบที่ 106 — หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)
   ยกของจากสาย ERP_Test ที่ทำค้างไว้ตั้งแต่ 9–16 ต.ค. 2569 มาต่อกับฐานข้อมูล

   ตารางเดิม (รอบที่ 99) เก็บแค่รายการที่ต้องนำส่ง — ใครรับเงิน เท่าไร อัตราเท่าไร
   แต่ "หนังสือรับรอง" เป็นเอกสารที่ต้องออกให้ผู้ให้บริการถือไว้ยื่นภาษีของเขา
   จึงต้องมีเลขที่ของตัวเอง วันที่ออก ที่อยู่ผู้ถูกหัก และเงื่อนไขการออก (มาตรา 50 ทวิ)

   เลขที่หนังสือรับรองเป็นคนละชุดกับเอกสารอื่น — รูปแบบ MAZ-WHT-<พ.ศ.>-0001
   เดินเลขต่อกันทั้งปี ออกแล้วแก้เนื้อหาได้แต่เลขเดิมคงไว้ */

alter table public.wht_rows
  /* เลขที่หนังสือรับรอง — ว่าง = ยังไม่ได้ออก */
  add column if not exists no        text not null default '',
  /* ประเภทผู้ถูกหักภาษี ตรงกับ kind เสมอ (53 = นิติบุคคล · 3 = บุคคลธรรมดา) */
  add column if not exists payee_type text not null default 'juristic'
      check (payee_type in ('juristic', 'individual')),
  add column if not exists addr      text not null default '',
  /* ผู้จ่ายเงิน — 1 หัก ณ ที่จ่าย · 2 ออกให้ตลอดไป · 3 ออกให้ครั้งเดียว · 4 อื่น ๆ */
  add column if not exists cond      int,
  add column if not exists cond_note text not null default '',
  /* วันที่ออกหนังสือรับรอง — รายการเก่าที่ไม่มีใช้วันที่จ่าย */
  add column if not exists issued    date,
  /* เงินที่จ่ายเข้า กบข./กสจ. · ประกันสังคม · กองทุนสำรองเลี้ยงชีพ */
  add column if not exists gpf       numeric not null default 0 check (gpf >= 0),
  add column if not exists sso       numeric not null default 0 check (sso >= 0),
  add column if not exists pvd       numeric not null default 0 check (pvd >= 0);

/* เลขที่ต้องไม่ซ้ำ — ว่างได้หลายแถว (ยังไม่ได้ออก) */
create unique index if not exists wht_rows_no_idx on public.wht_rows (no) where no <> '';

/* ออกเลขหนังสือรับรอง — เดินต่อกันทั้งปี พ.ศ. ตามวันที่ออก
   ให้ฐานข้อมูลเป็นคนออกเลข สองเครื่องกดพร้อมกันจะได้ไม่ซ้ำกัน */
create or replace function public.next_wht_no(p_issued date default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_issued, (now() at time zone 'Asia/Bangkok')::date);
  v_be  int  := extract(year from v_day)::int + 543;
  v_head text := 'MAZ-WHT-' || v_be || '-';
  v_seed int;
  v_no   int;
begin
  select coalesce(max(nullif(regexp_replace(w.no, '^' || v_head, ''), w.no)::int), 0)
    into v_seed
    from public.wht_rows w
   where w.no like v_head || '%';

  insert into public.doc_counters (prefix, year_be, last_no)
  values ('WHTCERT', v_be, greatest(v_seed + 1, 1))
  on conflict (prefix, year_be)
    do update set last_no = greatest(public.doc_counters.last_no + 1, v_seed + 1)
  returning last_no into v_no;

  return v_head || lpad(v_no::text, 4, '0');
end $$;

revoke all on function public.next_wht_no(date) from public, anon;
grant execute on function public.next_wht_no(date) to authenticated;
