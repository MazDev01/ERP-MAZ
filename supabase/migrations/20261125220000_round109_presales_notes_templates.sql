/* รอบที่ 109 — ฝั่งทีมก่อนการขาย: สายสนทนาของคำขอ และคลังเทมเพลตข้อเสนอ

   สองเรื่องนี้เป็นของที่ทีมใช้ร่วมกัน แต่ยังเก็บใน localStorage ของเครื่องที่ใช้
   (ผู้ใช้สั่ง 25 พ.ย. 2569 ให้ย้ายขึ้นฐานข้อมูล)

   1) สายสนทนา — ใบคำขอเก็บได้แค่ข้อความล่าสุดอย่างละหนึ่ง (ask/reply)
      ฝ่ายขายจึงเปิดกล่องตอบมาเจอช่องเปล่า ไม่รู้ว่าทีมถามอะไร แล้วไปคุยกันในไลน์แทน
      ตารางนี้เก็บทุกข้อความต่อกัน ทั้งสองฝั่งอ่านย้อนได้ว่าคุยอะไรกันไปแล้ว

   2) คลังเทมเพลต — เทมเพลตข้อเสนอที่ใช้ซ้ำ แยกตามประเภทบริการ
      เลิกใช้ได้แต่ลบไม่ได้ เพราะข้อเสนอเก่าที่อ้างเทมเพลตนี้ต้องตามย้อนได้ */

/* ─── สายสนทนาของคำขอก่อนการขาย ────────────────────────────────── */
create table if not exists public.presales_notes (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.presales_requests (id) on delete cascade,
  /* ps = ทีมก่อนการขายถาม · sales = ฝ่ายขายตอบ */
  side       text not null check (side in ('ps', 'sales')),
  /* ชื่อผู้พิมพ์ ณ ตอนนั้น — ต้องรู้ว่าใครถาม ไม่ใช่แค่ว่า "ทีมถาม" */
  by_name    text not null default '',
  by_id      uuid references public.employees (id) on delete set null,
  tx         text not null check (btrim(tx) <> ''),
  at         timestamptz not null default now()
);

create index if not exists presales_notes_req_idx on public.presales_notes (request_id, at);

/* ─── คลังเทมเพลตข้อเสนอ ──────────────────────────────────────────
   kind: ppt/pdf = ไฟล์ · canva/link = ลิงก์
   file_id = รหัสไฟล์ในที่เก็บไฟล์ของระบบ (ยังไม่มีไฟล์จริงก็เว้นได้)
   retired = เลิกใช้ ไม่ขึ้นให้เลือกตอนส่งข้อเสนอ แต่ยังอยู่ในคลัง */
create table if not exists public.presales_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  /* รหัสประเภทบริการ ชุดเดียวกับใบเสนอราคา */
  service     text not null default '',
  kind        text not null check (kind in ('ppt', 'pdf', 'canva', 'link')),
  file        text not null default '',
  url         text,
  size        bigint,
  file_id     text,
  note        text not null default '',
  by_name     text not null default '',
  by_id       uuid references public.employees (id) on delete set null,
  /* แนบไปกับข้อเสนอแล้วกี่ครั้ง — นับผ่านฟังก์ชัน ไม่ให้หน้าจอเขียนตัวเลขเอง */
  uses        int  not null default 0 check (uses >= 0),
  retired     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists presales_templates_service_idx on public.presales_templates (service, retired);

drop trigger if exists presales_templates_touch on public.presales_templates;
create trigger presales_templates_touch before update on public.presales_templates
  for each row execute function public.touch_updated_at();

/* ─── สิทธิ์ ────────────────────────────────────────────────────────
   สายสนทนา: ใครเห็นงานขายก็อ่านได้ · เขียนได้ฝ่ายขาย ทีมก่อนการขาย และฝ่ายโครงการ
             (ชุดเดียวกับที่แก้ใบคำขอได้) · แก้หรือลบข้อความที่ส่งแล้วไม่ได้
   คลังเทมเพลต: อ่านได้ทุกคนที่เห็นงานขาย · เพิ่ม/แก้ได้ทีมก่อนการขายและหัวหน้า
                ลบไม่ได้ ใช้เลิกใช้แทน */
alter table public.presales_notes     enable row level security;
alter table public.presales_templates enable row level security;

revoke all on public.presales_notes     from public, anon;
revoke all on public.presales_templates from public, anon;
grant select, insert         on public.presales_notes     to authenticated;
grant select, insert, update on public.presales_templates to authenticated;

drop policy if exists presales_notes_read      on public.presales_notes;
drop policy if exists presales_notes_write     on public.presales_notes;
drop policy if exists presales_templates_read  on public.presales_templates;
drop policy if exists presales_templates_write on public.presales_templates;
drop policy if exists presales_templates_edit  on public.presales_templates;

create policy presales_notes_read on public.presales_notes
  for select to authenticated using (public.can_see_sales());
create policy presales_notes_write on public.presales_notes
  for insert to authenticated
  with check (public.can_edit_sales() or public.has_role('ps') or public.has_role('pm'));

create policy presales_templates_read on public.presales_templates
  for select to authenticated using (public.can_see_sales());
create policy presales_templates_write on public.presales_templates
  for insert to authenticated
  with check (public.has_role('ps') or public.has_role('gm') or public.has_role('ceo'));
create policy presales_templates_edit on public.presales_templates
  for update to authenticated
  using (public.has_role('ps') or public.has_role('gm') or public.has_role('ceo'))
  with check (public.has_role('ps') or public.has_role('gm') or public.has_role('ceo'));

/* ─── นับการใช้เทมเพลต ─────────────────────────────────────────────
   เรียกตอนส่งข้อเสนอจริง · เทมเพลตเดียวกันส่งมาซ้ำในชุดเดียวนับตามจำนวนที่ส่งมา
   ให้ฐานข้อมูลบวกเอง สองคนส่งงานพร้อมกันจะได้ไม่ทับกัน
   ใครส่งข้อเสนอได้ก็นับได้ (ps/pm/ฝ่ายขาย) — ไม่ต้องมีสิทธิ์แก้คลัง */
create or replace function public.presales_template_use(p_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (public.can_edit_sales() or public.has_role('ps') or public.has_role('pm')) then
    raise exception 'ไม่มีสิทธิ์นับการใช้เทมเพลต';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;
  update public.presales_templates t
     set uses = t.uses + c.n
    from (select x id, count(*) n from unnest(p_ids) x group by x) c
   where t.id = c.id;
end $$;

revoke all on function public.presales_template_use(uuid[]) from public, anon;
grant execute on function public.presales_template_use(uuid[]) to authenticated;
