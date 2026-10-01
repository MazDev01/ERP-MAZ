"use client";

/*
 * แถบเมนูล่างบนมือถือ — ฝ่ายบุคคลตั้งให้แต่ละบทบาทที่หน้าตั้งค่าระบบ
 * (ย้ายมาจากหน้าโปรไฟล์ของแต่ละคน ตามที่เจ้าของสั่ง 1 ต.ค. 2569 — ให้ตั้งที่เดียวพอ)
 * ปุ่มกลางเป็น "ลงเวลา" เสมอ เลือกได้อีกสี่ช่อง เก็บที่ botnav-prefs รายบทบาท
 */

import { useState } from "react";
import {
  BOTNAV_SLOTS,
  botnavChoices,
  botnavDefault,
  botnavOf,
  resetBotnav,
  setBotnav,
  useBotnavPrefs,
} from "@/lib/botnav-prefs";
import { navItemsOf, useMenuAccess } from "@/lib/nav";
import { ROLES, useApprovalRoute, type Role } from "@/lib/role";
import { ICONS } from "./app-shell";
import { ClockIcon, HomeIcon } from "./icons";
import { Select } from "./ui";

export function AdminBotnavPage() {
  /* ฝ่ายบุคคลตั้งให้ทีละบทบาท — เลือกบทบาทที่จะตั้งค่าก่อน แล้วค่อยเลือกหน้า */
  const [role, setRole] = useState<Role>("sales");
  const access = useMenuAccess();
  const route = useApprovalRoute();
  /* ประเภทการจ้างตัดเมนู "ของฉัน" เหมือนแถบซ้าย (เจ้าของสั่ง 30 ก.ย. 2569) */
  const items = navItemsOf([role], access, route, "full");
  const prefs = useBotnavPrefs();
  const choices = botnavChoices(items, role);
  const current = botnavOf(prefs, role) ?? botnavDefault(items, role);
  const changed = botnavOf(prefs, role) !== null;
  const used = current.filter(Boolean);
  const full = used.length >= BOTNAV_SLOTS;

  /*
   * กดครั้งเดียวจบ (เจ้าของสั่ง 25 ก.ย. 2569 ให้ใช้ง่าย)
   * กดหน้าที่ยังไม่ได้เลือก = ใส่เข้าช่องว่างช่องแรก · กดหน้าที่เลือกไว้แล้ว = เอาออก
   * เลขบนไอคอนบอกว่าหน้านั้นไปอยู่ช่องที่เท่าไรของแถบ นับจากซ้ายไปขวา
   */
  function toggle(href: string) {
    const next = [...current];
    const at = next.indexOf(href);
    if (at >= 0) {
      next[at] = "";
      setBotnav(role, next);
      
      return;
    }
    const empty = next.indexOf("");
    if (empty < 0) return;
    next[empty] = href;
    setBotnav(role, next);
    
  }

  /** ช่องที่เท่าไรของแถบ (นับเฉพาะช่องที่มีของ) — ใช้เป็นเลขบนไอคอน */
  const orderOf = (href: string) => {
    const at = current.indexOf(href);
    return at < 0 ? 0 : current.slice(0, at).filter(Boolean).length + 1;
  };

  return (
    <section className="glass rounded-[20px] px-4 py-4 sm:px-6 sm:py-[22px]">
      <h2 className="text-lg font-semibold">แถบเมนูล่างบนมือถือ</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        ฝ่ายบุคคลตั้งให้ทุกคนในบทบาทนั้นใช้เหมือนกัน (เจ้าของสั่ง 1 ต.ค. 2569)
        <br />
        เลือกได้สูงสุด {BOTNAV_SLOTS} หน้า · กดซ้ำที่หน้าเดิมเพื่อเอาออก · ปุ่มกลางเป็นลงเวลาเสมอ
      </p>

      {/* บทบาทที่กำลังตั้งค่า */}
      <label className="mt-3.5 flex max-w-[280px] flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-muted-foreground">ตั้งค่าของบทบาท</span>
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="บทบาทที่จะตั้งแถบเมนูล่าง">
          {ROLES.filter((r) => r.key !== "ceo").map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </Select>
      </label>

      {/* แถบตัวอย่างของจริง — เลือกแล้วเห็นผลทันทีว่าหน้าตาจะเป็นแบบไหน */}
      <div className="mt-4 flex items-end justify-between gap-1 rounded-[18px] bg-muted p-2">
        {[0, 1, -1, 2, 3].map((s) => {
          if (s === -1)
            return (
              <span key="mid" className="flex flex-1 flex-col items-center gap-1 py-1.5">
                <i className="grid size-10 place-items-center rounded-full bg-primary text-white">
                  <ClockIcon className="size-5" strokeWidth={2.3} />
                </i>
                <em className="text-[10.5px] font-semibold not-italic">ลงเวลา</em>
              </span>
            );
          const found = choices.find((c) => c.href === current[s]);
          const Icon = found ? (ICONS[found.icon] ?? HomeIcon) : null;
          return (
            <span key={s} className="flex flex-1 flex-col items-center gap-1 py-1.5 text-muted-foreground">
              {Icon ? <Icon className="size-[19px]" /> : <i className="block size-[19px]" />}
              <em className="w-full truncate px-0.5 text-center text-[10.5px] not-italic">
                {found?.label ?? "ว่าง"}
              </em>
            </span>
          );
        })}
      </div>

      <p className="mt-3.5 text-[12.5px] font-semibold">
        {full ? (
          <span className="text-muted-foreground">
            ครบ {BOTNAV_SLOTS} หน้าแล้ว — กดหน้าที่เลือกไว้เพื่อเอาออกก่อน
          </span>
        ) : (
          <>
            เลือกได้อีก <span className="text-primary">{BOTNAV_SLOTS - used.length}</span> หน้า
          </>
        )}
      </p>

      {/* หน้าที่เลือกได้ — เฉพาะหน้าในเมนูของบทบาทตัวเอง จึงไม่มีทางตั้งให้ข้ามไปหน้าของฝ่ายอื่น */}
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {choices.map((c) => {
          const Icon = ICONS[c.icon] ?? HomeIcon;
          const on = current.includes(c.href);
          return (
            <button
              key={c.href}
              type="button"
              onClick={() => toggle(c.href)}
              aria-pressed={on}
              disabled={!on && full}
              className={`flex flex-col items-center justify-start gap-1.5 rounded-[14px] border px-2 py-3 text-[11.5px] leading-tight font-medium transition-colors disabled:opacity-40 ${
                on ? "border-primary bg-[var(--accent)] text-primary" : "border-border bg-card"
              }`}
            >
              <span className="relative">
                <i
                  className={`grid size-[34px] place-items-center rounded-[11px] ${
                    on ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="size-[18px]" />
                </i>
                {on && (
                  /* เลขบอกลำดับช่องบนแถบ — เห็นได้ทันทีว่าหน้านี้ไปอยู่ตรงไหน */
                  <em className="num absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-full bg-white text-[10.5px] font-bold text-primary shadow-[0_0_0_1.5px_var(--primary)] not-italic">
                    {orderOf(c.href)}
                  </em>
                )}
              </span>
              <span className="w-full truncate text-center">{c.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn glass-thin"
          disabled={!changed}
          onClick={() => {
            resetBotnav(role);
          }}
        >
          คืนค่าตั้งต้น
        </button>
      </div>
    </section>
  );
}
