/* รอบที่ 104 — เติมช่องที่ขาดของงานเข้าใหม่ (ต่อจากรอบที่ 103)
   ตอนต่อหน้าเว็บเข้าฐานข้อมูลถึงเห็นว่า InboxJob มีอีกสิบช่องที่รอบก่อนไม่ได้ทำไว้

   ข้อมูลผู้ซื้อ (ผู้ติดต่อ เบอร์ เลขภาษี ที่อยู่) ติดมากับใบเสนอราคา
   ผู้จัดการโครงการต้องใช้ตอนประสานงานกับลูกค้า จึงต้องมาถึงกล่องงานเข้าใหม่ด้วย

   กล่องงานเข้าใหม่เป็นกระดานรับงานกลาง ผู้จัดการโครงการทุกคนและหัวหน้าเห็นตารางเดียวกัน
   ใครกดรับก่อนได้งาน จึงต้องจดชื่อคนรับกับวันที่รับไว้ให้คนอื่นเห็น และห้ามรับซ้ำ */

alter table public.project_inbox
  add column if not exists contact    text not null default '',
  add column if not exists phone      text not null default '',
  add column if not exists tax_id     text not null default '',
  add column if not exists address    text not null default '',
  add column if not exists terms      text not null default '',
  add column if not exists valid_days int  not null default 0,
  add column if not exists taken_by   text not null default '',
  add column if not exists taken_at   date,
  add column if not exists name       text not null default '',
  add column if not exists docs       jsonb;
