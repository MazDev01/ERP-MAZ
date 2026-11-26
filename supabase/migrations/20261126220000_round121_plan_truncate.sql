/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 121 · บัญชีบันทึกแผนงวดไม่ได้เลย (เจอตอนทดสอบ 26 พ.ย. 2569)

   save_installments ใช้ตารางชั่วคราวแล้วสั่ง "delete from _plan;" ลอย ๆ
   ฝั่งเซิร์ฟเวอร์ของ Supabase กันคำสั่งลบที่ไม่มีเงื่อนไข (SQLSTATE 21000
   "DELETE requires a WHERE clause") คำขอจากหน้าเว็บจึงตอบ 400 ทุกครั้ง
   หน้าวางบิลกดบันทึกงวดแล้วเงียบ ไม่มีงวดลงฐานข้อมูล

   เทสต์เดิมมองไม่เห็น เพราะเรียกในธุรกรรมด้วย set local role ซึ่งไม่ได้
   หยิบค่าที่ผูกกับบทบาทตอนล็อกอินมาใช้ — ต้องยิงผ่านหน้าเว็บจริงถึงเจอ
   เปลี่ยนเป็น truncate ซึ่งล้างตารางชั่วคราวได้โดยไม่ติดกติกานี้
   ═══════════════════════════════════════════════════════════════════ */

create or replace function public.save_installments(p_deal text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  truncate table _plan;
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
end $function$
;

notify pgrst, 'reload schema';
