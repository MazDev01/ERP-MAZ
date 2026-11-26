/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 122 · ยอดดีลต้องเป็นยอดที่ลูกค้าโอนจริง (เจอตอนทดสอบ 26 พ.ย. 2569)

   accept_quotation เก็บยอดดีลเป็น "ฐานก่อนภาษี" แต่ทุกหน้าจอใช้ยอดที่
   ลูกค้าโอนจริง = ฐาน + VAT − หัก ณ ที่จ่าย (กติกาเดียวใน quotationTotals)
   หน้าวางบิลจึงแบ่งงวดจาก 321,000 แต่ฐานข้อมูลเทียบกับ 300,000
   แล้วตอบ sum_mismatch — บัญชีบันทึกแผนงวดของใบที่มี VAT ไม่ได้เลย

   ย้ายสูตรลงฐานข้อมูลเป็น quotation_grand() อ่านค่า VAT และผู้ออกเอกสาร
   จากตารางค่าตั้งค่า ไม่ใช่ค่าคงที่ · ยังไม่มีดีลเก่าที่ต้องแก้ (ตรวจแล้ว 0 รายการ)
   ═══════════════════════════════════════════════════════════════════ */

/** ยอดที่ลูกค้าโอนจริงของใบเสนอราคา = ฐาน + VAT − หัก ณ ที่จ่าย */
create or replace function public.quotation_grand(p_id uuid) returns numeric
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_q    record;
  v_s    jsonb;
  v_base numeric;
  v_vat  numeric := 0;
  v_wht  numeric := 0;
begin
  select * into v_q from public.quotations where id = p_id;
  if v_q.id is null then
    return 0;
  end if;
  select data into v_s from public.system_settings order by updated_at desc limit 1;

  v_base := greatest(coalesce(v_q.amount, 0) - coalesce(v_q.discount, 0), 0);

  /* ผู้ออกเอกสารที่จด VAT เท่านั้นที่คิดภาษีมูลค่าเพิ่ม (เมธา = จด · ในนามบุคคล = ไม่จด) */
  if coalesce((select (e ->> 'vat')::boolean
                 from jsonb_array_elements(coalesce(v_s -> 'issuers', '[]'::jsonb)) e
                where e ->> 'code' = v_q.issuer), false) then
    v_vat := round(v_base * coalesce((v_s -> 'rates' ->> 'vat')::numeric, 7) / 100, 2);
  end if;

  if coalesce(v_q.wht, false) then
    v_wht := round(v_base * coalesce(v_q.wht_pct, (v_s -> 'rates' ->> 'wht')::numeric, 3) / 100, 2);
  end if;

  return round(v_base + v_vat - v_wht, 2);
end $$;

grant execute on function public.quotation_grand(uuid) to authenticated;

create or replace function public.accept_quotation(p_no text, p_scope text, p_delivery date, p_job_owner text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     public.quotation_grand(v_q.id),
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
end $function$
;

notify pgrst, 'reload schema';
