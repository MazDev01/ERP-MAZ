/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 120 · เกณฑ์ขั้นต่ำของภาษีหัก ณ ที่จ่าย (คำตอบฝ่ายบัญชี 25 พ.ย. 2569)

   - ยอดจ่ายต่อครั้งต่ำกว่าเกณฑ์ ไม่ต้องหักภาษี ณ ที่จ่าย
     ทั่วไป 1,000 บาท · ผู้จ่ายเป็นส่วนราชการ หักตั้งแต่ 500 บาท
   - เกณฑ์เก็บเป็นค่าตั้งค่า (rates.whtMinBase / rates.whtMinBaseGov)
     เพราะกรมสรรพากรปรับได้ ห้ามเขียนเป็นค่าคงที่
   - ค่าสินค้าไม่อยู่ในข่ายหัก — ประเภทเงินได้ใหม่ "goods" อัตรา 0%
     (รายการประเภทอยู่ในค่าตั้งค่า ฝั่งหน้าเว็บเติมให้เองจากชุดตั้งต้น)
   ═══════════════════════════════════════════════════════════════════ */

/** เกณฑ์ขั้นต่ำที่ต้องหักภาษี — อ่านจากค่าตั้งค่า ไม่ใช่ค่าคงที่ */
create or replace function public.wht_min_base(p_gov boolean default false)
  returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when p_gov then (s.data -> 'rates' ->> 'whtMinBaseGov')::numeric
                 else (s.data -> 'rates' ->> 'whtMinBase')::numeric end
       from public.system_settings s order by s.updated_at desc limit 1),
    case when p_gov then 500 else 1000 end)
$$;

grant execute on function public.wht_min_base(boolean) to authenticated;

/* ── ฝั่งจ่าย · ใบหัก ณ ที่จ่ายที่บริษัทออกให้ผู้รับเงิน ───────────
   ยอดต่ำกว่าเกณฑ์ ล้างอัตราเป็นศูนย์ให้เอง จะได้ไม่นำส่งเกินที่กฎหมายกำหนด
   (บริษัทไม่ใช่ส่วนราชการ จึงใช้เกณฑ์ทั่วไป) */
create or replace function public.wht_floor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.base, 0) < public.wht_min_base(false) then
    new.rate := 0;
  end if;
  return new;
end $$;

drop trigger if exists wht_rows_floor on public.wht_rows;
create trigger wht_rows_floor before insert or update of base, rate on public.wht_rows
  for each row execute function public.wht_floor();

/* ── ฝั่งรับ · ใบเสนอราคา ─────────────────────────────────────────
   ยอดหลังหักส่วนลดต่ำกว่าเกณฑ์ ลูกค้าไม่ต้องหักภาษีจากเรา
   ลูกค้าที่เป็นส่วนราชการใช้เกณฑ์ของราชการ (หักตั้งแต่ 500 บาท) */
create or replace function public.quotation_wht_floor() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base numeric := coalesce(new.amount, 0) - coalesce(new.discount, 0);
begin
  if v_base < public.wht_min_base(new.buyer_type = 'government') then
    new.wht := false;
    new.wht_pct := 0;
  end if;
  /* อัตราศูนย์แปลว่าไม่หัก — เก็บธงให้ตรงกัน จะได้ไม่มีใบที่ "หัก 0%" */
  if coalesce(new.wht_pct, 0) = 0 then
    new.wht := false;
  end if;
  return new;
end $$;

drop trigger if exists quotations_wht_floor on public.quotations;
create trigger quotations_wht_floor before insert or update of amount, discount, wht, wht_pct, buyer_type
  on public.quotations
  for each row execute function public.quotation_wht_floor();

/* เก็บเกณฑ์ลงค่าตั้งค่า ถ้ายังไม่มี — หน้าเว็บตั้งต้นให้เท่ากันอยู่แล้ว
   เขียนไว้เพื่อให้ฝั่งฐานข้อมูลอ่านค่าเดียวกัน ไม่ใช่ค่าสำรองในโค้ด */
update public.system_settings
   set data = jsonb_set(
         jsonb_set(data, '{rates,whtMinBase}',
                   coalesce(data -> 'rates' -> 'whtMinBase', to_jsonb(1000)), true),
         '{rates,whtMinBaseGov}',
         coalesce(data -> 'rates' -> 'whtMinBaseGov', to_jsonb(500)), true)
 where data ? 'rates';

notify pgrst, 'reload schema';
