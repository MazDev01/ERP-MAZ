-- ─── สายอนุมัติให้ตรงกับที่หน้าจอใช้ ───────────────────────────────
/*
 * ตารางนี้ถูก seed ไว้ตั้งแต่สร้างระบบ แต่เจ้าของตัดสินสายอนุมัติใหม่เดือน ก.ย. 2569
 * (ดู DEFAULT_ROUTE ใน src/lib/role.ts) หน้าจอจึงบอกชื่อผู้อนุมัติคนหนึ่ง
 * แต่ฐานข้อมูลส่งใบไปหาอีกคน — ใบโอทีของฝ่ายขายขึ้น CEO ทั้งที่จอบอกว่า GM
 *
 * ตั้งแต่นี้หน้าตั้งค่าตำแหน่งเขียนตารางนี้ทุกครั้งที่บันทึก (pushRoutes)
 * แถวด้านล่างคือค่าตั้งต้นที่ตรงกับหน้าจอ สำหรับฐานข้อมูลที่สร้างใหม่
 */
insert into public.approval_routes (kind, from_role, approver_role) values
  ('leave', 'sales', 'gm'),   ('ot', 'sales', 'gm'),    ('expense', 'sales', 'gm'),
  ('leave', 'ps', 'gm'),      ('ot', 'ps', 'ceo'),      ('expense', 'ps', 'gm'),
  ('leave', 'pm', 'gm'),      ('ot', 'pm', 'gm'),       ('expense', 'pm', 'gm'),
  ('leave', 'acc', 'ceo'),    ('ot', 'acc', 'ceo'),     ('expense', 'acc', 'gm'),
  ('leave', 'staff', 'gm'),   ('ot', 'staff', 'ceo'),   ('expense', 'staff', 'gm'),
  ('leave', 'maid', 'gm'),    ('ot', 'maid', 'gm'),     ('expense', 'maid', 'gm'),
  ('leave', 'intern', 'hr'),  ('ot', 'intern', 'hr'),   ('expense', 'intern', 'hr'),
  ('leave', 'hr', 'ceo'),     ('ot', 'hr', 'ceo'),      ('expense', 'hr', 'gm'),
  ('leave', 'gm', 'ceo'),     ('ot', 'gm', 'ceo'),      ('expense', 'gm', 'ceo'),
  /* ผู้บริหารไม่ยื่นคำขอ (NO_REQUESTS) แถวนี้มีไว้ให้ครบ ไม่ให้สายขาด */
  ('leave', 'ceo', 'hr'),     ('ot', 'ceo', 'hr'),      ('expense', 'ceo', 'acc')
on conflict (kind, from_role) do update set approver_role = excluded.approver_role;
