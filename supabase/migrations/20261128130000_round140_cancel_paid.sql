/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 140 · ดีลยกเลิกหลังรับเงิน — ไม่คืนเงิน ทำงานต่อให้พอดีกับยอดที่จ่าย
   (Requirement รอบ 7 · ข้อค้างใน issue #1)

   เดิมยกเลิกดีลแล้วงานฝั่ง PM หยุดทั้งโปรเจค ซึ่งขัดกับที่เจ้าของตัดสินไว้
   ลูกค้าจ่ายมาแล้วไม่คืนเงิน แต่ต้องทำงานให้เท่าที่จ่ายมา

   กติกาที่ลงเป็นของจริง
     ยังไม่ได้รับเงินเลย  — ยกเลิกทั้งดีลและโปรเจคเหมือนเดิม งานหยุด
     รับเงินมาแล้ว        — ดีลเป็น "ยกเลิก" แต่โปรเจคยังเดินต่อ
                            พร้อมเพดานงาน (work_cap) = ยอดที่รับมาจริง
                            ใบแจ้งหนี้งวดที่ยังค้างถูกยกเลิก และวางบิลงวดใหม่ไม่ได้อีก
                            PM เป็นคนกดปิดงานเมื่อส่งของเท่าที่จ่ายครบ (กติกาเดิมรอบที่ 132)

   เพดานงานเป็นตัวเลขของจริงจากใบเสร็จ/การรับชำระ ไม่ใช่ตัวเลขที่พิมพ์เอง
   แก้มือไม่ได้ และยกเลิกซ้ำไม่ได้เพราะดีลพ้นสถานะ "ปิดการขาย" ไปแล้ว
   ═══════════════════════════════════════════════════════════════════ */

alter table public.projects
  add column if not exists work_cap numeric(12, 2),
  add column if not exists cap_at   date,
  add column if not exists cap_why  text not null default '';

/*
 * รอบที่ 119 ถอนสิทธิ์อ่านทั้งตาราง projects แล้วคืนให้ทีละช่อง (ยกเว้น net)
 * ช่องที่เพิ่มใหม่จึงต้อง grant เองทุกครั้ง ไม่งั้นหน้าจอที่ select ช่องนี้พังทั้งคำขอ
 * เพดานงานเป็นขอบเขตงานที่ทีมต้องส่ง ไม่ใช่ตัวเลขรายได้ของบริษัท จึงเปิดให้อ่านเหมือนช่องอื่น
 */
grant select (work_cap, cap_at, cap_why) on public.projects to authenticated;

comment on column public.projects.work_cap is
  'ดีลถูกยกเลิกหลังรับเงิน — ทำงานต่อได้เท่ายอดที่ลูกค้าจ่ายมาแล้ว (บาท) · ว่างคือไม่มีเพดาน';

/** ยอดที่ลูกค้าจ่ายมาแล้วของดีลนี้ — นับจากการรับชำระจริง ไม่ใช่ยอดที่วางบิลไว้ */
create or replace function public.deal_paid(p_deal uuid) returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(p.received), 0)::numeric
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
   where i.deal_id = p_deal
$$;

grant execute on function public.deal_paid(uuid) to authenticated;

/*
 * เพดานงานแก้มือไม่ได้ — มาจาก cancel_deal เท่านั้น
 * ฟังก์ชันนั้นเป็น definer แต่ auth.uid() ยังเป็นคนกด จึงกันด้วยธงประจำธุรกรรมแทน
 * (ท่าเดียวกับ maz.task_review ของรอบที่ 124)
 */
create or replace function public.project_cap_lock() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is null or current_setting('maz.deal_cancel', true) = '1' then
    return new;
  end if;
  if new.work_cap is distinct from old.work_cap
     or new.cap_at is distinct from old.cap_at
     or new.cap_why is distinct from old.cap_why then
    raise exception 'เพดานงานจากการยกเลิกดีลแก้ไม่ได้' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists projects_cap_lock on public.projects;
create trigger projects_cap_lock before update on public.projects
  for each row execute function public.project_cap_lock();

/* ── ยกเลิกดีล ─────────────────────────────────────────────────────
   เพิ่มจากรอบที่ 112 สองเรื่อง
     1. คืนยอดที่จ่ายมาแล้วให้หน้าจอบอกผู้ใช้ได้ว่าทำงานต่อเท่าไร
     2. รับเงินมาแล้วไม่หยุดงาน — ลงเพดานงานไว้ที่โปรเจคแทน
   ส่วนสิทธิ์ สถานะลูกค้า และการลงบันทึกคงเดิมทั้งหมด */
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
  v_sum   numeric := 0;
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

  /*
   * "ชำระแล้ว" ต้องนับจากเงินที่รับมาจริง ไม่ใช่การมีใบเสร็จ (เจอตอนทดสอบรอบที่ 140)
   * รอบที่ 118 เปิดให้บันทึกรับชำระโดยไม่ออกใบเสร็จ (บุคคลกับบุคคล)
   * ของเดิมดูแต่ใบเสร็จ ดีลที่รับเงินแล้วแต่ไม่มีใบเสร็จจึงหลุดให้ฝ่ายขายยกเลิกเองได้
   */
  v_sum := public.deal_paid(v_d.id);
  v_paid := v_sum > 0 or exists (
    select 1 from public.receipts r
      join public.invoices i on i.id = r.invoice_id
     where i.deal_id = v_d.id
  );
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

  /* ธงบอกทริกเกอร์ว่าการแก้เพดานงานครั้งนี้มาจากการยกเลิกดีล ไม่ใช่คนพิมพ์เอง */
  perform set_config('maz.deal_cancel', '1', true);

  if v_sum > 0 then
    /* จ่ายมาแล้วไม่คืนเงิน ทำงานต่อเท่าที่จ่าย — ลงเพดานงานไว้ที่โปรเจค ไม่หยุดงาน */
    update public.projects
       set work_cap = v_sum,
           cap_at = v_today,
           cap_why = 'ดีล ' || p_no || ' ถูกยกเลิก · ' || p_why
     where deal_id = v_d.id and status = 'running';
  else
    /* ไม่ได้รับเงินเลย — งานหยุดทั้งโปรเจค */
    update public.projects
       set status = 'cancelled', cancel_at = v_today,
           cancel_by = coalesce(nullif(p_by, ''), 'ฝ่ายขาย'), cancel_why = p_why
     where deal_id = v_d.id and status = 'running';
  end if;

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
  values (auth.uid(), 'cancel_deal', v_d.id,
          jsonb_build_object('no', p_no, 'why', p_why, 'paid', v_sum));

  perform set_config('maz.deal_cancel', '', true);
  return jsonb_build_object('ok', true, 'paid', v_sum, 'capped', v_sum > 0);
end $$;

revoke all on function public.cancel_deal(text, text, text) from public, anon;
grant execute on function public.cancel_deal(text, text, text) to authenticated;

/**
 * วางบิลงวดใหม่ของดีลที่ถูกยกเลิกแล้วไม่ได้
 * เงินที่รับมาแล้วไม่คืน แต่จะเก็บเพิ่มก็ไม่ได้ เพราะดีลจบไปแล้ว
 */
create or replace function public.invoice_deal_alive() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_status text;
begin
  select d.status into v_status from public.deals d where d.id = new.deal_id;
  if v_status = 'ยกเลิก' then
    raise exception 'ดีลนี้ถูกยกเลิกแล้ว วางบิลงวดใหม่ไม่ได้' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists invoices_deal_alive on public.invoices;
create trigger invoices_deal_alive before insert on public.invoices
  for each row execute function public.invoice_deal_alive();

notify pgrst, 'reload schema';
