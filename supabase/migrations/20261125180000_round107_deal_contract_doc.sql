/* รอบที่ 107 — ใบสัญญาจ้างบริการที่ระบบออกให้ฝ่ายขาย
   ยกของจากสาย ERP_Test ที่ทำค้างไว้ 14 ต.ค. 2569 มาต่อกับฐานข้อมูล

   คนละเรื่องกับ deal_contracts (รอบที่ 95) — อันนั้นคือ "ไฟล์สัญญาที่เซ็นแล้ว" ที่ฝ่ายขายแนบเข้ามา
   อันนี้คือ "ตัวสัญญาที่ระบบร่างให้" จากใบเสนอราคา ดีล และงวดเงินของบัญชี
   ฝ่ายขายแก้เนื้อหาก่อนบันทึก บันทึกทุกครั้งได้ฉบับใหม่ ฉบับเก่าเก็บไว้ดูย้อนหลัง

   เลขที่สัญญาออกครั้งเดียวต่อดีล ฉบับถัดไปใช้เลขเดิมแต่เลขฉบับเดินขึ้น
   ออกได้หลังลูกค้าชำระงวดแรกแล้ว (ด่านอยู่ที่หน้าจอ ตรงนี้กันแค่ของที่ผิดรูป) */

create table if not exists public.deal_contract_docs (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals (id) on delete cascade,
  /* เลขที่สัญญา เช่น CT-2569-0001 — ทุกฉบับของดีลเดียวกันใช้เลขเดียวกัน */
  no         text not null,
  /* ฉบับที่ เริ่มจาก 1 */
  version    int  not null check (version >= 1),
  issuer     text not null default '',
  /* เนื้อหาสัญญาเป็น HTML (แท็กชุดเดียวกับรายละเอียดใบเสนอราคา) */
  body       text not null default '',
  /* วันที่ของสัญญา */
  on_date    date,
  by_name    text not null default '',
  by_id      uuid references public.employees (id) on delete set null,
  /* draft = สร้างจากแม่แบบใหม่ · edit = แก้จากฉบับก่อน */
  from_kind  text not null default 'draft' check (from_kind in ('draft', 'edit')),
  created_at timestamptz not null default now(),
  unique (deal_id, version)
);

create index if not exists deal_contract_docs_deal_idx on public.deal_contract_docs (deal_id, version desc);

/* เลขที่สัญญาถัดไป — เดินต่อกันทั้งปี พ.ศ. ให้ฐานข้อมูลออกเลข ไม่ใช่เบราว์เซอร์
   คำนำหน้าแยกตามผู้ออกเอกสาร รายแรกใช้ CT เฉย ๆ รายอื่นต่อท้ายด้วยรหัส */
create or replace function public.next_contract_no(p_prefix text default 'CT')
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return public.next_doc_no(coalesce(nullif(trim(p_prefix), ''), 'CT'));
end $$;

revoke all on function public.next_contract_no(text) from public, anon;
grant execute on function public.next_contract_no(text) to authenticated;

/* สัญญาเป็นเอกสารของฝ่ายขาย — ใครเห็นดีลก็เห็นสัญญา เขียนได้เฉพาะฝ่ายขายและหัวหน้า
   แก้ของเดิมไม่ได้ บันทึกใหม่ = ฉบับใหม่ จึงไม่เปิด update และไม่เปิด delete */
alter table public.deal_contract_docs enable row level security;
revoke all on public.deal_contract_docs from public, anon;
grant select, insert on public.deal_contract_docs to authenticated;

drop policy if exists deal_contract_docs_read  on public.deal_contract_docs;
drop policy if exists deal_contract_docs_write on public.deal_contract_docs;
create policy deal_contract_docs_read on public.deal_contract_docs
  for select to authenticated using (public.can_see_sales());
create policy deal_contract_docs_write on public.deal_contract_docs
  for insert to authenticated with check (public.can_edit_sales());
