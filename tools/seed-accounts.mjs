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

/* ใครได้บทบาทอะไร — E20 ตั้งใจไม่ให้บัญชี ไว้ทดสอบการยื่นแทนทีมงานที่ไม่มีบัญชี */
const WHO = {
  E01: { user: "กร", roles: ["ceo"] },
  E05: { user: "กมล", roles: ["staff"] },
  E10: { user: "กานต์", roles: ["pm"] },
  E11: { user: "เสริฐ", roles: ["gm"] },
  E12: { user: "ปวีณา", roles: ["hr"] },
  E15: { user: "มา", roles: ["maid"] },
  E18: { user: "ชิดา", roles: ["sales"] },
};

const { data: emps, error } = await admin.from("employees").select("id, emp_no");
if (error) {
  console.error("อ่านรายชื่อพนักงานไม่ได้:", error.message);
  process.exit(1);
}

for (const emp of emps) {
  const who = WHO[emp.emp_no];
  if (!who) {
    console.log(`ข้าม   ${emp.emp_no} — ตั้งใจไม่ให้มีบัญชี`);
    continue;
  }
  const { data: has } = await admin
    .from("user_accounts")
    .select("user_id")
    .eq("employee_id", emp.id)
    .maybeSingle();
  if (has) {
    console.log(`มีแล้ว ${emp.emp_no} (${who.user})`);
    continue;
  }

  const email = `${emp.emp_no.toLowerCase()}@maz.local`;
  const { data: created, error: eUser } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (eUser) {
    console.error(`พลาด  ${emp.emp_no}: ${eUser.message}`);
    continue;
  }

  const { error: eLink } = await admin.from("user_accounts").insert({
    user_id: created.user.id,
    employee_id: emp.id,
    username: who.user,
    roles: who.roles,
    must_change_password: false,
  });
  if (eLink) {
    await admin.auth.admin.deleteUser(created.user.id);
    console.error(`พลาด  ${emp.emp_no}: ${eLink.message}`);
    continue;
  }
  console.log(`สร้าง  ${emp.emp_no} · ${who.user} · ${who.roles.join(",")} · ${email}`);
}

console.log(`\nทุกบัญชีใช้รหัสผ่าน ${PASSWORD}`);
