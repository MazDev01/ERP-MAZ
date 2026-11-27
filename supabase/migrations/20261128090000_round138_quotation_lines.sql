/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 138 · ใบเสนอราคาหลายบริการ แยกราคาตามบริการ
   (Requirement รอบ 1 · ข้อค้างใน issue #1)

   เดิมใบหนึ่งมีบริการเดียว (quotations.service) กับจำนวนเงินก้อนเดียว
   เอกสารจริงของบริษัทมีใบที่ขายหลายบริการในใบเดียว และลูกค้าต้องเห็นราคาแยกทีละบริการ

   เก็บเป็นรายการในช่อง lines — แต่ละบรรทัดมี บริการ · ชื่อรายการ · ราคา
     มีรายการ: จำนวนเงินของใบ = ผลรวมราคาทุกบรรทัด (ฐานข้อมูลคิดให้ แก้มือไม่ได้)
               และบริการของใบ = บริการของบรรทัดแรก เพื่อให้งานเข้าใหม่ของ PM ยังอ่านได้เหมือนเดิม
     ไม่มีรายการ: ใบบริการเดียวแบบเดิม กรอกจำนวนเงินเอง (ใบเก่าทั้งหมดอยู่ทางนี้)

   ส่วนลด ภาษีมูลค่าเพิ่ม และหัก ณ ที่จ่าย ยังคิดจากยอดรวมของใบเหมือนเดิม
   ไม่ได้คิดแยกทีละบรรทัด เพราะเอกสารจริงหักส่วนลดและภาษีที่ท้ายใบใบเดียว
   ═══════════════════════════════════════════════════════════════════ */

alter table public.quotations
  add column if not exists lines jsonb not null default '[]'::jsonb;

comment on column public.quotations.lines is
  'รายการบริการในใบ [{service, name, price}] — ว่างคือใบบริการเดียวแบบเดิม';

/**
 * ตรวจรูปร่างของรายการ แล้วคิดยอดรวมให้
 * กันใบที่ยอดรวมไม่ตรงกับรายการ ซึ่งทำให้เอกสารกับดีลเป็นเลขละตัว
 */
create or replace function public.quotation_lines_fit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_line jsonb;
  v_sum numeric := 0;
  v_n int;
begin
  if jsonb_typeof(new.lines) is distinct from 'array' then
    raise exception 'bad_lines';
  end if;
  v_n := jsonb_array_length(new.lines);
  if v_n = 0 then
    return new;
  end if;

  for v_line in select * from jsonb_array_elements(new.lines) loop
    if coalesce(trim(v_line->>'service'), '') = '' then
      raise exception 'line_no_service';
    end if;
    if coalesce(trim(v_line->>'name'), '') = '' then
      raise exception 'line_no_name';
    end if;
    if (v_line->>'price') is null or (v_line->>'price')::numeric < 0 then
      raise exception 'line_bad_price';
    end if;
    v_sum := v_sum + (v_line->>'price')::numeric;
  end loop;

  /* ยอดของใบคิดจากรายการเสมอ — ที่อื่นในระบบอ่าน amount ตัวนี้ตัวเดียว */
  new.amount := round(v_sum, 2);
  /* บริการของใบ = บรรทัดแรก (งานเข้าใหม่ของ PM ใช้ช่องนี้เลือกชุดขั้นงาน) */
  new.service := new.lines->0->>'service';
  return new;
end;
$$;

drop trigger if exists quotations_lines_fit on public.quotations;
create trigger quotations_lines_fit before insert or update on public.quotations
  for each row execute function public.quotation_lines_fit();

/*
 * ใบที่ออกเลขแล้วแก้ไม่ได้ (รอบที่ 95) — รายการบริการต้องอยู่ในด่านนั้นด้วย
 * ไม่งั้นแก้ราคาในรายการแล้วยอดของใบที่ส่งลูกค้าไปแล้วเปลี่ยนตาม
 * แก้ราคาต้องออกใบใหม่แทนใบเดิมเหมือนเดิมทุกช่อง
 */
create or replace function public.lock_quotation_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.no is distinct from old.no
     or new.customer_id is distinct from old.customer_id
     or new.issuer is distinct from old.issuer
     or new.amount is distinct from old.amount
     or new.discount is distinct from old.discount
     or new.wht is distinct from old.wht
     or new.wht_pct is distinct from old.wht_pct
     or new.body is distinct from old.body
     or new.terms is distinct from old.terms
     or new.issued is distinct from old.issued
     or new.valid_days is distinct from old.valid_days
     or new.lines is distinct from old.lines then
    raise exception 'quotation_locked';
  end if;
  new.updated_at := now();
  return new;
end $$;

notify pgrst, 'reload schema';
