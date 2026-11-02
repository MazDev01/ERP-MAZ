-- ข้อมูลตั้งต้นสำหรับเครื่องพัฒนา — รันอัตโนมัติท้าย npx supabase db reset
-- ไม่ใช่ข้อมูลจริง ห้ามใช้บนโครงการคลาวด์ (ขึ้นคลาวด์ด้วย supabase db push ซึ่งไม่รันไฟล์นี้)
--
-- สร้างเฉพาะ "พนักงาน" กับค่าตั้งต้น ส่วน "บัญชีเข้าระบบ" สร้างไม่ได้จากที่นี่
-- เพราะผู้ใช้อยู่ในระบบ auth ของ Supabase ต้องสร้างผ่าน Admin API
-- ใช้สคริปต์ tools/seed-accounts.mjs แทน
--
-- โครงของทะเบียน (เจ้าของสั่ง 2 พ.ย. 2569)
--   บัญชีเข้าระบบ ≠ พนักงาน — ผู้บริหารมีบัญชีแต่ไม่มีแถวในทะเบียนนี้
--   จึงไม่โผล่ในลงเวลา การลา รอบเงินเดือน หรือรายชื่อผู้รับงาน
--   รหัสพนักงาน (emp_no) เป็นแค่รหัสให้คนอ่าน กุญแจจริงคือ id ที่ฐานข้อมูลออกให้

-- ─── พนักงานจริง ──────────────────────────────────────────────────
/* หกคนนี้มีบัญชีเข้าระบบ (ดู tools/seed-accounts.mjs) · ไม่ติดธงทดสอบ */
insert into public.employees (emp_no, first_name, last_name, nick, sex, position, pos_key, emp_type, started_at, phone, email) values
  ('E05', 'กมลชนก',   'พูนสุข',   'กมล',   'หญิง', 'staff', 'website', 'full', '2025-01-06', '081-555-5555', 'staff@maz.co.th'),
  ('E10', 'ชนิกานต์', 'วัฒนกุล',  'กานต์', 'หญิง', 'pm',    'pm',      'full', '2024-02-01', '081-010-1010', 'pm@maz.co.th'),
  ('E11', 'ประเสริฐ', 'มั่นคงดี', 'เสริฐ', 'ชาย',  'gm',    'gm',      'full', '2023-05-01', '081-111-0011', 'gm@maz.co.th'),
  ('E12', 'ปวีณา',    'ศรีสุข',   'ปวีณา', 'หญิง', 'hr',    'hr',      'full', '2024-03-01', '081-121-2121', 'hr@maz.co.th'),
  ('E15', 'บุญมา',    'สะอาด',    'มา',    'หญิง', 'maid',  'maid',    'full', '2025-06-01', '081-515-1515', ''),
  ('E18', 'ชนัญชิดา', 'ใจดี',     'ชิดา',  'หญิง', 'sales', 'sales',   'full', '2024-08-15', '081-181-8181', 'sales@maz.co.th')
on conflict (emp_no) do nothing;

/* หัวหน้า — ผู้จัดการทั่วไปดูแลทุกคน */
update public.employees set boss_id = (select id from public.employees where emp_no = 'E11')
 where emp_no in ('E05', 'E10', 'E12', 'E15', 'E18');

/* เงินเดือนตั้งต้นของคนจริง */
insert into public.salary_steps (employee_id, effective, position, salary, note)
select id, started_at, pos_key,
       case position when 'gm' then 60000 when 'hr' then 32000 when 'pm' then 38000
                     when 'sales' then 25000 when 'maid' then 12000 else 18000 end,
       'เงินเดือนตั้งต้นของข้อมูลทดสอบ'
  from public.employees where emp_no in ('E05', 'E10', 'E11', 'E12', 'E15', 'E18')
on conflict do nothing;

-- ─── ชุดข้อมูลทดสอบ ───────────────────────────────────────────────
/*
 * ทะเบียนจำลองที่เคยอยู่ในหน้าจอ (HR_EMP) ย้ายมาเป็นข้อมูลของฐานข้อมูลแล้ว
 * รหัสคนละชุด (T01–T19) ไม่ชนกับคนจริง และทุกแถวติดธง is_demo
 * ห้ามรันไฟล์นี้บนฐานข้อมูลจริง — ธงนี้มีไว้ให้ลบทิ้งได้ทีเดียวถ้าหลุดไป
 *   delete from public.employees where is_demo;
 */
/* ชุดข้อมูลทดสอบ 19 คน — รหัส T01–T19 ติดธง is_demo */
insert into public.employees (emp_no, first_name, last_name, nick, sex, birth, position, pos_key,
                             emp_type, status, started_at, left_at, left_why, phone, email,
                             edu, exp, address, sos, docs, is_demo) values
  ('T01', 'ปิยะวัฒน์', 'แก้วใส', 'ปุ๊ก', 'ชาย', '1994-03-18', 'ps', 'sa', 'full', 'active', '2022-06-01', null, '', '081-330-4471', 'piyawat.k@example.com', 'วท.บ. วิทยาการคอมพิวเตอร์ มหาวิทยาลัยเชียงใหม่', array['นักวิเคราะห์ระบบ บริษัทซอฟต์แวร์เฮาส์ 2 ปี']::text[], '99/12 ต.ช้างเผือก อ.เมือง จ.เชียงใหม่ 50300', '{"name":"สมพร แก้วใส","rel":"มารดา","phone":"089-441-0012"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'license']::text[], true),
  ('T02', 'ณิชา', 'วงศ์อารีย์', 'ใบเตย', 'หญิง', '1997-11-02', 'staff', 'graphic', 'full', 'active', '2023-02-16', null, '', '086-224-7781', 'nicha.w@example.com', 'ศป.บ. ออกแบบนิเทศศิลป์ มหาวิทยาลัยศิลปากร', array['กราฟิกดีไซเนอร์ เอเจนซี่โฆษณา 1 ปี']::text[], '45 ซอยนิมมานเหมินท์ 11 ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200', '{"name":"ประภา วงศ์อารีย์","rel":"มารดา","phone":"081-556-2290"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'work']::text[], true),
  ('T03', 'ธนกฤต', 'ศรีบุญเรือง', 'กฤต', 'ชาย', '1998-07-25', 'staff', 'website', 'full', 'active', '2023-08-01', null, '', '089-117-3320', 'thanakrit.s@example.com', 'วท.บ. เทคโนโลยีสารสนเทศ มหาวิทยาลัยแม่โจ้', array[]::text[], '12/5 ต.หนองหอย อ.เมือง จ.เชียงใหม่ 50000', '{"name":"วิไล ศรีบุญเรือง","rel":"มารดา","phone":"084-229-1187"}', array['idcard', 'house', 'degree', 'photo', 'resume']::text[], true),
  ('T04', 'อรรถพล', 'ใจกล้า', 'พล', 'ชาย', '1993-01-09', 'staff', 'dev', 'full', 'active', '2021-11-15', null, '', '082-449-6612', 'atthaphon.j@example.com', 'วศ.บ. วิศวกรรมคอมพิวเตอร์ มหาวิทยาลัยเชียงใหม่', array['โปรแกรมเมอร์ บริษัทระบบคลังสินค้า 3 ปี']::text[], '188 ต.ท่าศาลา อ.เมือง จ.เชียงใหม่ 50000', '{"name":"ศิริพร ใจกล้า","rel":"ภรรยา","phone":"088-330-7745"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'license', 'cert']::text[], true),
  ('T05', 'กมลชนก', 'พูนสุข', 'มายด์', 'หญิง', '1999-05-14', 'staff', 'website', 'full', 'active', '2024-03-01', null, '', '087-556-2214', 'kamonchanok.p@example.com', 'วท.บ. เทคโนโลยีสารสนเทศ มหาวิทยาลัยพะเยา', array[]::text[], '77/3 ต.สันผีเสื้อ อ.เมือง จ.เชียงใหม่ 50300', '{"name":"อนันต์ พูนสุข","rel":"บิดา","phone":"081-990-3312"}', array['idcard', 'house', 'degree', 'photo', 'resume']::text[], true),
  ('T06', 'ศุภณัฐ', 'ทองแท้', 'บอส', 'ชาย', '1996-09-30', 'staff', 'dev', 'full', 'active', '2022-01-10', null, '', '085-119-8834', 'supanat.t@example.com', 'วท.บ. วิทยาการคอมพิวเตอร์ มหาวิทยาลัยแม่โจ้', array['โปรแกรมเมอร์ ฟรีแลนซ์ 2 ปี']::text[], '30 หมู่ 6 ต.สันทรายน้อย อ.สันทราย จ.เชียงใหม่ 50210', '{"name":"จันทร์เพ็ญ ทองแท้","rel":"มารดา","phone":"086-773-2201"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'license']::text[], true),
  ('T07', 'พิมพ์ชนก', 'ดีงาม', 'ฟ้า', 'หญิง', '2000-02-11', 'staff', 'content', 'full', 'active', '2024-07-01', null, '', '090-334-1129', 'pimchanok.d@example.com', 'นศ.บ. นิเทศศาสตร์ มหาวิทยาลัยเชียงใหม่', array[]::text[], '5/9 ต.ป่าแดด อ.เมือง จ.เชียงใหม่ 50100', '{"name":"สมชาย ดีงาม","rel":"บิดา","phone":"081-224-9987"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'work']::text[], true),
  ('T08', 'วรากร', 'สุขเสมอ', 'กร', 'ชาย', '1995-12-05', 'ps', 'sa', 'full', 'active', '2023-05-02', null, '', '083-667-4410', 'warakorn.s@example.com', 'วท.บ. เทคโนโลยีสารสนเทศ มหาวิทยาลัยราชภัฏเชียงใหม่', array['ผู้ทดสอบระบบ บริษัทซอฟต์แวร์ 2 ปี']::text[], '220 ต.แม่เหียะ อ.เมือง จ.เชียงใหม่ 50100', '{"name":"นงลักษณ์ สุขเสมอ","rel":"มารดา","phone":"089-114-5523"}', array['idcard', 'house', 'degree', 'photo', 'resume']::text[], true),
  ('T09', 'ธีรวัฒน์', 'ศรีสมบูรณ์', 'วัฒน์', 'ชาย', '1994-08-22', 'staff', 'media', 'full', 'active', '2023-01-16', null, '', '084-229-7756', 'teerawat.s@example.com', 'บธ.บ. การตลาด มหาวิทยาลัยเชียงใหม่', array['Media planner เอเจนซี่ดิจิทัล 3 ปี']::text[], '61 ต.ฟ้าฮ่าม อ.เมือง จ.เชียงใหม่ 50000', '{"name":"พรทิพย์ ศรีสมบูรณ์","rel":"ภรรยา","phone":"081-447-2230"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'license', 'cert']::text[], true),
  ('T10', 'ชนิกานต์', 'วัฒนกุล', 'แนน', 'หญิง', '1992-04-07', 'pm', 'pm', 'full', 'active', '2021-03-01', null, '', '081-556-9902', 'chanikan.w@example.com', 'บธ.บ. บริหารธุรกิจ มหาวิทยาลัยธรรมศาสตร์', array['Account Executive เอเจนซี่โฆษณา 4 ปี']::text[], '150/8 ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200', '{"name":"ธนากร วัฒนกุล","rel":"สามี","phone":"086-119-4478"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'license']::text[], true),
  ('T11', 'ประเสริฐ', 'มั่นคงดี', 'เสริฐ', 'ชาย', '1985-10-19', 'gm', 'gm', 'full', 'active', '2019-05-01', null, '', '081-889-2211', 'prasert.m@example.com', 'บธ.ม. บริหารธุรกิจ มหาวิทยาลัยเชียงใหม่', array['ผู้จัดการฝ่ายการตลาด บริษัทค้าปลีก 6 ปี']::text[], '9/1 ต.ช้างคลาน อ.เมือง จ.เชียงใหม่ 50100', '{"name":"มาลี มั่นคงดี","rel":"ภรรยา","phone":"089-556-1123"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'license', 'cert']::text[], true),
  ('T12', 'อรอนงค์', 'พรหมมา', 'อร', 'หญิง', '1990-06-28', 'hr', 'hr', 'full', 'active', '2020-09-01', null, '', '088-224-3390', 'ornanong.p@example.com', 'บช.บ. การบัญชี มหาวิทยาลัยพายัพ', array['เจ้าหน้าที่บัญชี สำนักงานบัญชี 3 ปี']::text[], '33 ต.วัดเกต อ.เมือง จ.เชียงใหม่ 50000', '{"name":"บุญส่ง พรหมมา","rel":"บิดา","phone":"081-330-2214"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'cert']::text[], true),
  ('T13', 'สุนิสา', 'ทรัพย์มั่น', 'นิด', 'หญิง', '1992-02-09', 'acc', 'acc', 'full', 'active', '2021-07-01', null, '', '086-551-7742', 'sunisa.s@example.com', 'บช.บ. การบัญชี มหาวิทยาลัยเชียงใหม่', array['เจ้าหน้าที่บัญชี สำนักงานบัญชี 4 ปี']::text[], '58/4 ต.ป่าแดด อ.เมือง จ.เชียงใหม่ 50100', '{"name":"สมบัติ ทรัพย์มั่น","rel":"บิดา","phone":"081-993-2210"}', array['idcard', 'house', 'degree', 'photo', 'resume']::text[], true),
  ('T14', 'ชนัญชิดา', 'ใจดี', 'ชญ', 'หญิง', '1995-06-12', 'sales', 'sales', 'full', 'active', '2023-02-01', null, '', '089-556-1120', 'chananchida.j@example.com', 'บธ.บ. การตลาด มหาวิทยาลัยพายัพ', array['พนักงานขาย บริษัทโฆษณา 3 ปี']::text[], '55/9 ต.ช้างเผือก อ.เมือง จ.เชียงใหม่ 50300', '{"name":"สมพร ใจดี","rel":"มารดา","phone":"089-556-1121"}', array['idcard', 'house', 'degree', 'photo', 'resume']::text[], true),
  ('T15', 'ธนดล', 'เกียรติศักดิ์', 'ดล', 'ชาย', '1991-02-14', 'ps', 'bd', 'full', 'active', '2022-04-01', null, '', '086-441-7789', 'thanadol.k@example.com', 'บธ.บ. การจัดการ มหาวิทยาลัยเชียงใหม่', array['ผู้แทนขาย บริษัทซอฟต์แวร์ 4 ปี']::text[], '71/4 ต.หายยา อ.เมือง จ.เชียงใหม่ 50100', '{"name":"สุนีย์ เกียรติศักดิ์","rel":"มารดา","phone":"084-119-8823"}', array['idcard', 'house', 'degree', 'photo', 'resume', 'license']::text[], true),
  ('T16', 'ณัฐริกา', 'ใจอารีย์', 'ริกา', 'หญิง', '2003-01-20', 'staff', 'graphic', 'intern', 'active', '2026-06-01', null, '', '092-556-1140', 'nattarika.j@example.com', 'กำลังศึกษา ศป.บ. ออกแบบนิเทศศิลป์ มหาวิทยาลัยเชียงใหม่ ชั้นปีที่ 4', array[]::text[], '18 ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200', '{"name":"วีระ ใจอารีย์","rel":"บิดา","phone":"087-224-6612"}', array['idcard', 'photo', 'resume']::text[], true),
  ('T17', 'บุญเรือน', 'สายทอง', 'ป้าเรือน', 'หญิง', '1974-07-03', 'maid', 'maid', 'full', 'active', '2019-08-01', null, '', '080-114-2290', '', 'มัธยมศึกษาตอนต้น', array[]::text[], '104 ต.ป่าตัน อ.เมือง จ.เชียงใหม่ 50300', '{"name":"ประยูร สายทอง","rel":"สามี","phone":"080-114-2291"}', array['idcard', 'house', 'photo']::text[], true),
  ('T18', 'ภัทรพล', 'คำมูล', 'ต้น', 'ชาย', '1999-10-08', 'staff', 'website', 'probat', 'active', '2026-07-15', null, '', '091-224-8830', 'pattarapon.k@example.com', 'วท.บ. วิทยาการคอมพิวเตอร์ มหาวิทยาลัยราชภัฏเชียงใหม่', array['นักพัฒนาเว็บ ฟรีแลนซ์ 1 ปี']::text[], '88 ต.ช้างเผือก อ.เมือง จ.เชียงใหม่ 50300', '{"name":"สมหมาย คำมูล","rel":"บิดา","phone":"089-117-2245"}', array['idcard', 'house', 'degree', 'photo', 'resume']::text[], true),
  ('T19', 'สิทธิชัย', 'รุ่งเรือง', 'ชัย', 'ชาย', '1996-03-12', 'staff', 'content', 'full', 'left', '2023-03-01', '2026-05-31', 'ลาออก ย้ายกลับภูมิลำเนา', '089-441-0098', 'sitthichai.r@example.com', 'นศ.บ. นิเทศศาสตร์ มหาวิทยาลัยราชภัฏเชียงใหม่', array['ครีเอทีฟคอนเทนต์ เอเจนซี่ 1 ปี']::text[], '56 ต.สันกลาง อ.สันกำแพง จ.เชียงใหม่ 50130', '{"name":"อารีย์ รุ่งเรือง","rel":"มารดา","phone":"081-556-3341"}', array['idcard', 'house', 'degree', 'photo', 'resume']::text[], true)
on conflict (emp_no) do nothing;

/* หัวหน้าของชุดทดสอบ */
update public.employees set boss_id = (select id from public.employees where emp_no = 'T11')
 where emp_no in ('T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T12', 'T13', 'T14', 'T15', 'T16', 'T18', 'T19');
update public.employees set boss_id = (select id from public.employees where emp_no = 'T12')
 where emp_no in ('T17');

/* ประวัติตำแหน่งและเงินเดือนของชุดทดสอบ */
insert into public.salary_steps (employee_id, effective, position, salary, note) values
  ((select id from public.employees where emp_no = 'T01'), '2022-06-01', 'sa', 24000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T01'), '2022-09-01', 'sa', 26000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T01'), '2025-01-01', 'sa', 32000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T02'), '2023-02-16', 'graphic', 20000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T02'), '2023-05-16', 'graphic', 22000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T03'), '2023-08-01', 'website', 18000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T03'), '2023-11-01', 'website', 20000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T03'), '2025-01-01', 'website', 23000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T04'), '2021-11-15', 'dev', 26000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T04'), '2022-02-15', 'dev', 28000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T04'), '2024-01-01', 'dev', 33000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T04'), '2025-01-01', 'dev', 36000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T05'), '2024-03-01', 'website', 19000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T05'), '2024-06-01', 'website', 21000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T06'), '2022-01-10', 'dev', 23000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T06'), '2022-04-10', 'dev', 25000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T06'), '2025-01-01', 'dev', 31000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T07'), '2024-07-01', 'content', 18000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T07'), '2024-10-01', 'content', 20000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T08'), '2023-05-02', 'sa', 22000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T08'), '2023-08-02', 'sa', 24000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T08'), '2025-01-01', 'sa', 27000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T09'), '2023-01-16', 'media', 25000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T09'), '2023-04-16', 'media', 27000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T09'), '2025-01-01', 'media', 30000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T10'), '2021-03-01', 'pm', 28000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T10'), '2021-06-01', 'pm', 30000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T10'), '2024-01-01', 'pm', 34000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T10'), '2025-01-01', 'pm', 38000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T11'), '2019-05-01', 'gm', 45000, 'เริ่มงาน'),
  ((select id from public.employees where emp_no = 'T11'), '2024-01-01', 'gm', 52000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T12'), '2020-09-01', 'acc', 22000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T12'), '2020-12-01', 'acc', 24000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T12'), '2025-01-01', 'hr', 29000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T13'), '2021-07-01', 'acc', 21000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T13'), '2021-10-01', 'acc', 23000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T13'), '2025-01-01', 'acc', 28000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T14'), '2023-02-01', 'sales', 18000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T14'), '2023-05-01', 'sales', 20000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T14'), '2025-01-01', 'sales', 22000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T15'), '2022-04-01', 'bd', 24000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T15'), '2022-07-01', 'bd', 26000, 'ผ่านทดลองงาน'),
  ((select id from public.employees where emp_no = 'T15'), '2025-01-01', 'bd', 30000, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T16'), '2026-06-01', 'graphic', 6000, 'ฝึกงาน 4 เดือน'),
  ((select id from public.employees where emp_no = 'T17'), '2019-08-01', 'maid', 11000, 'เริ่มงาน'),
  ((select id from public.employees where emp_no = 'T17'), '2025-01-01', 'maid', 12500, 'ปรับประจำปี'),
  ((select id from public.employees where emp_no = 'T18'), '2026-07-15', 'website', 19000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T19'), '2023-03-01', 'content', 19000, 'เริ่มงาน ทดลองงาน'),
  ((select id from public.employees where emp_no = 'T19'), '2023-06-01', 'content', 21000, 'ผ่านทดลองงาน');

-- ─── วันหยุด ──────────────────────────────────────────────────────
/* พอให้มีข้อมูลทดสอบ */
insert into public.holidays (on_date, name) values
  ('2026-12-10', 'วันรัฐธรรมนูญ'),
  ('2026-12-31', 'วันสิ้นปี'),
  ('2027-01-01', 'วันขึ้นปีใหม่')
on conflict (on_date) do nothing;
