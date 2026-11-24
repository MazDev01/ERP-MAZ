/* รอบที่ 98 — สองคำสั่งที่ต้องเปลี่ยนหลายตารางพร้อมกัน (SRS 1.5 M1)
   ลูกค้าตอบรับใบเสนอราคา · ยกเลิกดีลหลังปิดการขาย

   สองเรื่องนี้แตะหลายตารางในครั้งเดียว ถ้าให้เบราว์เซอร์ยิงทีละคำสั่ง
   แล้วเน็ตหลุดกลางทาง จะเหลือสภาพครึ่ง ๆ เช่นดีลเกิดแล้วแต่ใบเสนอราคายังขึ้นว่า "ส่งแล้ว"
   หรือลูกค้าเปลี่ยนรหัสเป็น CUS- แล้วแต่ดีลยังอ้างรหัสเดิม จึงรวบไว้เป็นคำสั่งเดียวของฐานข้อมูล

   เนื้อหาที่หน้าจอคิดเอง (ขอบเขตงานจากบรรทัดแรกของใบ · วันส่งมอบ · ผู้รับใบงาน)
   ส่งเข้ามาเป็นพารามิเตอร์ ฐานข้อมูลไม่ต้องรู้เรื่องการจัดรูปข้อความ */

/* ลูกค้าตอบรับใบเสนอราคา → เกิดดีลและใบงานตั้งต้น ผู้สนใจกลายเป็นลูกค้า */
create or replace function public.accept_quotation(
  p_no       text,
  p_scope    text,
  p_delivery date,
  p_job_owner text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone 'Asia/Bangkok')::date;
  v_me       uuid := public.my_employee_id();
  v_q        record;
  v_c        record;
  v_new_code text;
  v_deal_no  text;
  v_deal     uuid;
  v_job_no   text;
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

  /* ผู้สนใจที่ปิดการขายได้เปลี่ยนหัวรหัสเป็น CUS- แต่เก็บรหัสเดิมไว้ที่ lead_code
     ลิงก์เก่าและเอกสารเก่าที่อ้างรหัสเดิมจะได้ยังเปิดไปถูกราย */
  v_new_code := v_c.code;
  if v_c.code like 'LEAD-%' then
    v_new_code := 'CUS-' || substring(v_c.code from 6);
    if exists (select 1 from public.customers x where x.code = v_new_code) then
      v_new_code := v_c.code;
    else
      update public.customers
         set code = v_new_code,
             lead_code = coalesce(lead_code, v_c.code)
       where id = v_c.id;
    end if;
  end if;

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

  /* สถานะลูกค้าเปลี่ยนเป็นปิดงาน พร้อมลงประวัติเหมือนทุกทางที่เปลี่ยนสถานะ */
  if v_c.status is distinct from 'ปิดงาน' then
    update public.customers set status = 'ปิดงาน', closed_reason = '' where id = v_c.id;
    insert into public.customer_changes (customer_id, kind, from_value, to_value, reason, by_name, by_id)
    values (v_c.id, 'status', v_c.status, 'ปิดงาน', 'ปิดการขายจากใบเสนอราคา ' || p_no, v_c.owner, v_me);
  end if;

  insert into public.audit_log (actor, action, target, detail)
  values (auth.uid(), 'accept_quotation', v_q.id,
          jsonb_build_object('deal', v_deal_no, 'job', v_job_no, 'customer', v_new_code));

  return jsonb_build_object('ok', true, 'deal', v_deal_no, 'job', v_job_no, 'customer', v_new_code);
end $$;

/* ยกเลิกดีลหลังปิดการขาย — ต้องมีเหตุผลเสมอ
   ถ้าลูกค้ารายนั้นไม่เหลือดีลที่ยังเดินอยู่ ให้สถานะกลับไปเป็น "รอนัดหมาย"
   ลูกค้ายังอยู่ แค่งานนี้ไม่ได้ไปต่อ ไม่ใช่ "ปฏิเสธ" (เจ้าของสั่ง 24 ก.ย. 2569) */
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
begin
  if not public.can_edit_sales() then
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

revoke all on function public.accept_quotation(text, text, date, text) from public, anon;
revoke all on function public.cancel_deal(text, text, text) from public, anon;
grant execute on function public.accept_quotation(text, text, date, text) to authenticated;
grant execute on function public.cancel_deal(text, text, text) to authenticated;
