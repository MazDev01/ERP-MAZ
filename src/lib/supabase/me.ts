"use client";

import { signedIn, supabase } from "./client";
import type { EmpType } from "../hr-data";
import type { Role } from "../role";

/*
 * "ฉันเป็นใคร" จากฐานข้อมูล
 *
 * ของเดิมหน้าจออ่านชื่อ ตำแหน่ง และฝ่ายจากข้อมูลจำลองรายบทบาท (USERS / HR_EMP)
 * ซึ่งไม่ใช่คนที่ล็อกอินอยู่จริง — ล็อกอินเป็น ปวีณา แล้วแถบหัวขึ้นชื่อคนอื่นก็เคยเจอ
 *
 * ที่นี่ถามฐานข้อมูลตรง ๆ ว่าบัญชีนี้คือใคร แล้วแปลงให้หน้าจอใช้ต่อ
 * บัญชีที่ไม่ใช่พนักงาน (ผู้บริหาร) ไม่มีแถวในทะเบียน จึงได้แต่ชื่อที่ตั้งไว้ที่บัญชี
 * ไม่มีตำแหน่ง ฝ่าย หรือวันเริ่มงาน — ถูกแล้ว เพราะไม่ใช่พนักงานของบริษัท
 */

export type Me = {
  /** รหัสพนักงาน — ว่างคือบัญชีนี้ไม่ใช่พนักงานในทะเบียน */
  empNo: string;
  name: string;
  nick: string;
  username: string;
  roles: Role[];
  /** ตำแหน่งงานของฝ่ายบุคคล (PosKey) — ว่างคือไม่ใช่พนักงาน */
  pos: string;
  /** ชื่อหัวหน้าพร้อมตำแหน่ง — ว่างคือไม่มีหัวหน้าหรือยังไม่รู้ */
  bossName: string;
  bossPos: string;
  startDate: string;
  type: EmpType | null;
  email: string;
  phone: string;
  birth: string;
};

type AccRow = {
  username: string;
  display_name: string;
  roles: string[] | null;
  employee_id: string | null;
};

type EmpRow = {
  emp_no: string | null;
  first_name: string;
  last_name: string;
  nick: string;
  pos_key: string;
  position: string;
  emp_type: EmpType;
  started_at: string;
  email: string;
  phone: string;
  birth: string | null;
  boss: { first_name: string; last_name: string; pos_key: string; position: string } | null;
};

let cache: Me | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

export function subscribeMe(onChange: () => void) {
  watchers.add(onChange);
  return () => watchers.delete(onChange);
}

/** ค่าที่อ่านได้ตอนนี้ — null คือยังไม่รู้ (กำลังโหลด หรือยังไม่ล็อกอิน) */
export function meNow(): Me | null {
  return cache;
}

export function forgetMe() {
  cache = null;
  loading = false;
}

/** สั่งอ่าน "ฉันเป็นใคร" — เรียกซ้ำได้ ยิงจริงครั้งเดียว */
export function loadMe() {
  if (loading || cache !== null) return;
  loading = true;
  void fetchMe()
    .then((got) => {
      cache = got;
    })
    .catch(() => {
      /* อ่านไม่ได้ก็ปล่อยให้หน้าจอใช้ค่าตั้งต้นไปก่อน ไม่วนยิงใหม่ไม่จบ */
      cache = null;
    })
    .finally(() => {
      loading = false;
      tell();
    });
}

async function fetchMe(): Promise<Me | null> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return null;

  /* ต้องระบุผู้ใช้เอง — ฝ่ายบุคคลอ่านบัญชีของทุกคนได้ (RLS) ถ้าไม่ระบุจะได้หลายแถว
     แล้ว maybeSingle() จะผิดพลาด ทำให้ "ฉันเป็นใคร" ว่างเปล่าทั้งที่ล็อกอินอยู่ */
  const { data: who } = await sb.auth.getUser();
  const uid = who.user?.id;
  if (!uid) return null;

  const { data: acc } = await sb
    .from("user_accounts")
    .select("username, display_name, roles, employee_id")
    .eq("user_id", uid)
    .maybeSingle();
  const a = acc as AccRow | null;
  if (!a) return null;

  const base: Me = {
    empNo: "",
    name: a.display_name || a.username,
    nick: "",
    username: a.username,
    roles: (a.roles ?? []) as Role[],
    pos: "",
    bossName: "",
    bossPos: "",
    startDate: "",
    type: null,
    email: "",
    phone: "",
    birth: "",
  };
  if (!a.employee_id) return base;

  const { data: emp } = await sb
    .from("employees")
    .select(
      "emp_no, first_name, last_name, nick, pos_key, position, emp_type, started_at, email, phone, birth," +
        " boss:boss_id (first_name, last_name, pos_key, position)",
    )
    .eq("id", a.employee_id)
    .maybeSingle();
  const e = emp as unknown as EmpRow | null;
  if (!e) return base;

  const boss = Array.isArray(e.boss) ? e.boss[0] : e.boss;
  return {
    ...base,
    empNo: e.emp_no ?? "",
    name: [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || base.name,
    nick: e.nick,
    pos: e.pos_key || e.position,
    bossName: boss ? [boss.first_name, boss.last_name].filter(Boolean).join(" ").trim() : "",
    bossPos: boss ? boss.pos_key || boss.position : "",
    startDate: e.started_at,
    type: e.emp_type,
    email: e.email,
    phone: e.phone,
    birth: e.birth ?? "",
  };
}
