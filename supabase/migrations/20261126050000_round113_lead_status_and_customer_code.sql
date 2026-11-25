/* รอบที่ 113 — สองข้อที่เหลือจากรายงานผลทดสอบ (ผู้ใช้สั่งทำ 25 พ.ย. 2569)

   ข้อ 3 สถานะผู้สนใจยังขาด "ติดราคา" กับ "ไม่เสนองาน"
         ติดราคา   = เสนอราคาไปแล้ว รอลูกค้าตัดสินใจ — ระบบตั้งให้เองตอนออกใบเสนอราคา
         ไม่เสนองาน = เราเป็นฝ่ายไม่เสนอให้ (คัดออกเอง) ต่างจากปฏิเสธที่ลูกค้าเป็นฝ่ายไม่เอา
         ลำดับของสายงาน: รอนัดหมาย → ติดราคา → ปิดงาน / ปฏิเสธ / ไม่เสนองาน

   ข้อ 4 รหัสลูกค้าเปลี่ยนจาก LEAD- เป็น CUS- ตอนตอบรับใบเสนอราคา
         แต่ข้อกำหนดถือว่าเป็นลูกค้าเมื่อชำระเงินแล้ว
         ย้ายจุดเปลี่ยนรหัสไปที่ "ออกใบเสร็จใบแรกของดีล" แทน
         ตอบรับใบเสนอราคายังเปลี่ยนสถานะเป็นปิดงานเหมือนเดิม (ดีลเกิดแล้ว) แต่รหัสยังเป็น LEAD-
         เอกสารที่ออกก่อนชำระจึงอ้าง LEAD- ส่วนที่ออกหลังชำระอ้าง CUS- ตามความจริงของแต่ละใบ
         รหัสเดิมเก็บไว้ที่ lead_code เสมอ ลิงก์เก่าและเอกสารเก่าจึงยังเปิดไปถูกราย */

/* ═══ 1 สถานะผู้สนใจสองตัวใหม่ ════════════════════════════════════ */
alter table public.customers drop constraint if exists customers_status_check;
alter table public.customers add constraint customers_status_check
  check (status in ('รอนัดหมาย', 'ติดราคา', 'ปิดงาน', 'ปฏิเสธ', 'ไม่เสนองาน'));

/* ═══ 2 ออกใบเสนอราคา = ติดราคา ═══════════════════════════════════
   ตั้งให้เองเฉพาะรายที่ยัง "รอนัดหมาย" — รายที่ปิดงาน ปฏิเสธ หรือไม่เสนองานแล้ว
   ไม่ถูกดึงกลับมา และรายที่ติดราคาอยู่แล้วไม่ต้องลงประวัติซ้ำ
   ลงประวัติการเปลี่ยนแปลงเหมือนทุกทางที่เปลี่ยนสถานะ */
create or replace function public.lead_quoted() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c record;
begin
  if coalesce(new.status, '') <> 'ส่งแล้ว' then
    return new;
  end if;
  select c.* into v_c from public.customers c where c.id = new.customer_id;
  if v_c.id is null or v_c.status <> 'รอนัดหมาย' then
    return new;
  end if;
  update public.customers set status = 'ติดราคา' where id = v_c.id;
  insert into public.customer_changes (customer_id, kind, from_value, to_value, reason, by_name, by_id)
  values (v_c.id, 'status', v_c.status, 'ติดราคา',
          'ออกใบเสนอราคา ' || new.no, v_c.owner, public.my_employee_id());
  return new;
end $$;

drop trigger if exists quotations_lead_quoted on public.quotations;
create trigger quotations_lead_quoted after insert on public.quotations
  for each row execute function public.lead_quoted();

/* ═══ 3 ตอบรับใบเสนอราคา — ไม่เปลี่ยนรหัสแล้ว ════════════════════
   ส่วนอื่นคงเดิมทั้งหมด (เกิดดีล เกิดใบงาน เปลี่ยนสถานะเป็นปิดงาน ลงประวัติ) */
create or replace function public.accept_quotation(p_no text, p_scope text, p_delivery date, p_job_owner text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_me      uuid := public.my_employee_id();
  v_q       record;
  v_c       record;
  v_deal    uuid;
  v_deal_no text;
  v_job_no  text;
begin
  if not public.can_edit_sales() then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;

  perform pg_advisory_xact_lock(hashtext('quotation:' || p_no));

  select q.* into v_q from public.quotations q where q.no = p_no;
  if v_q.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_q.status <> 'ส่งแล้ว' then
    return jsonb_build_object('ok', false, 'reason', 'not_open', 'status', v_q.status);
  end if;
  if exists (select 1 from public.deals d where d.quotation_id = v_q.id) then
    return jsonb_build_object('ok', false, 'reason', 'already_billed');
  end if;

  select c.* into v_c from public.customers c where c.id = v_q.customer_id;

  update public.quotations set status = 'ตอบรับ' where id = v_q.id;

  v_deal_no := public.next_sales_no('deal', 'DL');
  insert into public.deals
    (no, customer_id, quotation_id, total, status, start_on, delivery, scope, closed_at, seller, seller_id, created_by)
  values
    (v_deal_no, v_c.id, v_q.id,
     greatest(coalesce(v_q.amount, 0) - coalesce(v_q.discount, 0), 0),
     'ปิดการขาย', v_today, p_delivery, p_scope, v_today, v_c.owner, v_c.owner_id, v_me)
  returning id into v_deal;

  v_job_no := public.next_sales_no('jobOrder', 'JO');
  insert into public.job_orders (no, deal_id, owner, item, due, status)
  values (v_job_no, v_deal, p_job_owner, p_scope, p_delivery, 'สร้างแล้ว');

  /* สถานะลูกค้าเปลี่ยนเป็นปิดงาน พร้อมลงประวัติเหมือนทุกทางที่เปลี่ยนสถานะ
     ส่วนรหัสยังเป็น LEAD- จนลูกค้าชำระงวดแรก (ดูทริกเกอร์ของใบเสร็จ) */
  if v_c.status is distinct from 'ปิดงาน' then
    update public.customers set status = 'ปิดงาน', closed_reason = '' where id = v_c.id;
    insert into public.customer_changes (customer_id, kind, from_value, to_value, reason, by_name, by_id)
    values (v_c.id, 'status', v_c.status, 'ปิดงาน', 'ปิดการขายจากใบเสนอราคา ' || p_no, v_c.owner, v_me);
  end if;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'accept_quotation', v_q.id,
          jsonb_build_object('deal', v_deal_no, 'job', v_job_no, 'customer', v_c.code));

  return jsonb_build_object('ok', true, 'deal', v_deal_no, 'job', v_job_no, 'customer', v_c.code);
end $$;

revoke all on function public.accept_quotation(text, text, date, text) from public, anon;
grant execute on function public.accept_quotation(text, text, date, text) to authenticated;

/* ═══ 4 ชำระเงินแล้วถึงเป็นลูกค้า ════════════════════════════════
   ออกใบเสร็จใบไหนก็ตามของดีลนั้น = ได้รับเงินจริงแล้ว เปลี่ยนหัวรหัสเป็น CUS-
   รหัสเดิมเก็บไว้ที่ lead_code · ถ้าเลข CUS- นั้นมีคนใช้แล้วก็คงรหัสเดิมไว้ (ไม่ชนกัน)
   ลงไว้ที่ audit_log เพราะประวัติลูกค้ารับเฉพาะการเปลี่ยนสถานะกับผู้ดูแล */
create or replace function public.customer_paid() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c      record;
  v_new    text;
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
          jsonb_build_object('from', v_c.code, 'to', v_new, 'receipt', new.no));
  return new;
end $$;

drop trigger if exists receipts_customer_paid on public.receipts;
create trigger receipts_customer_paid after insert on public.receipts
  for each row execute function public.customer_paid();
