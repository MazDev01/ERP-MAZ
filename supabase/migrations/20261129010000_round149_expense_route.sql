/* ═══════════════════════════════════════════════════════════════════
   รอบที่ 149 · สายอนุมัติใบเบิกแยกตามประเภทค่าใช้จ่าย
   (BusinessRules ฉบับ 2 · 13 พ.ย. 2569 — ตาราง "จุดที่ระบบยังไม่ตรงกับเอกสาร")

   เอกสารกำหนดไว้ว่า
     ค่าน้ำมัน · ค่าเดินทาง · ค่าคอมมิชชั่น → ผู้จัดการทั่วไป (GM)
     ค่าใช้จ่ายอื่น ๆ                      → ผู้บริหาร (CEO)

   ของเดิมใบเบิกเป็นประเภทเดียว ส่งตามบทบาทของผู้ยื่นอย่างเดียว
   ใบของเราหนึ่งใบมีได้หลายแถวหลายประเภท (ค่าน้ำมันรวมกับค่าอื่นในใบเดียว)
   จึงใช้กติกา "ใบไหนมีค่าใช้จ่ายอื่นปนอยู่ ทั้งใบขึ้นผู้บริหาร"
   เพราะคนอนุมัติต้องเห็นยอดรวมทั้งใบ ไม่ใช่อนุมัติกันคนละครึ่ง

   ประเภทที่ถือว่าเป็น "ค่าน้ำมัน/เดินทาง/คอมมิชชั่น" เก็บเป็นค่าตั้งค่า (ตารางด้านล่าง)
   ฝ่ายบุคคลเพิ่มประเภทใหม่ได้โดยไม่ต้องแก้โค้ด — ประเภทที่ไม่อยู่ในรายการนี้ถือเป็น "อื่น ๆ"
   ═══════════════════════════════════════════════════════════════════ */

create table if not exists public.expense_kind_routes (
  kind      text primary key,
  /* 'gm' = ผู้จัดการทั่วไป · 'ceo' = ผู้บริหาร */
  approver  text not null check (approver in ('gm', 'ceo'))
);

comment on table public.expense_kind_routes is
  'ประเภทค่าใช้จ่ายไหนขึ้นผู้อนุมัติคนไหน — ประเภทที่ไม่อยู่ในตารางนี้ถือเป็นค่าใช้จ่ายอื่น (ผู้บริหาร)';

insert into public.expense_kind_routes (kind, approver) values
  ('ค่าน้ำมันรถยนต์', 'gm'),
  ('ค่าน้ำมันมอเตอร์ไซค์', 'gm'),
  ('ค่าเดินทาง', 'gm'),
  ('ค่าคอมมิชชั่น', 'gm')
on conflict (kind) do nothing;

alter table public.expense_kind_routes enable row level security;

drop policy if exists expense_kind_routes_read on public.expense_kind_routes;
create policy expense_kind_routes_read on public.expense_kind_routes
  for select to authenticated using (true);

drop policy if exists expense_kind_routes_write on public.expense_kind_routes;
create policy expense_kind_routes_write on public.expense_kind_routes
  for all to authenticated using (public.has_role('hr')) with check (public.has_role('hr'));

grant select on public.expense_kind_routes to authenticated;
grant insert, update, delete on public.expense_kind_routes to authenticated;

/**
 * ใบนี้ต้องให้ใครอนุมัติ — ดูจากประเภทของแถวค่าใช้จ่ายอื่นในใบ
 * มีแถวที่ไม่ใช่ค่าน้ำมัน/เดินทาง/คอมมิชชั่นแม้แถวเดียว ทั้งใบขึ้นผู้บริหาร
 * ไม่มีเลย (ใบค่าน้ำมันล้วน) ใช้สายตามบทบาทของผู้ยื่นเหมือนเดิม
 */
create or replace function public.claim_route(p_claim uuid, p_base text)
  returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (
      select 1
        from public.expense_other_rows r
   left join public.expense_kind_routes k on k.kind = r.kind
       where r.claim_id = p_claim
         and coalesce(k.approver, 'ceo') = 'ceo'
    ) then 'ceo'
    else p_base
  end
$$;

grant execute on function public.claim_route(uuid, text) to authenticated;

/*
 * หลังบันทึกหรือแก้แถวของใบ ให้คิดผู้อนุมัติใหม่ทุกครั้ง
 * ใบที่ยื่นไปแล้วไม่ขยับ — ผู้อนุมัติต้องไม่เปลี่ยนกลางคันหลังผู้ยื่นกดส่ง
 */
create or replace function public.claim_rows_route() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_claim uuid := coalesce(new.claim_id, old.claim_id);
  v_role  text;
  v_base  text;
  v_st    text;
begin
  select c.status, e.position into v_st, v_role
    from public.expense_claims c join public.employees e on e.id = c.employee_id
   where c.id = v_claim;
  if v_st is distinct from 'draft' then
    return coalesce(new, old);
  end if;
  select approver_role into v_base from public.approval_routes
   where kind = 'expense' and from_role = v_role;
  update public.expense_claims
     set approver_role = public.claim_route(v_claim, coalesce(v_base, 'gm'))
   where id = v_claim;
  return coalesce(new, old);
end $$;

drop trigger if exists expense_other_rows_route on public.expense_other_rows;
create trigger expense_other_rows_route after insert or update or delete on public.expense_other_rows
  for each row execute function public.claim_rows_route();

/*
 * ใบที่มีอยู่ก่อนรอบนี้ — คิดผู้อนุมัติใหม่ให้ครั้งเดียว เฉพาะใบที่ยังเป็นร่าง
 * ใบที่ยื่น/อนุมัติ/จ่ายไปแล้วไม่แตะ ของเก่าต้องอ่านย้อนหลังได้เหมือนที่เคยเป็น
 */
update public.expense_claims c
   set approver_role = public.claim_route(c.id, c.approver_role)
 where c.status = 'draft';

notify pgrst, 'reload schema';
