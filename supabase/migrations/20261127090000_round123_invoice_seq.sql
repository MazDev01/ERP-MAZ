/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 123 · ใบแจ้งหนี้ต้องอ้างด้วยเลขที่ + งวด (ตรวจระบบ 26 พ.ย. 2569)

   รอบที่ 117 ให้ทุกงวดของดีลใช้เลขใบแจ้งหนี้เดียวกันตามที่บัญชียืนยัน
   เลขที่จึงชี้ใบใดใบหนึ่งไม่ได้อีก แต่โค้ดฝั่งหน้าเว็บกับฟังก์ชันนี้
   ยังค้นด้วยเลขที่อย่างเดียว — งวดที่ 2 ขึ้นไปบันทึกรับเงินไม่ได้เลย

   pm_inbox_add รับงวดมาด้วย (ไม่ส่งมาถือว่างวดที่ 1 ซึ่งเป็นงวดที่เปิดงาน)
   และตอบเหตุผลที่อ่านรู้เรื่องเมื่อไม่ได้ส่งเลขที่ดีลมา — ของเดิมพังกลางทาง
   เป็น "record v_dl is not assigned yet"
   ═══════════════════════════════════════════════════════════════════ */

create or replace function public.pm_inbox_add(p jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill text := nullif(p->>'bill', '');
  v_deal text := nullif(p->>'deal', '');
  v_seq  int  := greatest(coalesce((p->>'seq')::int, 1), 1);
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
  if v_deal is null then
    return jsonb_build_object('ok', false, 'reason', 'need_deal');
  end if;

  select d.* into v_dl from public.deals d where d.no = v_deal;
  if v_dl.id is null then
    return jsonb_build_object('ok', false, 'reason', 'deal_not_found');
  end if;

  /* เลขที่ซ้ำกันทุกงวด — ชี้ใบด้วยดีลกับงวด ไม่ใช่เลขที่อย่างเดียว */
  select i.* into v_inv from public.invoices i
   where i.no = v_bill and i.deal_id = v_dl.id and i.seq = v_seq;
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

  /* ซ้ำได้ ไม่ใช่ความผิดพลาด — คืนเลขโปรเจคเดิมไป */
  select pj into v_pj from public.project_inbox where invoice_id = v_inv.id;
  if v_pj is not null then
    return jsonb_build_object('ok', true, 'pj', v_pj, 'dup', true);
  end if;
  select pj into v_pj from public.projects where invoice_id = v_inv.id;
  if v_pj is not null then
    return jsonb_build_object('ok', true, 'pj', v_pj, 'dup', true);
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
    /* อย่างน้อยหนึ่งงวดเสมอ — ตารางกำหนดไว้ว่า seqs ต้องไม่น้อยกว่า 1 */
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
  values (auth.uid(), 'pm_inbox_add', v_inv.id, jsonb_build_object('bill', v_bill, 'seq', v_seq, 'pj', v_pj));

  return jsonb_build_object('ok', true, 'pj', v_pj);
end $$;

/* ── ตัวกันลำดับงวด ยอมรับการรับชำระที่ไม่ออกใบเสร็จด้วย ────────────
   ของเดิมนับว่า "ชำระครบ" ต้องมีใบเสร็จเท่านั้น งานบุคคลกับบุคคล (รอบที่ 118)
   ที่รับเงินโดยไม่ออกใบเสร็จจึงออกบิลงวดถัดไปไม่ได้เลย */
create or replace function public.invoice_in_order() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad int;
begin
  select min(i.seq) into v_bad
    from public.invoices i
   where i.deal_id = new.deal_id
     and i.seq < new.seq
     and coalesce(i.status, '') <> 'cancelled'
     and (coalesce(i.outstanding, 0) > 0
          or not (exists (select 1 from public.receipts r where r.invoice_id = i.id)
                  or exists (select 1 from public.payments y where y.invoice_id = i.id)));
  if v_bad is not null then
    raise exception 'งวดที่ % ยังไม่ชำระครบ ออกบิลงวดที่ % ไม่ได้', v_bad, new.seq
      using errcode = 'check_violation';
  end if;
  /* ข้ามเลขงวด = ยังไม่มีแผนของงวดก่อนหน้า ก็ออกไม่ได้ */
  if new.seq > 1 and not exists (
    select 1 from public.invoices i where i.deal_id = new.deal_id and i.seq = new.seq - 1
  ) then
    raise exception 'ยังไม่ได้ออกบิลงวดที่ % ออกงวดที่ % ไม่ได้', new.seq - 1, new.seq
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
