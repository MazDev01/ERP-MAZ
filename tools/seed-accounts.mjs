/*
 * สร้างบัญชีเข้าระบบให้พนักงานในข้อมูลทดสอบ — เครื่องพัฒนาเท่านั้น
 *
 * seed.sql สร้างบัญชีไม่ได้ เพราะผู้ใช้อยู่ในระบบ auth ของ Supabase
 * ต้องเรียกผ่าน Admin API สคริปต์นี้จึงทำต่อให้หลัง db reset
 *
 *   node tools/seed-accounts.mjs
 *
 * อ่านค่าจาก .env.local · ทุกบัญชีใช้รหัส maz1234 และไม่บังคับตั้งรหัสใหม่
 * เพื่อให้ล็อกอินทดสอบได้ทันที
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("ไม่พบค่าใน .env.local — ต้องมี NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
const PASSWORD = "maz1234";

/*
 * ใครได้บัญชีอะไร
 *
 * emp ว่าง = บัญชีที่ไม่ใช่พนักงานในทะเบียน (ผู้บริหาร) ตามที่เจ้าของสั่ง 2 พ.ย. 2569
 * ผู้บริหารจึงไม่โผล่ในลงเวลา การลา รอบเงินเดือน หรือรายชื่อผู้รับงาน
 * mail เป็นอีเมลแฝงสำหรับระบบ auth เท่านั้น ผู้ใช้ล็อกอินด้วยชื่อผู้ใช้
 * ส่วนคนในชุดทดสอบ (T01–T19) ตั้งใจไม่ให้มีบัญชี ไว้ทดสอบการยื่นใบแทน
 */
const WHO = [
  { user: "กร", roles: ["ceo"], emp: null, mail: "ceo@maz.local" },
  { user: "กมล", roles: ["staff"], emp: "E05" },
  { user: "กานต์", roles: ["pm"], emp: "E10" },
  { user: "เสริฐ", roles: ["gm"], emp: "E11" },
  { user: "ปวีณา", roles: ["hr"], emp: "E12" },
  { user: "มา", roles: ["maid"], emp: "E15" },
  { user: "ชิดา", roles: ["sales"], emp: "E18" },
];

const { data: emps, error } = await admin.from("employees").select("id, emp_no");
if (error) {
  console.error("อ่านรายชื่อพนักงานไม่ได้:", error.message);
  process.exit(1);
}
const idOf = new Map((emps ?? []).map((e) => [e.emp_no, e.id]));

for (const who of WHO) {
  const label = who.emp ?? "— ไม่ใช่พนักงาน";
  const empId = who.emp ? idOf.get(who.emp) : null;
  if (who.emp && !empId) {
    console.error(`พลาด  ${who.user}: ไม่พบพนักงาน ${who.emp} ในทะเบียน`);
    continue;
  }

  const { data: has } = await admin
    .from("user_accounts")
    .select("user_id")
    .ilike("username", who.user)
    .maybeSingle();
  if (has) {
    console.log(`มีแล้ว ${who.user} (${label})`);
    continue;
  }

  const email = who.mail ?? `${who.emp.toLowerCase()}@maz.local`;
  const { data: created, error: eUser } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (eUser) {
    console.error(`พลาด  ${who.user}: ${eUser.message}`);
    continue;
  }

  const { error: eLink } = await admin.from("user_accounts").insert({
    user_id: created.user.id,
    employee_id: empId,
    username: who.user,
    roles: who.roles,
    must_change_password: false,
  });
  if (eLink) {
    await admin.auth.admin.deleteUser(created.user.id);
    console.error(`พลาด  ${who.user}: ${eLink.message}`);
    continue;
  }
  console.log(`สร้าง  ${who.user} · ${who.roles.join(",")} · ${label} · ${email}`);
}

console.log(`\nทุกบัญชีใช้รหัสผ่าน ${PASSWORD}`);
