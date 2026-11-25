/* รอบที่ 112 — ปิดช่องจากรายงานผลทดสอบฐานข้อมูล (25 พ.ย. 2569)

   สี่เรื่องที่ตรวจแล้วเป็นจริง:
   1. บัญชีออกใบเสร็จงวดแรกแล้วงานไม่เข้ากล่องของฝ่ายโครงการ — นโยบายของกล่องงาน
      ให้เขียนได้เฉพาะฝ่ายโครงการ แต่คนที่กดออกใบเสร็จคือบัญชี จึงถูกกั้นแบบไม่มีข้อความ
      แก้ด้วยฟังก์ชัน security definer ที่ให้บัญชีเรียกได้ และตรวจเงื่อนไขซ้ำที่ฐานข้อมูล
   2. เบอร์โทรซ้ำบันทึกได้ — กันแค่หน้าจอ
   3. ฝ่ายขายยกเลิกดีลได้แม้ลูกค้าชำระงวดแรกแล้ว — ข้อกำหนดให้หลังชำระเป็นงานของบัญชี
   4. ผลรวมงวดต่างจากยอดดีล และออกบิลข้ามงวดได้ — กันแค่หน้าจอ */

/* ═══ 1 งานเข้ากล่องฝ่ายโครงการ ═══════════════════════════════════
   เรียกตอนออกใบเสร็จงวดแรก · บัญชี ฝ่ายโครงการ หัวหน้า และผู้บริหารเรียกได้
   ฐานข้อมูลตรวจเองว่าใบแจ้งหนี้นั้นเป็นงวดแรกและชำระครบแล้วจริง
   ซ้ำแล้วไม่สร้างใหม่ — คืนเลขที่งานของเดิมไป (บัญชีแก้แล้วบันทึกเงินซ้ำได้) */
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
  /* ชำระครบ = ไม่มียอดค้าง และมีใบเสร็จของใบนั้นแล้ว */
  if coalesce(v_inv.outstanding, 0) > 0
     or not exists (select 1 from public.receipts r where r.invoice_id = v_inv.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_paid');
  end if;

  perform pg_advisory_xact_lock(hashtext('inbox:' || v_bill));

  /* กันซ้ำ — ทั้งที่ยังอยู่ในกล่อง และที่ยืนยันเป็นโปรเจคไปแล้ว */
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
    coalesce((p->>'seqs')::int, 0),
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

/* ═══ 2 เบอร์โทรห้ามซ้ำ ═══════════════════════════════════════════
   เทียบเฉพาะตัวเลข — 081-234-5678 กับ 0812345678 ถือว่าเบอร์เดียวกัน
   ที่ยังไม่กรอกเบอร์ (ว่าง) ไม่นับ จะได้เพิ่มผู้สนใจที่ยังไม่มีเบอร์ได้หลายราย */
create unique index if not exists customers_phone_uniq
  on public.customers (regexp_replace(phone, '\D', '', 'g'))
  where coalesce(btrim(phone), '') <> '';

/* ═══ 3 ยกเลิกดีลหลังลูกค้าชำระแล้ว เป็นงานของบัญชี ═════════════
   ก่อนชำระ: ฝ่ายขายยกเลิกได้ที่หน้าดีล
   ชำระแล้ว (มีใบเสร็จของดีลนั้น): บัญชี หัวหน้า หรือผู้บริหารเท่านั้น
   เพราะต้องจัดการใบแจ้งหนี้ ใบลดหนี้ และเงินที่รับมาแล้วไปพร้อมกัน

   ของเดิมด่านแรกเป็น can_edit_sales() อย่างเดียว ซึ่งไม่รวมบัญชี
   ฝั่งบัญชีจึงยกเลิกดีลที่ชำระแล้วไม่ได้เลยทั้งที่หน้าจอมีปุ่มให้ (เจอตอนตรวจรายงาน)
   ส่วนอื่นของฟังก์ชันคงเดิมทั้งหมด */
create or replace function public.cancel_deal(p_no text, p_why text, p_by text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_me    uuid := public.my_employee_id();
  v_d     record;
  v_c     record;
  v_paid  boolean;
begin
  if not (public.can_edit_sales() or public.has_role('acc')) then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;
  if coalesce(trim(p_why), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'need_reason');
  end if;

  perform pg_advisory_xact_lock(hashtext('deal:' || p_no));

  select d.* into v_d from public.deals d where d.no = p_no and d.status = 'ปิดการขาย';
  if v_d.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;

  select exists (
    select 1 from public.receipts r
      join public.invoices i on i.id = r.invoice_id
     where i.deal_id = v_d.id
  ) into v_paid;
  if v_paid and not (public.has_role('acc') or public.has_role('gm') or public.has_role('ceo')) then
    return jsonb_build_object('ok', false, 'reason', 'paid_acc_only');
  end if;
  /* ยังไม่ชำระเป็นงานของฝ่ายขาย — บัญชีไม่ต้องเข้ามายกเลิกแทน */
  if not v_paid and not public.can_edit_sales() then
    return jsonb_build_object('ok', false, 'reason', 'unpaid_sales_only');
  end if;

  update public.deals
     set status = 'ยกเลิก', lost_reason = p_why,
         cancel_at = v_today, cancel_by = p_by, cancel_why = p_why
   where id = v_d.id;

  select c.* into v_c from public.customers c where c.id = v_d.customer_id;
  if not exists (
    select 1 from public.deals d
     where d.customer_id = v_d.customer_id and d.status = 'ปิดการขาย'
  ) and v_c.status is distinct from 'รอนัดหมาย' then
    update public.customers set status = 'รอนัดหมาย', closed_reason = '' where id = v_c.id;
    insert into public.customer_changes (customer_id, kind, from_value, to_value, reason, by_name, by_id)
    values (v_c.id, 'status', v_c.status, 'รอนัดหมาย',
            'ดีล ' || p_no || ' ถูกยกเลิก · ' || p_why, coalesce(nullif(p_by, ''), v_c.owner), v_me);
  end if;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'cancel_deal', v_d.id, jsonb_build_object('no', p_no, 'why', p_why));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cancel_deal(text, text, text) from public, anon;
grant execute on function public.cancel_deal(text, text, text) to authenticated;

/* ═══ 4a บันทึกงวดเงินทั้งแผนในคำสั่งเดียว ════════════════════════
   ของเดิมหน้าจอลบงวดเก่าแล้วค่อยใส่ชุดใหม่ เป็นสองคำขอแยกกัน
   ระหว่างนั้นแผนไม่ครบ และไม่มีใครตรวจว่าผลรวมเท่ายอดดีล
   ที่นี่ทำทั้งชุดในคำสั่งเดียว ตรวจผลรวมก่อนบันทึก และคงงวดที่ออกบิลไปแล้วไว้ */
create or replace function public.save_installments(p_deal text, p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_d      record;
  v_locked int[];
  v_sum    numeric;
  v_cnt    int;
begin
  if not public.can_edit_acc() then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;

  select d.* into v_d from public.deals d where d.no = p_deal;
  if v_d.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('plan:' || p_deal));

  /* งวดที่ออกใบแจ้งหนี้ไปแล้วแก้ไม่ได้ — ของจริงออกไปถึงมือลูกค้าแล้ว */
  select coalesce(array_agg(distinct i.seq), '{}') into v_locked
    from public.invoices i where i.deal_id = v_d.id;

  create temp table if not exists _plan (seq int, pct numeric, amount numeric, due date) on commit drop;
  delete from _plan;
  insert into _plan (seq, pct, amount, due)
  select (r->>'seq')::int, coalesce((r->>'pct')::numeric, 0), coalesce((r->>'amount')::numeric, 0),
         nullif(r->>'due', '')::date
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r;

  /* งวดที่ล็อกแล้วต้องอยู่ในแผนที่ส่งมา และยอดต้องไม่ถูกแก้ */
  if exists (
    select 1 from public.deal_installments d0
     where d0.deal_id = v_d.id and d0.seq = any (v_locked)
       and not exists (select 1 from _plan p1 where p1.seq = d0.seq and p1.amount = d0.amount)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'locked_seq_changed');
  end if;

  select count(*), coalesce(sum(amount), 0) into v_cnt, v_sum from _plan;
  if v_cnt = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_plan');
  end if;
  if exists (select 1 from _plan where amount <= 0) then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;
  if exists (select 1 from _plan group by seq having count(*) > 1) then
    return jsonb_build_object('ok', false, 'reason', 'dup_seq');
  end if;
  /* เลขงวดต้องเรียง 1..n ไม่ข้าม */
  if exists (select 1 from _plan where seq < 1 or seq > v_cnt) then
    return jsonb_build_object('ok', false, 'reason', 'bad_seq');
  end if;
  if v_sum <> coalesce(v_d.total, 0) then
    return jsonb_build_object('ok', false, 'reason', 'sum_mismatch',
                              'sum', v_sum, 'total', coalesce(v_d.total, 0));
  end if;

  delete from public.deal_installments where deal_id = v_d.id;
  insert into public.deal_installments (deal_id, seq, pct, amount, due, created_by)
  select v_d.id, seq, pct, amount, due, public.my_employee_id() from _plan;

  return jsonb_build_object('ok', true, 'seqs', v_cnt);
end $$;

revoke all on function public.save_installments(text, jsonb) from public, anon;
grant execute on function public.save_installments(text, jsonb) to authenticated;

/* ═══ 4b ออกบิลตามลำดับงวด ════════════════════════════════════════
   ออกงวดถัดไปได้เมื่องวดก่อนหน้าชำระครบแล้ว — กติกาเดียวกับที่หน้าจอกันไว้
   งวดที่ถูกยกเลิกไม่นับเป็นค้าง (ดีลที่ยกเลิกมีใบแจ้งหนี้ที่ยกเลิกคาอยู่ได้) */
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
          or not exists (select 1 from public.receipts r where r.invoice_id = i.id));
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

drop trigger if exists invoices_in_order on public.invoices;
create trigger invoices_in_order before insert on public.invoices
  for each row execute function public.invoice_in_order();
