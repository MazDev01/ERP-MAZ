"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { AccountLocked, type LockReason } from "./account-locked";
import { LoginScene } from "./login-scene";
import { DownloadIcon, EyeIcon, EyeOffIcon } from "./icons";
import { homeOf, navItems } from "@/lib/nav";
import { accountKey, accountOf, markLogin } from "@/lib/accounts";
import { useHr } from "@/lib/hr-store";
import { accountRoles } from "@/lib/hr-data";
import { bkkStamp } from "@/lib/format";
import { ROLES, setRole, useRole, type Role } from "@/lib/role";
import { setStaffEmployee, staffEmployeeId, staffLabel, staffTeam } from "@/lib/staff-identity";
import { HR_EMPTYPE } from "@/lib/hr-data";
import { Select } from "./ui";

/** ผิดครบกี่ครั้งจึงระงับบัญชี — ยืนยันกับฝ่ายบุคคล (ต้นแบบ login.html MAX_TRIES) */
const MAX_TRIES = 5;

/** ชื่อผู้ใช้ที่จดจำไว้บนเครื่องนี้ — ไม่เก็บรหัสผ่าน */
const REMEMBER_KEY = "maz-erp.remember-user.v1";
/** รหัสผ่านเดโม — ยังไม่มี auth จริง ทุกบัญชีใช้รหัสนี้ (ต้นแบบ login.html)
    TODO: แทนที่ด้วย supabase.auth.signInWithPassword เมื่อต่อหลังบ้าน */
const DEMO_PASSWORD = "maz1234";
const MSG_USER = "กรอกชื่อผู้ใช้ที่ฝ่ายบุคคลกำหนดให้";
const MSG_PASS = "กรอกรหัสผ่าน";

/* ชื่อผู้ใช้สองตัวนี้เอาไว้ดูหน้าจอบัญชีถูกระงับโดยไม่ต้องรอหลังบ้าน
   TODO: ให้เซิร์ฟเวอร์เป็นคนบอกสถานะบัญชีเมื่อต่อ auth แล้ว */
const DEMO_LOCK: Record<string, LockReason> = {
  locked: "attempts",
  suspended: "admin",
};

/* หน้าแรกหลังล็อกอิน — ทุกบทบาทที่ตอกบัตรได้เข้าหน้า "เวลาทำงาน" ก่อนเสมอ ทั้งคอมและมือถือ
   (ผู้ใช้สั่ง 22 ก.ย. 2569 "คลิกเข้าครั้งแรกต้องเด้งหน้านี้" — ตอกบัตรก่อนเริ่มงาน)
   CEO กับผู้ดูแลระบบไม่มีหน้าเวลาทำงาน — มือถือ CEO เข้าหน้าหลัก คอมเข้าเมนูแรก */
function homeAfterLogin(r: Role) {
  const items = navItems(r);
  /* มือถือเข้าหน้าหลักการ์ดเมนูก่อนทุกบทบาท (ผู้ใช้สั่ง 22 ก.ย. 2569 ทับกติกาเดิมเฉพาะบนมือถือ)
     ตอกบัตรกดจากการ์ด "เวลาทำงาน" */
  const phone = window.matchMedia?.("(max-width:640px)").matches;
  if (phone) return homeOf(r, undefined, undefined, true);
  if (items.some((i) => i.href === "/")) return "/";
  return items[0]?.href ?? homeOf(r);
}

export function LoginForm() {
  const router = useRouter();
  /* ค่าที่ผู้ใช้พิมพ์เอง — null คือยังไม่แตะ ให้ใช้ชื่อที่จดจำไว้บนเครื่องนี้แทน */
  const [typedUser, setTypedUser] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState<LockReason | null>(null);
  /* สถานะช่องตามต้นแบบ — ช่องแดงพร้อมข้อความใต้ช่อง ข้อความผิดคู่อยู่ใต้ช่องรหัสผ่านช่องเดียว */
  const [badUser, setBadUser] = useState(false);
  const [badPass, setBadPass] = useState(false);
  const [credError, setCredError] = useState("");
  const [fails, setFails] = useState(0);
  /*
   * จดจำอุปกรณ์ (Full Proposal · M11) — เครื่องที่ติ๊กไว้จะเติมชื่อผู้ใช้ให้เองครั้งหน้า
   * เก็บแค่ชื่อผู้ใช้ ไม่เก็บรหัสผ่าน
   * อ่านผ่าน useSyncExternalStore เพราะฝั่งเซิร์ฟเวอร์ไม่มี localStorage — ให้ค่าว่างไปก่อนแล้วค่อยตรงกันตอน hydrate
   */
  const savedUser = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(REMEMBER_KEY) ?? "";
      } catch {
        /* โหมดส่วนตัวหรือปิดที่เก็บข้อมูลไว้ — ถือว่าไม่เคยจดจำ */
        return "";
      }
    },
    () => "",
  );
  const username = typedUser ?? savedUser;
  const [typedRemember, setTypedRemember] = useState<boolean | null>(null);
  const remember = typedRemember ?? Boolean(savedUser);

  function keepDevice(user: string) {
    try {
      if (remember && user) localStorage.setItem(REMEMBER_KEY, user);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* เก็บไม่ได้ก็ไม่เป็นไร ไม่ใช่ส่วนที่ทำให้เข้าระบบไม่ได้ */
    }
  }
  /* ผิดครบ MAX_TRIES ครั้ง — ปุ่มกลายเป็น "บัญชีถูกระงับ" กรอกต่อไม่ได้ (ต้นแบบ lockAccount) */
  const frozen = fails >= MAX_TRIES;
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  /* ยังไม่มี auth จริง บทบาทจึงเป็นสิ่งที่ผู้ใช้เลือกเองตรงนี้
     ตั้งค่าจากที่เลือกไว้ครั้งก่อน จะได้ไม่ต้องเลือกซ้ำทุกครั้ง */
  const savedRole = useRole();
  const hr = useHr();
  const [role, setPick] = useState<Role>(savedRole);
  /* พนักงานมีหลายตำแหน่ง จึงต้องเลือกด้วยว่าจะเข้าเป็นใคร (เจ้าของสั่ง 29 ก.ย. 2569) */
  const [who, setWho] = useState(() => staffEmployeeId());
  /* การ์ดเข้าใช้งานแบบทดลองงาน/ฝึกงาน — หยิบคนแรกของแต่ละประเภทที่ยังทำงานอยู่จากทะเบียนจริง
     ไม่ตั้งรหัสพนักงานตายตัว เพราะฝ่ายบุคคลเพิ่มหรือเปลี่ยนคนได้ */
  const demoTypes = (["probat", "intern"] as const)
    .map((type) => {
      const e = hr.emp.find((x) => x.type === type && x.status === "active" && staffTeam().some((t) => t.id === x.id));
      return e
        ? { id: e.id, name: e.name, label: HR_EMPTYPE[type].label, en: type === "probat" ? "Probation" : "Intern" }
        : null;
    })
    .filter((x) => x !== null);

  function edit(which: "user" | "pass", v: string) {
    if (which === "user") {
      setTypedUser(v);
      setBadUser(false);
    } else {
      setPassword(v);
      setBadPass(false);
    }
    if (!frozen) setCredError("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || frozen) return;
    const user = username.trim();
    /* ไม่กรอกอะไรเลย = เข้าด้วยบทบาทที่เลือกทันที ไม่ต้องใช้รหัส (ผู้ใช้สั่ง 22 ก.ย. 2569 · ยังไม่มีหลังบ้าน)
       กรอกชื่อผู้ใช้เมื่อไร ตรวจรหัสผ่านและนับครั้งที่ผิดตามต้นแบบ login.html */
    if (!user && !password) {
      /* บัญชีเก็บตามคน — พนักงานใช้รหัสของคนที่เลือกไว้ในดรอปดาวน์ */
      const key = accountKey(role, who);
      const account = accountOf(key);
      if (account.suspended) return setLocked("admin");
      if (role === "staff") setStaffEmployee(who);
      setRole(role);
      keepDevice("");
      markLogin(key, bkkStamp());
      setBusy(true);
      /* ไม่ถามตั้งรหัสผ่านใหม่ เพราะทางนี้ไม่ได้ใช้รหัสผ่านเลย */
      router.replace(homeAfterLogin(role));
      return;
    }
    /* ช่องว่างขึ้นแดงพร้อมข้อความ แล้วพาเคอร์เซอร์ไปช่องแรกที่ว่าง */
    const noUser = !user;
    const noPass = !password;
    if (noUser || noPass) {
      setBadUser(noUser);
      setBadPass(noPass);
      setCredError("");
      (noUser ? userRef : passRef).current?.focus();
      return;
    }
    const demo = DEMO_LOCK[user.toLowerCase()];
    if (demo) return setLocked(demo);

    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      if (password !== DEMO_PASSWORD) {
        /* ผิดเป็นคู่ ไม่บอกว่าช่องไหนผิด — ข้อความเดียวใต้ช่องรหัสผ่าน */
        const n = fails + 1;
        setFails(n);
        setPassword("");
        setBadUser(true);
        setBadPass(true);
        if (n >= MAX_TRIES) {
          setCredError("บัญชีถูกระงับการใช้งาน กรุณาติดต่อฝ่ายบุคคล");
          return;
        }
        const left = MAX_TRIES - n;
        setCredError(
          `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง${left <= 2 ? ` — เหลืออีก ${left} ครั้งก่อนบัญชีถูกระงับ` : ""}`,
        );
        passRef.current?.focus();
        return;
      }

      /* ชื่อผู้ใช้ที่ HR สร้างให้ (/hr/accounts) บอกบทบาทของคนนั้น — การ์ดที่เลือกไว้ต้องเป็นบทบาทของเขา
         ไม่งั้นใช้บทบาทแรกของบัญชี · ชื่อที่ไม่อยู่ในทะเบียน (เดโม) ใช้การ์ดที่เลือก */
      const person = hr.emp.find((x) => x.account && x.account.user === user);
      if (person?.account?.status === "suspended") return setLocked("admin");
      const roles = accountRoles(person?.account);
      const r: Role = roles.length && !roles.includes(role) ? roles[0] : role;
      const key = person?.id ?? accountKey(r, who);
      const account = accountOf(key);
      if (!person && account.suspended) return setLocked("admin");
      const mustReset = person ? Boolean(person.account?.mustChange) : account.mustResetPassword;
      setFails(0);
      /* เข้าด้วยชื่อผู้ใช้จริง — คนในทะเบียนใช้รหัสพนักงานของเขา ไม่ใช่ตัวเลือกในดรอปดาวน์ */
      if (r === "staff") setStaffEmployee(person?.id ?? who);
      setRole(r);
      keepDevice(user);
      markLogin(key, bkkStamp());
      setBusy(true);
      router.replace(mustReset ? "/set-password" : homeAfterLogin(r));
    }, 1600);
  }

  return (
    /*
     * โครงหน้าตามไฟล์ตัวอย่าง login-3d-redwhite.html (เจ้าของสั่ง 24 ก.ย. 2569)
     * ซ้ายเป็นแผงแดงไล่เฉดพร้อมภาพ 3 มิติ ขวาเป็นแผ่นขาวมุมโค้งที่วางฟอร์ม
     * จอเล็กแถบแดงขึ้นไปอยู่ด้านบน แล้วแผ่นขาวเลื่อนขึ้นมาทับครึ่งล่าง
     */
    <main className="login-stage">
      <div className="login-card">
        <div className="login-brand">
          {/* เวิร์ดมาร์กสีขาวสำหรับพื้นแดง — โลโก้ไฟล์จริงเป็นสีแดง ใช้บนพื้นนี้ไม่ได้ */}
          <svg viewBox="60 115 1560 410" className="h-[38px] w-auto" role="img" aria-label="MAZ">
            <g fill="none" stroke="#ffffff" strokeWidth="80" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="115,470 115,170 335,355 555,170 555,470" />
              <polyline points="670,470 885,170 1105,470" />
              <polyline points="1215,170 1565,170 1215,470 1565,470" />
            </g>
          </svg>
          <p>งานขาย งานโครงการ และงานบุคคล อยู่ในระบบเดียวกัน</p>
        </div>

        <LoginScene className="login-canvas" />

        <section className="login-sheet">
          <div className="login-body">
          {locked ? (
            <AccountLocked reason={locked} onBack={() => setLocked(null)} />
          ) : (
            <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/maz-logo.png" alt="MAZ" className="mx-auto h-[34px] w-auto" />
          <p className="mt-2.5 mb-4 text-center text-[13.5px] text-muted-foreground">
            เข้าสู่ระบบเพื่อใช้งาน ERP MAZ
          </p>

          <form onSubmit={submit} noValidate>
            {/* บทบาทเปลี่ยนทั้งเมนูซ้ายและหน้างาน จึงต้องเลือกก่อนเข้า */}
            {/* ถูกระงับแล้วปิดแค่ปุ่มเข้าสู่ระบบตาม mockup (lockAccount) — การ์ดบทบาทยังเลือกได้ */}
            <fieldset className="mb-3">
              <legend className="mb-1.5 text-[13px] font-medium text-muted-foreground">
                Sign in as · เข้าใช้งานในตำแหน่ง
              </legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {ROLES.map((r) => {
                  /* การ์ด "พนักงาน" ไม่ติดสว่างตอนเลือกทดลองงาน/ฝึกงานอยู่ ไม่งั้นดูเหมือนเลือกสองใบ */
                  const on = role === r.key && !(r.key === "staff" && demoTypes.some((d) => d.id === who));
                  return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => {
                      setPick(r.key);
                      if (r.key === "staff" && demoTypes.some((d) => d.id === who)) {
                        /* กลับไปเป็นพนักงานประจำคนแรก ไม่ค้างอยู่ที่คนทดลองงาน/ฝึกงานที่เพิ่งเลือก */
                        const normal = staffTeam().find((e) => !demoTypes.some((d) => d.id === e.id));
                        if (normal) setWho(normal.id);
                      }
                    }}
                    aria-pressed={on}
                    className={`rounded-[12px] border px-3 py-[7px] text-left transition-colors ${
                      on
                        ? "border-primary bg-accent text-primary"
                        : "glass-thin hover:border-primary"
                    }`}
                  >
                    {/* ชื่อบทบาทสองภาษา — อังกฤษเป็นหลัก ไทยกำกับ ไม่มีคำอธิบาย */}
                    <b className="block text-[13px] font-semibold">{r.en}</b>
                    <span className="block text-[11.5px] font-medium opacity-75">{r.label}</span>
                  </button>
                  );
                })}
              </div>
              {/* ทดลองงานกับฝึกงานไม่ใช่บทบาทแยก แต่เป็นประเภทการจ้างของ "พนักงาน"
                 กติกาวันลาและสลิปต่างกัน จึงต้องมีทางเข้าไปดูหน้าจอของคนกลุ่มนี้ (เจ้าของสั่ง 1 ต.ค. 2569) */}
              {demoTypes.length > 0 && (
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  {demoTypes.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        setPick("staff");
                        setWho(d.id);
                      }}
                      aria-pressed={role === "staff" && who === d.id}
                      className={`rounded-[12px] border px-3 py-[7px] text-left transition-colors ${
                        role === "staff" && who === d.id
                          ? "border-primary bg-accent text-primary"
                          : "glass-thin hover:border-primary"
                      }`}
                    >
                      <b className="block text-[13px] font-semibold">{d.en}</b>
                      <span className="block text-[11.5px] font-medium opacity-75">
                        {d.label} · {d.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

            {/*
              บทบาท "พนักงาน" มีหลายตำแหน่ง (SA · Dev · Graphic · Content · Website · Media · BD)
              เลือกได้ว่าเข้าเป็นใคร งานที่ได้รับกับตารางงานจะเป็นของคนนั้น (เจ้าของสั่ง 29 ก.ย. 2569)
            */}
            {role === "staff" && (
              <div className="mb-3">
                <label
                  htmlFor="staff-who"
                  className="mb-1.5 block text-[13px] font-medium text-muted-foreground"
                >
                  เข้าเป็นใครในทีม
                </label>
                <Select
                  id="staff-who"
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  className="h-[46px] rounded-[12px]"
                >
                  {staffTeam().map((e) => (
                    <option key={e.id} value={e.id}>
                      {staffLabel(e)}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="mb-2.5">
              {/* ช่องกรอกแบบเส้นใต้ตามต้นแบบ login-3d-redwhite.html — คลิกแล้วเส้นแดงวิ่งออกจากกลาง */}
              <div className={`login-field ${badUser ? "bad" : ""}`}>
                <input
                  ref={userRef}
                  value={username}
                  /* ตาม mockup (.locked .field input): ช่องไม่ถูกปิด แต่เป็นสีจางและคลิกไม่ได้ */
                  className={frozen ? "pointer-events-none" : undefined}
                  style={frozen ? { color: "var(--muted-foreground)" } : undefined}
                  onChange={(e) => edit("user", e.target.value)}
                  autoComplete="username"
                  placeholder="ชื่อผู้ใช้"
                  aria-label="ชื่อผู้ใช้"
                  aria-invalid={badUser}
                  aria-describedby="m-user"
                />
              </div>
              {/* ผิดเป็นคู่ไม่บอกช่องชื่อผู้ใช้ ข้อความไปอยู่ใต้ช่องรหัสผ่านช่องเดียว */}
              {badUser && !credError && (
                <p id="m-user" role="alert" className="mt-1.5 pl-1 text-[12.5px] font-medium text-destructive">
                  {MSG_USER}
                </p>
              )}
            </div>

            <div className="mb-2.5">
              <div className={`login-field ${badPass || credError ? "bad" : ""}`}>
                <input
                  ref={passRef}
                  type={show ? "text" : "password"}
                  value={password}
                  className={frozen ? "pointer-events-none" : undefined}
                  style={frozen ? { color: "var(--muted-foreground)" } : undefined}
                  onChange={(e) => edit("pass", e.target.value)}
                  autoComplete="current-password"
                  placeholder="รหัสผ่าน"
                  aria-label="รหัสผ่าน"
                  aria-invalid={badPass}
                  aria-describedby="m-pass"
                />
                {!frozen && (
                  <button
                    type="button"
                    onClick={() => {
                      setShow((v) => !v);
                      passRef.current?.focus();
                    }}
                    aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    aria-pressed={show}
                    className="-mr-1.5 shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    {show ? (
                      <EyeOffIcon className="size-[21px]" strokeWidth={1.9} />
                    ) : (
                      <EyeIcon className="size-[21px]" strokeWidth={1.9} />
                    )}
                  </button>
                )}
              </div>
              {(credError || badPass) && (
                <p id="m-pass" role="alert" className="mt-1.5 pl-1 text-[12.5px] font-medium text-destructive">
                  {credError || MSG_PASS}
                </p>
              )}
            </div>

            {/* จดจำอุปกรณ์ — เครื่องส่วนตัวจะได้ไม่ต้องพิมพ์ชื่อผู้ใช้ทุกครั้ง */}
            <label className="mt-2.5 flex w-fit cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setTypedRemember(e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              จดจำอุปกรณ์นี้
            </label>

            {/* ทางออกเมื่อเข้าไม่ได้ — ต้องมีให้กดจากหน้านี้ ไม่ใช่รู้ URL เอง */}
            <Link
              href="/set-password"
              className="mt-1 block text-right text-[13px] text-muted-foreground hover:text-primary"
            >
              ลืมรหัสผ่าน?
            </Link>

            <button
              type="submit"
              disabled={busy || frozen}
              className="btn-solid mx-auto mt-3.5 flex h-[48px] w-full items-center justify-center gap-3 rounded-[10px] text-[16px] font-semibold transition-transform active:scale-[0.98] disabled:saturate-50 lg:w-[238px]"
            >
              {frozen ? "บัญชีถูกระงับ" : busy ? "" : "เข้าสู่ระบบ"}
              {busy && (
                <span
                  className="block size-[21px] animate-spin rounded-full border-[2.5px] border-white/30 border-t-white"
                  aria-hidden="true"
                />
              )}
            </button>
          </form>

          <p className="mt-3.5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
            ยังไม่มีระบบหลังบ้าน — เลือกตำแหน่งแล้วกด <b className="font-semibold">เข้าสู่ระบบ</b> ได้เลยโดยไม่ต้องกรอก
            <br />
            ถ้ากรอกชื่อผู้ใช้ รหัสผ่านเดโมคือ <b className="font-semibold">{DEMO_PASSWORD}</b>
            <br />
            พิมพ์ <b className="font-semibold">locked</b> หรือ{" "}
            <b className="font-semibold">suspended</b> เป็นชื่อผู้ใช้ เพื่อดูหน้าบัญชีถูกระงับ
          </p>

          <Link
            href="/install"
            className="mt-2.5 flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-primary"
          >
            <DownloadIcon className="size-4" />
            ติดตั้งลงหน้าจอโฮม
          </Link>
            </>
          )}
          </div>
        </section>
      </div>
    </main>
  );
}
