/* รอบที่ 118 — ประเภทลูกค้าแบบละเอียด และรับชำระโดยไม่ออกใบเสร็จ (issue #1)

   1. ประเภทลูกค้ามี 4 แบบ: เอกชน · ราชการ · มูลนิธิ · บุคคลธรรมดา
      ใช้ตั้งอัตราหัก ณ ที่จ่ายให้เองตอนออกใบเสนอราคา (แก้รายใบได้)
        เอกชน 3% · ราชการ 1% · มูลนิธิ 3% · บุคคลธรรมดา ไม่หัก
      ของเดิมมีสองแบบ (juristic/individual) — juristic เดิมคือ "เอกชน"
      ค่าเดิมจึงยังใช้ได้ทั้งหมด ไม่ต้องแปลงข้อมูลเก่า
      แบบยื่นภาษียังตัดสินจาก "เป็นบุคคลหรือไม่" เหมือนเดิม
      (บุคคลธรรมดา ภ.ง.ด.3 · ที่เหลือ ภ.ง.ด.53)

   2. งานบุคคลกับบุคคลไม่ออกใบเสร็จ แต่ต้องบันทึกว่ารับเงินแล้ว
      และงวดแรกที่รับเงินครบต้องส่งงานเข้ากล่องของฝ่ายโครงการได้เหมือนกัน
      จึงเปลี่ยนเงื่อนไขของ pm_inbox_add จาก "ต้องมีใบเสร็จ"
      เป็น "ไม่มียอดค้าง และมีหลักฐานการรับเงิน (ใบเสร็จ หรือ รายการรับชำระ)" */

/* ═══ 1 ประเภทลูกค้า ═══════════════════════════════════════════════ */
alter table public.customers drop constraint if exists customers_buyer_type_check;
alter table public.customers add constraint customers_buyer_type_check
  check (buyer_type in ('juristic', 'government', 'foundation', 'individual'));

alter table public.quotations drop constraint if exists quotations_buyer_type_check;
alter table public.quotations add constraint quotations_buyer_type_check
  check (buyer_type in ('juristic', 'government', 'foundation', 'individual'));

/* อัตราหัก ณ ที่จ่ายตั้งต้นของลูกค้าแต่ละประเภท — 0 = ไม่หัก
   ใช้เป็นค่าตั้งต้นตอนออกใบเสนอราคา ใบไหนตกลงกันคนละอัตราก็แก้รายใบได้ */
create or replace function public.wht_pct_of_buyer(p_type text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'government' then 1
    when 'foundation' then 3
    when 'individual' then 0
    else 3            /* เอกชน (juristic) และค่าที่ไม่รู้จัก ใช้ 3% ตามงานรับจ้างทำของ */
  end
$$;

revoke all on function public.wht_pct_of_buyer(text) from public, anon;
grant execute on function public.wht_pct_of_buyer(text) to anon, authenticated;

/* ═══ 2 รับชำระโดยไม่ออกใบเสร็จ ═════════════════════════════════════
   เงื่อนไขเดิมคือ "มีใบเสร็จของใบแจ้งหนี้นั้น" — งานบุคคลกับบุคคลไม่มีใบเสร็จ
   งานจึงไม่เคยเข้ากล่องของฝ่ายโครงการเลย
   ส่วนอื่นของฟังก์ชันคงเดิมทั้งหมด */
create or replace function public.pm_inbox_add(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bill text := nullif(p->>'bill', '');
  v_deal text := nullif(p->>'deal', '');
  v_inv  record;
  v_dl   record;
  v_pj   text;
  v_paid boolean;
begin
  if not (public.has_role('acc') or public.can_edit_pm()) then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;

  if v_bill is null then
    return jsonb_build_object('ok', false, 'reason', 'need_invoice');
  end if;

  select i.* into v_inv from public.invoices i where i.no = v_bill;
  if v_inv.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invoice_not_found');
  end if;
  if v_inv.seq <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'not_first_seq');
  end if;

  /* ชำระครบ = ไม่มียอดค้าง และมีหลักฐานว่ารับเงินแล้ว
     หลักฐานคือใบเสร็จ หรือรายการรับชำระ (งานบุคคลกับบุคคลที่ไม่ออกใบเสร็จ) */
  select coalesce(v_inv.outstanding, 0) <= 0
     and (exists (select 1 from public.receipts r where r.invoice_id = v_inv.id)
          or exists (select 1 from public.payments y where y.invoice_id = v_inv.id))
    into v_paid;
  if not v_paid then
    return jsonb_build_object('ok', false, 'reason', 'not_paid');
  end if;

  perform pg_advisory_xact_lock(hashtext('inbox:' || v_bill));

  select pj into v_pj from public.project_inbox where invoice_id = v_inv.id;
  if v_pj is not null then
    return jsonb_build_object('ok', true, 'pj', v_pj, 'dup', true);
  end if;
  select pj into v_pj from public.projects where invoice_id = v_inv.id;
  if v_pj is not null then
    return jsonb_build_object('ok', true, 'pj', v_pj, 'dup', true);
  end if;

  if v_deal is not null then
    select d.* into v_dl from public.deals d where d.no = v_deal;
  end if;

  insert into public.project_inbox (
    invoice_id, deal_id, customer_id, service, cus, quo, quo_date, net, seqs,
    paid_at, sent_at, scope, items, due, stage, plan_start, plan_end, duration_days,
    phases, proposal, contact, phone, tax_id, address, terms, valid_days
  ) values (
    v_inv.id,
    v_dl.id,
    v_dl.customer_id,
    coalesce(p->>'service', 'website'),
    coalesce(p->>'cus', ''),
    coalesce(p->>'quo', ''),
    nullif(p->>'quoDate', '')::date,
    coalesce((p->>'net')::numeric, 0),
    /* อย่างน้อยหนึ่งงวดเสมอ — ตารางกำหนดไว้ว่า seqs ต้องไม่น้อยกว่า 1
       ผู้เรียกที่ไม่ได้ส่งจำนวนงวดมาจะทำให้บันทึกไม่ผ่าน (เจอตอนทดสอบ 26 พ.ย. 2569) */
    greatest(coalesce((p->>'seqs')::int, 1), 1),
    nullif(p->>'paidAt', '')::date,
    nullif(p->>'sentAt', '')::date,
    coalesce(p->>'scope', ''),
    coalesce(p->'items', '[]'::jsonb),
    nullif(p->>'due', '')::date,
    coalesce(p->>'stage', 'new'),
    nullif(p->>'planStart', '')::date,
    nullif(p->>'planEnd', '')::date,
    coalesce((p->>'durationDays')::int, 0),
    coalesce(p->'phases', '[]'::jsonb),
    case when p->'proposal' = 'null'::jsonb then null else p->'proposal' end,
    coalesce(p->>'contact', ''),
    coalesce(p->>'phone', ''),
    coalesce(p->>'taxId', ''),
    coalesce(p->>'address', ''),
    coalesce(p->>'terms', ''),
    coalesce((p->>'validDays')::int, 0)
  )
  returning pj into v_pj;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'pm_inbox_add', v_inv.id, jsonb_build_object('bill', v_bill, 'pj', v_pj));

  return jsonb_build_object('ok', true, 'pj', v_pj);
end $$;

revoke all on function public.pm_inbox_add(jsonb) from public, anon;
grant execute on function public.pm_inbox_add(jsonb) to authenticated;

/* ═══ 3 รับเงินโดยไม่ออกใบเสร็จ ก็เป็นลูกค้าแล้วเหมือนกัน ═════════
   ทริกเกอร์เปลี่ยนรหัส LEAD- เป็น CUS- (รอบที่ 113) ติดอยู่ที่ตารางใบเสร็จอย่างเดียว
   งานบุคคลกับบุคคลจึงค้างเป็น LEAD- ตลอด ทั้งที่รับเงินแล้ว (เจอตอนทดสอบ 26 พ.ย. 2569)
   ฟังก์ชันเดิมใช้ได้กับทั้งสองตาราง เพราะอ้างแค่ invoice_id — เลขเอกสารในบันทึกใช้ของที่มี */
create or replace function public.customer_paid() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c   record;
  v_new text;
begin
  select c.* into v_c
    from public.invoices i
    join public.deals d on d.id = i.deal_id
    join public.customers c on c.id = d.customer_id
   where i.id = new.invoice_id;
  if v_c.id is null or v_c.code not like 'LEAD-%' then
    return new;
  end if;

  v_new := 'CUS-' || substring(v_c.code from 6);
  if exists (select 1 from public.customers x where x.code = v_new) then
    return new;
  end if;

  update public.customers
     set code = v_new, lead_code = coalesce(lead_code, v_c.code)
   where id = v_c.id;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'customer_paid', v_c.id,
          jsonb_build_object('from', v_c.code, 'to', v_new,
                             'doc', coalesce(to_jsonb(new) ->> 'no', 'รับชำระไม่ออกใบเสร็จ')));
  return new;
end $$;

drop trigger if exists payments_customer_paid on public.payments;
create trigger payments_customer_paid after insert on public.payments
  for each row execute function public.customer_paid();
