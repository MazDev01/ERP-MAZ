-- ข้อมูลตั้งต้นสำหรับเครื่องพัฒนา — รันอัตโนมัติท้าย npx supabase db reset
-- ไม่ใช่ข้อมูลจริง ห้ามใช้บนโครงการคลาวด์
--
-- สร้างเฉพาะ "พนักงาน" กับค่าตั้งค่า ส่วน "บัญชีเข้าระบบ" สร้างไม่ได้จากที่นี่
-- เพราะผู้ใช้อยู่ในระบบ auth ของ Supabase ต้องสร้างผ่าน Admin API
-- ใช้สคริปต์ tools/seed-accounts.mjs แทน

insert into public.employees (emp_no, first_name, last_name, nick, sex, position, emp_type, started_at, phone, email) values
  ('E01', 'ธนกร',     'ใจกว้าง',  'กร',    'ช', 'ceo',    'full',   '2022-01-04', '081-111-1111', 'ceo@maz.co.th'),
  ('E05', 'กมลชนก',   'พูนสุข',   'กมล',   'ญ', 'staff',  'full',   '2025-01-06', '081-555-5555', 'staff@maz.co.th'),
  ('E10', 'ชนิกานต์', 'วัฒนกุล',  'กานต์', 'ญ', 'pm',     'full',   '2024-02-01', '081-010-1010', 'pm@maz.co.th'),
  ('E11', 'ประเสริฐ', 'มั่นคงดี', 'เสริฐ', 'ช', 'gm',     'full',   '2023-05-01', '081-111-0011', 'gm@maz.co.th'),
  ('E12', 'ปวีณา',    'ศรีสุข',   'ปวีณา', 'ญ', 'hr',     'full',   '2024-03-01', '081-121-2121', 'hr@maz.co.th'),
  ('E15', 'บุญมา',    'สะอาด',    'มา',    'ญ', 'maid',   'full',   '2025-06-01', '081-515-1515', ''),
  ('E18', 'ชนัญชิดา', 'ใจดี',     'ชิดา',  'ญ', 'sales',  'full',   '2024-08-15', '081-181-8181', 'sales@maz.co.th'),
  ('E20', 'สมหญิง',   'ไร้บัญชี', 'หญิง',  'ญ', 'maid',   'probat', '2026-02-01', '081-202-0202', '')
on conflict (emp_no) do nothing;

/* หัวหน้า — GM ดูแลทุกคน ยกเว้น CEO */
update public.employees set boss_id = (select id from public.employees where emp_no = 'E11')
 where emp_no in ('E05', 'E10', 'E12', 'E15', 'E18', 'E20');

/* เงินเดือนตั้งต้น — ใช้เป็นฐานตอนคำนวณ */
insert into public.salary_steps (employee_id, effective, position, salary, note)
select id, started_at, position,
       case position when 'ceo' then 120000 when 'gm' then 60000 when 'hr' then 32000
                     when 'pm' then 38000 when 'sales' then 25000 when 'maid' then 12000
                     else 18000 end,
       'เงินเดือนตั้งต้นของข้อมูลทดสอบ'
  from public.employees
on conflict do nothing;

/* วันหยุดสิ้นปี พอให้มีข้อมูลทดสอบ */
insert into public.holidays (on_date, name) values
  ('2026-12-10', 'วันรัฐธรรมนูญ'),
  ('2026-12-31', 'วันสิ้นปี'),
  ('2027-01-01', 'วันขึ้นปีใหม่')
on conflict (on_date) do nothing;
