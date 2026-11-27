/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 151 · สายอนุมัติตามตำแหน่งงาน บังคับที่ฐานข้อมูล
   (BusinessRules ฉบับ 2 · 13 พ.ย. 2569 — "สายอนุมัติอิงบทบาท ต้องเป็นอิงตำแหน่ง")

   ของเดิม approval_routes คีย์ด้วยบทบาท (employees.position = บทบาทที่บัญชีถือ)
   แต่คนละตำแหน่งที่ถือบทบาทเดียวกันต้องไปคนละสายได้ เช่น
     ตำแหน่ง SA กับ Developer ถือบทบาทคนละอย่างก็จริง แต่กติกาจริงผูกกับ "ตำแหน่ง"
     และฝ่ายบุคคลต้องแก้สายของตำแหน่งใดตำแหน่งหนึ่งได้โดยไม่กระทบคนอื่นในบทบาทเดียวกัน

   หน้าจอมีชั้นทับรายตำแหน่งอยู่แล้ว (settings.posRoute) แต่เป็นการกันที่หน้าจออย่างเดียว
   ยิงคำสั่งตรงยังข้ามได้ รอบนี้จึงย้ายลงฐานข้อมูล
     1. ตาราง approval_routes_pos (kind, pos_key, approver_role) — ชั้นทับรายตำแหน่ง
     2. route_of() อ่านชั้นตำแหน่งก่อน ไม่มีค่อยตกมาใช้สายรายบทบาทเหมือนเดิม
   ทุกใบ (ลา · โอที · เบิก) เดินผ่าน route_of อยู่แล้ว จึงได้ผลพร้อมกันทั้งระบบ
   ═══════════════════════════════════════════════════════════════════ */

create table if not exists public.approval_routes_pos (
  kind          text not null check (kind in ('leave', 'ot', 'expense')),
  /** ตำแหน่งงานจริงของพนักงาน (employees.pos_key) ไม่ใช่บทบาทที่บัญชีถือ */
  pos_key       text not null,
  approver_role text not null,
  primary key (kind, pos_key)
);

comment on table public.approval_routes_pos is
  'ชั้นทับสายอนุมัติรายตำแหน่ง — ตำแหน่งที่ไม่มีแถวในตารางนี้ใช้สายรายบทบาทของ approval_routes';

alter table public.approval_routes_pos enable row level security;

drop policy if exists routes_pos_read on public.approval_routes_pos;
create policy routes_pos_read on public.approval_routes_pos
  for select to authenticated using (true);

/* ฝ่ายบุคคลเป็นคนดูแลสายอนุมัติ (ไม่มีบทบาทผู้ดูแลระบบแยกตาม SRS 1.2) */
drop policy if exists routes_pos_write on public.approval_routes_pos;
create policy routes_pos_write on public.approval_routes_pos
  for all to authenticated using (public.has_role('hr')) with check (public.has_role('hr'));

grant select on public.approval_routes_pos to authenticated;
grant insert, update, delete on public.approval_routes_pos to authenticated;

/**
 * ใบประเภทนี้ของคนนี้ ต้องไปหาใคร
 * ชั้นตำแหน่ง (approval_routes_pos) มาก่อน · ไม่มีค่อยใช้สายรายบทบาท (approval_routes)
 * คืน null = ยังไม่ได้ตั้งสาย — ทริกเกอร์ของใบจะปฏิเสธพร้อมบอกให้ไปแจ้งฝ่ายบุคคล
 */
create or replace function public.route_of(p_kind text, p_employee uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.approver_role
       from public.employees e
       join public.approval_routes_pos p on p.kind = p_kind and p.pos_key = e.pos_key
      where e.id = p_employee),
    (select r.approver_role
       from public.employees e
       join public.approval_routes r on r.kind = p_kind and r.from_role = e.position
      where e.id = p_employee)
  )
$$;

grant execute on function public.route_of(text, uuid) to authenticated;

/*
 * ใบเบิกคิดสายของตัวเองอยู่ในฟังก์ชันบันทึก (รอบที่ 8) และคิดใหม่ตามประเภทค่าใช้จ่าย (รอบที่ 149)
 * ให้ใช้ route_of ชุดเดียวกับใบอื่น ไม่งั้นชั้นตำแหน่งจะมีผลกับใบลา/โอทีอย่างเดียว
 */
create or replace function public.claim_rows_route() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_claim uuid := coalesce(new.claim_id, old.claim_id);
  v_emp   uuid;
  v_base  text;
  v_st    text;
begin
  select c.status, c.employee_id into v_st, v_emp
    from public.expense_claims c where c.id = v_claim;
  if v_st is distinct from 'draft' then
    return coalesce(new, old);
  end if;
  v_base := public.route_of('expense', v_emp);
  update public.expense_claims
     set approver_role = public.claim_route(v_claim, coalesce(v_base, 'gm'))
   where id = v_claim;
  return coalesce(new, old);
end $$;

notify pgrst, 'reload schema';
