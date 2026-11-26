/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 125 · ใบเสนอราคาต้องรู้ว่า "ใครกรอก" กับ "ขายในนามใคร"
   (คำตอบพี่มิ้นท์ 25 พ.ย. 2569 — เฮียเป็นคนขายเอง บัญชีกรอกใบแทน)

   เดิมใบเสนอราคารู้แค่ผู้ออกเอกสาร (เมธา / ไอเมซเมกเกอร์ / ในนามบุคคล)
   คนขายอนุมานจากผู้ดูแลลูกค้า และไม่รู้เลยว่าใครเป็นคนกรอกใบ
   ตอนนี้เก็บแยกสองช่อง และส่งต่อไปถึงดีลเมื่อปิดการขาย
   ═══════════════════════════════════════════════════════════════════ */

alter table public.quotations
  add column if not exists seller    text not null default '',
  add column if not exists seller_id uuid references public.employees(id),
  add column if not exists filled_by text not null default '';

comment on column public.quotations.seller is 'ขายในนามใคร — ชื่อคนขายที่ลูกค้ารู้จัก';
comment on column public.quotations.filled_by is 'ใครกรอกใบนี้ — บันทึกให้เองจากบัญชีที่ล็อกอิน';

/* ตั้งต้นให้เอง: คนขาย = ผู้ดูแลลูกค้า · คนกรอก = ชื่อเล่นของคนที่ล็อกอินอยู่
   ส่งมาเองได้ (บัญชีเลือกว่าขายในนามใคร) แต่คนกรอกแก้ไม่ได้ ฐานข้อมูลเขียนให้ */
create or replace function public.quotation_who() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
begin
  if coalesce(new.seller, '') = '' then
    select c.owner, c.owner_id into new.seller, new.seller_id
      from public.customers c where c.id = new.customer_id;
    new.seller := coalesce(new.seller, '');
  end if;

  /* ใช้ชื่อเต็มแบบเดียวกับช่องผู้ดูแลลูกค้า เทียบกันได้ตรง ๆ ว่าคนกรอกคือคนขายไหม */
  select trim(e.first_name || ' ' || e.last_name) nm, e.id
    into v_me
    from public.user_accounts a
    join public.employees e on e.id = a.employee_id
   where a.user_id = auth.uid();
  new.filled_by := coalesce(v_me.nm, new.filled_by, '');
  return new;
end $$;

drop trigger if exists quotations_who on public.quotations;
create trigger quotations_who before insert on public.quotations
  for each row execute function public.quotation_who();

/* คนกรอกเป็นหลักฐาน แก้ย้อนหลังไม่ได้ (ใบที่ออกแล้วก็แก้ไม่ได้อยู่แล้ว) */
create or replace function public.quotation_who_lock() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.filled_by is distinct from old.filled_by then
    raise exception 'ชื่อผู้กรอกใบเสนอราคาแก้ไม่ได้' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists quotations_who_lock on public.quotations;
create trigger quotations_who_lock before update of filled_by on public.quotations
  for each row execute function public.quotation_who_lock();

/* ── ปิดการขายแล้ว ดีลต้องถือคนขายคนเดียวกับใบเสนอราคา ──────────── */
/* ของเดิมมีค่าตั้งต้นของพารามิเตอร์ ต้องคงไว้ ไม่งั้น create or replace ไม่ผ่าน */
create or replace function public.accept_quotation(
  p_no        text,
  p_scope     text,
  p_delivery  date,
  p_job_owner text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := public.my_employee_id();
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
  v_q       record;
  v_c       record;
  v_deal    uuid;
  v_deal_no text;
  v_job_no  text;
begin
  if not public.can_write_quotation() then
    return jsonb_build_object('ok', false, 'reason', 'denied');
  end if;

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
     'ปิดการขาย', v_today, p_delivery, p_scope, v_today,
     /* คนขายมาจากใบเสนอราคา (บัญชีกรอกแทนได้) ไม่ใช่ผู้ดูแลลูกค้าเสมอไป */
     coalesce(nullif(v_q.seller, ''), v_c.owner),
     coalesce(v_q.seller_id, v_c.owner_id),
     v_me)
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
          jsonb_build_object('quotation', p_no, 'deal', v_deal_no, 'seller', coalesce(nullif(v_q.seller, ''), v_c.owner)));

  return jsonb_build_object('ok', true, 'deal', v_deal_no, 'job', v_job_no);
end $$;

grant execute on function public.accept_quotation(text, text, date, text) to authenticated;

/* ใบที่ออกไปก่อนมีสองช่องนี้ — เติมคนขายจากผู้ดูแลลูกค้าไว้ให้อ่านรายงานได้ครบ
   ไม่เดาคนกรอก ปล่อยว่างไว้ตามความจริง */
update public.quotations q
   set seller = c.owner, seller_id = c.owner_id
  from public.customers c
 where c.id = q.customer_id and coalesce(q.seller, '') = '';

notify pgrst, 'reload schema';
