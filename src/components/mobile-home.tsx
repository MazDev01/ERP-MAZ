"use client";

/*
 * หน้าหลักบนมือถือ — ต้นแบบ dose-erp-maz/mobile/home-glass.html (เจ้าของส่งมา 30 ก.ย. 2569)
 *
 * เรียงตามต้นแบบ: หัวแถบ (โลโก้ · ค้นหา · กระดิ่ง) → การ์ดทักทาย → เมนู 5 ช่อง
 *                 → "ต้องทำ" การ์ดเลื่อนแนวนอน → "วันนี้ของฉัน"
 *
 * ตัวเลขทุกตัวมาจากสโตร์จริงของระบบ ไม่ได้ฝังไว้ในหน้า
 *   ต้องทำ      = รายการแจ้งเตือนของบทบาทนั้น (buildNotices) ตัวเดียวกับกระดิ่ง
 *   วันนี้ของฉัน = บัตรตอกของวันนี้ · สิทธิ์วันลาคงเหลือ · รอบสลิปล่าสุด
 * จอกว้างไม่ใช้หน้านี้ (RoleHomePage เด้งไปเมนูแรกของบทบาทอยู่แล้ว)
 */

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState, useSyncExternalStore } from "react";
import { currentStatus, formatTime, recordsOfDay } from "@/lib/attendance";
import {
  getRecordsServerSnapshot,
  getRecordsSnapshot,
  subscribeRecords,
} from "@/lib/attendance-store";
import { baht, bkkNow, daysBetween, greetNow, thaiMonth, todayIso } from "@/lib/format";
import { currentPeriod, entitlementDays, leaveTypes } from "@/lib/leave-data";
import { leaveUsage, useLeaveRecords } from "@/lib/leave-store";
import { useMyLeavePolicy } from "@/lib/leave-policy";
import { useProfile } from "@/lib/profile-data";
import { useProfilePhoto } from "@/lib/profile-store";
import { roleLabel, useRole, type Role } from "@/lib/role";
import { useCrm } from "@/lib/crm-store";
import { useAcc } from "@/lib/acc-store";
import { usePm } from "@/lib/pm-store";
import { psBucket, psMine } from "@/lib/presales-work";
import { useHr } from "@/lib/hr-store";
import { expectedInMinutes, formatMinutesOfDay } from "@/lib/work-schedule";
import { pageTitle, type NavItem } from "@/lib/nav";
import type { Notice } from "@/lib/notifications";
import { ICONS } from "./app-shell";
import { BellIcon, ChevronRightIcon, ClockIcon, HomeIcon, LeadsIcon, LeaveIcon, ProjectIcon, ReceiptIcon, SearchIcon } from "./icons";
import { useReadNotices } from "@/lib/notification-store";

/* เมนูหน้าหลักของทีมก่อนการขาย ตามต้นแบบ home-presales.html — สามช่องเท่านั้น */
const PS_HOME = ["/presales-work", "/presales-schedule", "/presales-templates"];

/* สีไอคอนเมนูตามต้นแบบ — ไล่สีคนละชุดเรียงกันไป ไม่ได้ผูกกับเมนูใดเมนูหนึ่ง */
const TILE = [
  "linear-gradient(150deg,#F2A93B,#D9731A)",
  "linear-gradient(150deg,#3CC08A,#138A5B)",
  "linear-gradient(150deg,#9B83F0,#5B3FBF)",
  "linear-gradient(150deg,#5A9BF0,#1F63C4)",
  "linear-gradient(150deg,#EE5A6F,#B0101F)",
];

/** ไอคอนของหน้าปลายทาง — ใช้ชุดเดียวกับเมนู */
function iconKeyOf(href: string): keyof typeof ICONS {
  const path = href.split("?")[0];
  if (path.startsWith("/acc/billing")) return "billing";
  if (path.startsWith("/acc/receipts")) return "receipt";
  if (path.startsWith("/leave") || path.startsWith("/approvals")) return "leave";
  if (path.startsWith("/ot")) return "ot";
  if (path.startsWith("/hr")) return "team";
  if (path.startsWith("/pm") || path.startsWith("/my-tasks")) return "tasks";
  if (path.startsWith("/quotations")) return "quotation";
  if (path.startsWith("/leads")) return "leads";
  if (path.startsWith("/presales")) return "presales";
  if (path.startsWith("/deals")) return "deals";
  return "home";
}

/**
 * ป้ายเวลาบนการ์ด "ต้องทำ" — บอกว่าเหลืออีกกี่วันหรือเลยมากี่วัน (ต้นแบบ home-presales.html)
 * ไม่มีวันที่ของเรื่องนั้นก็ไม่ต้องขึ้นป้าย
 */
function dueText(date: string) {
  if (!date) return "";
  const d = daysBetween(todayIso(), date);
  if (d === 0) return "วันนี้";
  if (d === 1) return "พรุ่งนี้";
  return d > 0 ? `อีก ${d} วัน` : `เลย ${-d} วัน`;
}

/* พื้นหลังการ์ด "ต้องทำ" — ไล่สีตามระดับความเร่งด่วนของเรื่องนั้น */
const CARD_BG: Record<Notice["level"], string> = {
  late: "linear-gradient(160deg,#F4A0AC,#8E0012)",
  soon: "linear-gradient(160deg,#F2C58A,#B4630B)",
  info: "linear-gradient(160deg,#9CBCEA,#1A3E8C)",
};

/* สีแถวเด่นในภาพจำลอง ให้เข้ากับระดับความเร่งด่วนของการ์ด */
const ROW_ACCENT: Record<Notice["level"], string> = {
  late: "rgb(192 18 31 / 0.55)",
  soon: "rgb(180 99 11 / 0.55)",
  info: "rgb(26 93 181 / 0.5)",
};

const CARD = "bg-white/72 backdrop-blur-[18px] border border-white/95 shadow-[0_12px_30px_-20px_rgb(140_20_40/0.45)]";

/*
 * สรุปสั้น ๆ สี่ช่องในการ์ดทักทาย (ต้นแบบ home-glass.html 1 ต.ค. 2569)
 * ตัวเลขต่างกันตามบทบาท — เอาเรื่องที่คนบทบาทนั้นดูทุกวันขึ้นก่อน
 * ช่องสุดท้ายเป็น "วันลาคงเหลือ" ของตัวเองทุกบทบาทที่มีสิทธิ์ลา
 */
function useHomeStats(role: Role): { k: string; v: string; u?: string; href: string }[] {
  const crm = useCrm();
  const acc = useAcc();
  const pm = usePm();
  const hr = useHr();
  const leaveRecords = useLeaveRecords();
  const policy = useMyLeavePolicy();
  const me = useProfile();

  const period = currentPeriod();
  /* นับเฉพาะวันลาที่วางแผนใช้เองได้ — ลาป่วยกับลาไม่รับค่าจ้างไม่ใช่โควตาที่คนวางแผนล่วงหน้า
     (ต้นแบบ home-glass.html แสดง 9 วัน = พักร้อน + ลากิจ) */
  const PLANNED = ["ลาพักร้อน", "ลากิจ"];
  const leaveLeft = policy.quota
    ? leaveTypes()
        .filter((t) => PLANNED.includes(t) && entitlementDays(t, period) > 0)
        .reduce((sum, t) => sum + leaveUsage(leaveRecords, t, period).remaining, 0)
    : 0;
  const mine = { k: "วันลาคงเหลือ", v: String(Math.round(leaveLeft * 10) / 10), u: "วัน", href: "/leave" };

  const money = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));
  const open = acc.invoices.filter((v) => v.status !== "cancelled" && v.outstanding > 0);
  const paid = acc.receipts.reduce((sum, r) => sum + r.total, 0);
  const running = pm.projects.filter((p) => p.status === "running");
  const active = hr.emp.filter((e) => e.status === "active");
  const myTasks = pm.projects.flatMap((p) => p.tasks.filter((t) => t.whos.includes(me.employeeId)));

  /* ผู้บริหาร — ภาพรวมทั้งบริษัทเดือนนี้ (ต้นแบบ home-ceo.html 2 ต.ค. 2569) */
  if (role === "ceo") {
    const month = todayIso().slice(0, 7);
    const won = crm.deals
      .filter((d) => d.status === "ปิดการขาย" && d.closedAt.startsWith(month))
      .reduce((a, d) => a + d.total, 0);
    return [
      { k: "ปิดการขาย", v: money(won), u: "฿", href: "/ceo/sales" },
      { k: "รับชำระแล้ว", v: money(paid), u: "฿", href: "/ceo/acc" },
      { k: "กำลังทำ", v: String(running.length), u: "โปรเจค", href: "/ceo/pm" },
      { k: "พนักงาน", v: String(active.length), u: "คน", href: "/ceo/hr" },
    ];
  }
  if (role === "acc")
    return [
      { k: "รับชำระแล้ว", v: money(paid), u: "฿", href: "/acc/receipts" },
      { k: "ลูกหนี้คงเหลือ", v: money(open.reduce((a, v) => a + v.outstanding, 0)), u: "฿", href: "/acc/billing" },
      { k: "รอวางบิล", v: String(acc.deals.filter((d) => !d.plan.length).length), u: "ดีล", href: "/acc/billing" },
      mine,
    ];
  if (role === "hr")
    return [
      { k: "พนักงาน", v: String(active.length), u: "คน", href: "/hr/employees" },
      { k: "ทดลองงาน", v: String(active.filter((e) => e.type === "probat").length), u: "คน", href: "/hr/employees" },
      { k: "ฝึกงาน", v: String(active.filter((e) => e.type === "intern").length), u: "คน", href: "/hr/employees" },
      mine,
    ];
  /*
   * ฝ่ายขาย — สรุปผลการขาย ไม่ใช่จำนวนรายการ (ต้นแบบ home-sales.html 1 ต.ค. 2569)
   *   ปิดการขาย = ยอดดีลที่ปิดได้ในเดือนนี้
   *   ผู้สนใจใหม่ = รายที่ยังรอนัดหมาย
   *   อัตราปิด   = ดีลที่ปิดได้ ÷ ใบเสนอราคาที่ออกเลขแล้ว
   *   ปิดเฉลี่ย   = วันจากวันที่ออกใบเสนอราคาถึงวันปิดการขาย
   */
  if (role === "sales") {
    const month = todayIso().slice(0, 7);
    const closed = crm.deals.filter((d) => d.status === "ปิดการขาย");
    const won = closed.filter((d) => d.closedAt.startsWith(month)).reduce((a, d) => a + d.total, 0);
    const issued = crm.quotations.filter((q) => q.no);
    const rate = issued.length ? Math.round((closed.length / issued.length) * 100) : 0;
    const spans = closed
      .map((d) => {
        const q = crm.quotations.find((x) => x.no === d.quotationNo);
        return q && d.closedAt ? daysBetween(q.issued, d.closedAt) : null;
      })
      .filter((n): n is number => n !== null && n >= 0);
    const avg = spans.length ? Math.round(spans.reduce((a, n) => a + n, 0) / spans.length) : 0;
    return [
      { k: "ปิดการขาย", v: money(won), u: "฿", href: "/deals" },
      { k: "ผู้สนใจใหม่", v: String(crm.customers.filter((c) => c.status === "รอนัดหมาย").length), u: "ราย", href: "/leads" },
      { k: "อัตราปิด", v: String(rate), u: "%", href: "/deals" },
      { k: "ปิดเฉลี่ย", v: String(avg), u: "วัน", href: "/deals" },
    ];
  }
  /*
   * ทีมก่อนการขาย — สรุปคำขอในมือ (ต้นแบบ home-presales.html 2 ต.ค. 2569)
   * ได้ดีล = ลูกค้าที่เราเคยทำข้อเสนอให้แล้วปิดการขายได้
   */
  if (role === "ps") {
    const mineReqs = crm.presales.filter(psMine);
    const today = todayIso();
    const codes = new Set(mineReqs.map((r) => r.customerCode));
    const wonDeals = crm.deals.filter((d) => d.status === "ปิดการขาย" && codes.has(d.customerCode));
    return [
      { k: "รอรับงาน", v: String(mineReqs.filter((r) => psBucket(r) === "todo").length), u: "งาน", href: "/presales-work" },
      { k: "รอข้อมูลเพิ่ม", v: String(mineReqs.filter((r) => psBucket(r) === "wait").length), u: "งาน", href: "/presales-work" },
      {
        k: "เลยกำหนด",
        v: String(mineReqs.filter((r) => r.due < today && psBucket(r) !== "done").length),
        u: "งาน",
        href: "/presales-work",
      },
      { k: "ได้ดีล", v: String(wonDeals.length), u: "ดีล", href: "/presales-dash" },
    ];
  }
  if (role === "pm" || role === "gm")
    return [
      { k: "โปรเจคที่ทำอยู่", v: String(running.length), u: "งาน", href: "/pm/projects" },
      { k: "งานเข้าใหม่", v: String(pm.inbox.length), u: "งาน", href: "/pm/inbox" },
      { k: "งานรอตรวจ", v: String(running.flatMap((p) => p.tasks).filter((t) => t.status === "sent").length), u: "งาน", href: "/pm/reviews" },
      mine,
    ];
  /* พนักงานและทีมก่อนการขาย — งานของตัวเองเป็นหลัก */
  return [
    { k: "งานที่ได้รับ", v: String(myTasks.filter((t) => t.status !== "done").length), u: "งาน", href: "/my-tasks" },
    { k: "รอตรวจ", v: String(myTasks.filter((t) => t.status === "sent").length), u: "งาน", href: "/my-tasks" },
    { k: "เสร็จแล้ว", v: String(myTasks.filter((t) => t.status === "done").length), u: "งาน", href: "/my-tasks" },
    mine,
  ];
}

export function MobileHome({
  items,
  notices,
  hello,
}: {
  /** เมนูของบทบาทนี้ (เรียงเหมือนแถบข้าง) */
  items: NavItem[];
  /** เรื่องที่ต้องทำ — ชุดเดียวกับกระดิ่ง */
  notices: Notice[];
  /** ชื่อที่ใช้ทักทาย (ผู้บริหารไม่มีชื่อในทะเบียน จึงส่งมาจากหน้าเรียก) */
  hello: string;
}) {
  const role = useRole();
  const me = useProfile();
  const photo = useProfilePhoto();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  /* จุดแดงบนกระดิ่ง — นับเรื่องที่ยังไม่ได้อ่าน */
  const readIds = useReadNotices();
  const unread = notices.filter((n) => !readIds.includes(n.id)).length;

  /*
   * เมนูของบทบาท — รวมกลุ่ม "ของฉัน" ด้วย (เจ้าของทักท้วง 1 ต.ค. 2569 ว่าหาหน้าเบิกค่าใช้จ่ายไม่เจอ)
   * เดิมตัดกลุ่มนี้ออกเพราะคิดว่าแถบล่างกับการ์ด "วันนี้ของฉัน" พอแล้ว
   * แต่แถบล่างมีแค่ลงเวลา/การลา ส่วนโอที เบิกค่าใช้จ่าย และสลิป ไม่มีทางกดเข้าจากหน้าหลักเลย
   * หน้าหลักเองไม่ต้องอยู่ในเมนู เพราะยืนอยู่บนหน้านี้แล้ว
   */
  const work = useMemo(() => {
    const list = items.filter((i) => i.href !== "/");
    /* ผู้บริหาร: การ์ดเหลือสี่ฝ่ายตามต้นแบบ — แดชบอร์ดกับคำขออนุมัติอยู่แถบล่างแล้ว */
    if (role === "ceo") return list.filter((i) => !/dashboard|approvals/.test(i.href));
    /*
     * ทีมก่อนการขาย: เหลือสามช่องตามต้นแบบ home-presales.html (เจ้าของยืนยัน 2 ต.ค. 2569)
     * หน้าที่เหลือเข้าได้จากแถบล่าง (แดชบอร์ด · การลา) การ์ด "วันนี้ของฉัน" (ลงเวลา · ลา · สลิป)
     * และปุ่มค้นหาเมนูด้านบน
     */
    if (role === "ps") return list.filter((i) => PS_HOME.includes(i.href));
    return list;
  }, [items, role]);
  const hits = useMemo(() => {
    const key = q.trim().toLowerCase();
    return key ? items.filter((i) => i.label.toLowerCase().includes(key)) : [];
  }, [items, q]);

  const initials = me.name.split(" ").slice(0, 2).map((w) => w[0]).join("");
  const stats = useHomeStats(role);

  return (
    <div className="-mx-4 -mt-[18px] min-h-full px-0 pb-24">
      {/* ไล่สีชมพูหลังหัวหน้าจอ ตามต้นแบบ */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[380px]"
        style={{
          background:
            "radial-gradient(60% 55% at 18% 18%, #FFFFFF 0%, rgba(255,255,255,0) 70%), radial-gradient(55% 60% at 85% 10%, #FFE9EC 0%, rgba(255,233,236,0) 70%), radial-gradient(70% 60% at 60% 60%, #FCD9DF 0%, rgba(252,217,223,0) 75%), linear-gradient(180deg, #F9D3DA 0%, #FDF0F2 70%, #FAF6F6 100%)",
        }}
      />

      <div className="relative flex flex-col gap-[18px] pt-1">
        {/* ── หัวแถบ ── */}
        <header className="flex items-center justify-between px-5">
          <span className="flex items-center gap-2.5">
            <Image src="/maz-logo.png" alt="MAZ" width={640} height={158} className="h-[17px] w-auto" priority />
            <b className="text-[18px] font-bold">ERP</b>
          </span>
          <span className="flex gap-2.5">
            <button
              type="button"
              aria-label="ค้นหาเมนู"
              aria-expanded={searching}
              onClick={() => setSearching((v) => !v)}
              className={`grid size-[46px] place-items-center rounded-full ${CARD}`}
            >
              <SearchIcon className="size-5" strokeWidth={2} />
            </button>
            {/* กระดิ่งบนหน้าหลักพาไปหน้าแจ้งเตือนเต็มจอ (ต้นแบบ notifications.html 1 ต.ค. 2569) */}
            <Link
              href="/notifications"
              aria-label={unread > 0 ? `แจ้งเตือน ${unread} เรื่องใหม่` : "แจ้งเตือน"}
              className={`relative grid size-[46px] place-items-center rounded-full ${CARD}`}
            >
              <BellIcon className="size-5" strokeWidth={2} />
              {unread > 0 && (
                <span className="num absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-primary px-1 text-[11px] font-bold text-white">
                  {unread}
                </span>
              )}
            </Link>
          </span>
        </header>

        {/* ค้นหาเมนู — กดแว่นขยายแล้วค่อยกาง ไม่กินที่ตอนไม่ได้ใช้ */}
        {searching && (
          <div className="px-4">
            <label className={`flex h-12 items-center gap-2.5 rounded-[16px] px-4 ${CARD}`}>
              <SearchIcon className="size-[18px] flex-none text-muted-foreground" strokeWidth={2} />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหาเมนู..."
                aria-label="ค้นหาเมนู"
                className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
              />
            </label>
            {q.trim() !== "" && (
              <ul className={`mt-2 list-none rounded-[16px] p-1 ${CARD}`}>
                {hits.length === 0 ? (
                  <li className="px-3 py-3 text-center text-[13px] text-muted-foreground">
                    ไม่พบเมนูที่ตรงกับ “{q}”
                  </li>
                ) : (
                  hits.map((i) => (
                    <li key={i.href}>
                      <Link href={i.href} className="flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-[14px] font-medium">
                        {(() => {
                          const Icon = ICONS[i.icon] ?? HomeIcon;
                          return <Icon className="size-[18px] text-muted-foreground" strokeWidth={2} />;
                        })()}
                        {i.label}
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        )}

        {/* ── การ์ดทักทาย + สรุปสั้น ๆ ── */}
        <section className={`mx-4 flex flex-col gap-4 rounded-[28px] p-4 ${CARD}`}>
          <div className="flex items-center gap-3">
          <span className="grid size-[52px] flex-none place-items-center overflow-hidden rounded-full bg-[#FCE3E7] text-[17px] font-bold text-primary shadow-[0_0_0_2.5px_#fff,0_0_0_4.5px_rgb(200_16_46/0.35)]">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="size-full object-cover" />
            ) : (
              initials
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[12.5px] text-muted-foreground">{greetNow()}</span>
            <b className="truncate text-[17px] font-bold">{hello}</b>
            {/* ผู้บริหารใช้คำเรียกตำแหน่งเป็นชื่อทักทายอยู่แล้ว ไม่ต้องขึ้นซ้ำอีกบรรทัด */}
            {roleLabel(role) !== hello && (
              <em className="text-[12px] text-muted-foreground not-italic">{roleLabel(role)}</em>
            )}
          </span>
          </div>

          {/* แถวสรุปสี่ช่อง — กดแล้วไปหน้าของเรื่องนั้น */}
          <nav aria-label={role === "sales" ? "สรุปการขายเดือนนี้" : "สรุปของฉัน"} className="flex rounded-[16px] border border-[#E3D3D7] bg-[rgb(250_244_245/0.9)] py-3">
            {stats.map((c, i) => (
              <Link
                key={c.k}
                href={c.href}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 text-foreground ${
                  i < stats.length - 1 ? "border-r border-[#D9C8CC]" : ""
                }`}
              >
                <span className="num text-[17px] font-bold whitespace-nowrap">
                  {c.v}
                  {c.u && <span className="ml-0.5 text-[11px] font-semibold text-muted-foreground">{c.u}</span>}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">{c.k}</span>
              </Link>
            ))}
          </nav>
        </section>

        {/* ── เมนู ── */}
        {work.length > 0 && (
          <>
            <h2 className="px-5 text-[16px] font-bold">{role === "ceo" ? "ภาพรวม" : "เมนู"}</h2>
            <nav aria-label={role === "ceo" ? "ภาพรวม" : "เมนู"} className={`grid gap-2 px-3 ${role === "ceo" ? "grid-cols-4" : "grid-cols-5"}`}>
              {work.slice(0, 10).map((i, n) => {
                const Icon = ICONS[i.icon] ?? HomeIcon;
                return (
                  <Link key={i.href} href={i.href} className="flex flex-col items-center gap-[7px] text-foreground">
                    <span
                      className="grid size-[58px] place-items-center rounded-[18px] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_10px_18px_-10px_rgb(90_20_30/0.55)]"
                      style={{ background: TILE[n % TILE.length] }}
                    >
                      <Icon className="size-[26px]" strokeWidth={2} />
                    </span>
                    <span className="text-center text-[12px] leading-tight font-semibold">{i.label}</span>
                  </Link>
                );
              })}
            </nav>
          </>
        )}

        {/* ── ต้องทำ ── */}
        {notices.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-5">
              <h2 className="text-[16px] font-bold">{role === "ceo" ? "รอคุณอนุมัติ" : "สิ่งที่ต้องทำวันนี้"}</h2>
              <span className="num rounded-[6px] bg-primary px-1.5 py-px text-[11px] font-bold text-white">
                {String(notices.length).padStart(2, "0")}
              </span>
            </div>
            <div className="flex gap-3 overflow-x-auto pl-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {notices.slice(0, 6).map((n) => {
                const Icon = ICONS[iconKeyOf(n.href)] ?? HomeIcon;
                return (
                  <Link
                    key={n.id}
                    href={n.href}
                    className="relative h-[184px] w-[150px] flex-none overflow-hidden rounded-[24px] text-white shadow-[0_14px_28px_-18px_rgb(60_10_20/0.7)]"
                    style={{ background: CARD_BG[n.level] }}
                  >
                    {/* ภาพจำลองหน้าปลายทางแบบเบลอ ตามต้นแบบ home-glass.html
                       ต้นแบบใช้ภาพหน้าจอจริง ของเราวาดเป็นแถวรายการจาง ๆ แทน จะได้ไม่ต้องเก็บภาพทุกหน้า */}
                    <span aria-hidden="true" className="absolute inset-0 overflow-hidden">
                      <span className="absolute inset-x-2 top-2 bottom-6 flex flex-col gap-1.5 rounded-[18px] bg-white/80 p-2 blur-[1.5px]">
                        {[0, 1, 2, 3].map((i) => (
                          <span key={i} className="flex items-center gap-1.5 rounded-[9px] bg-white/85 px-1.5 py-1.5">
                            <span
                              className="size-[13px] flex-none rounded-[5px]"
                              style={{ background: i === 1 ? ROW_ACCENT[n.level] : "rgb(140 120 125 / 0.35)" }}
                            />
                            <span className="flex min-w-0 flex-1 flex-col gap-1">
                              <span className="h-[5px] w-[70%] rounded-full bg-[rgb(90_70_75/0.35)]" />
                              <span className="h-[5px] w-[45%] rounded-full bg-[rgb(90_70_75/0.2)]" />
                            </span>
                            {i === 1 && (
                              <span className="h-[6px] w-[22px] flex-none rounded-full" style={{ background: ROW_ACCENT[n.level] }} />
                            )}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="absolute inset-0"
                      style={{ background: "linear-gradient(to top, rgba(38,16,22,.92) 0%, rgba(38,16,22,.5) 45%, rgba(38,16,22,.05) 75%)" }}
                    />
                    {/* ป้ายมุมขวาบน = เหลือเวลาอีกเท่าไร · ท้ายการ์ด = หน้าที่จะพาไป
                        (ต้นแบบ home-presales.html 2 ต.ค. 2569 — เดิมใส่ชื่อหมวดซ้ำกับท้ายการ์ด) */}
                    <span className="absolute top-2.5 right-2.5 flex h-7 max-w-[calc(100%-20px)] items-center gap-1.5 rounded-full border border-white/45 bg-white/28 px-2.5 text-[12px] font-bold text-white backdrop-blur-[10px]">
                      <Icon className="size-[13px] flex-none" strokeWidth={2.2} />
                      <span className="min-w-0 truncate">{dueText(n.date)}</span>
                    </span>
                    <span className="absolute inset-x-3 bottom-3 flex flex-col gap-2">
                      <span className="line-clamp-3 text-[15px] leading-tight font-bold">{n.title}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="grid size-[22px] flex-none place-items-center rounded-full bg-white/90 text-primary">
                          <Icon className="size-3" strokeWidth={2.2} />
                        </span>
                        <span className="truncate text-[11.5px] text-white/85">{pageTitle(n.href.split("?")[0], role)}</span>
                      </span>
                    </span>
                  </Link>
                );
              })}
              <span className="w-2 flex-none" />
            </div>
          </>
        )}

        {/* ── ท้ายหน้า ── ผู้บริหารไม่ตอกบัตรและไม่มีสิทธิ์ลา จึงเป็นสรุปเรื่องที่ควรรู้แทน */}
        {role === "ceo" ? <CeoBrief /> : <MyToday />}
      </div>
    </div>
  );
}

/*
 * เรื่องที่ควรรู้ของผู้บริหาร (ต้นแบบ home-ceo.html) — เรื่องที่ยังไม่จบ พากดเข้าหน้าของฝ่ายนั้น
 * ทุกบรรทัดคิดสดจากสโตร์จริง เรื่องไหนไม่มีก็ไม่ขึ้น ไม่ใช่ขึ้นเลขศูนย์ให้รก
 */
function CeoBrief() {
  const pm = usePm();
  const acc = useAcc();
  const crm = useCrm();
  const today = todayIso();

  /* ใกล้ครบกำหนด = เหลือไม่เกิน 7 วัน หรือเลยกำหนดแล้วแต่ยังไม่ปิด */
  const soon = pm.projects.filter(
    (p) => p.status === "running" && p.due && daysBetween(today, p.due) <= 7,
  );
  const unpaid = acc.invoices.filter((v) => v.status !== "cancelled" && v.outstanding > 0);
  const waiting = crm.customers.filter((c) => c.status === "รอนัดหมาย");

  const rows = [
    soon.length > 0 && {
      key: "pm",
      href: "/ceo/pm",
      skin: "bg-[#E3F6F3] text-[#13867D]",
      Icon: ProjectIcon,
      title: `โปรเจคใกล้ครบกำหนด ${soon.length} งาน`,
      sub: "ภายใน 7 วัน",
    },
    unpaid.length > 0 && {
      key: "acc",
      href: "/ceo/acc",
      skin: "bg-[#FDEDD6] text-[#94500A]",
      Icon: ReceiptIcon,
      title: `ใบแจ้งหนี้รอชำระ ${unpaid.length} ใบ`,
      sub: `${unpaid[0].cus} ${baht(unpaid.reduce((a, v) => a + v.outstanding, 0))} ฿`.trim(),
    },
    waiting.length > 0 && {
      key: "sales",
      href: "/ceo/sales",
      skin: "bg-[#E8F0FC] text-[#2A5CC9]",
      Icon: LeadsIcon,
      title: `ผู้สนใจรอนัดหมาย ${waiting.length} ราย`,
      sub: "งานขาย",
    },
  ].filter(Boolean) as {
    key: string;
    href: string;
    skin: string;
    Icon: typeof ProjectIcon;
    title: string;
    sub: string;
  }[];

  if (rows.length === 0) return null;
  return (
    <>
      <h2 className="px-5 text-[16px] font-bold">เรื่องที่ควรรู้</h2>
      <div className={`mx-4 flex flex-col rounded-[24px] ${CARD}`}>
        {rows.map((r, i) => (
          <div key={r.key}>
            {i > 0 && <span className="mx-3.5 block h-px bg-[rgb(42_31_34/0.07)]" />}
            <Link href={r.href} className="flex items-center gap-3 px-3.5 py-3 text-foreground">
              <span className={`grid size-[38px] flex-none place-items-center rounded-[12px] ${r.skin}`}>
                <r.Icon className="size-[18px]" strokeWidth={2.1} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-[14px] leading-snug font-bold">{r.title}</b>
                <span className="num truncate text-[12px] text-muted-foreground">{r.sub}</span>
              </span>
              <ChevronRightIcon className="size-[18px] flex-none text-muted-foreground" strokeWidth={2.1} />
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}

/* แถวล่างสุด — ตอกบัตรวันนี้ สิทธิ์วันลา และสลิปรอบล่าสุด (ต้นแบบ "วันนี้ของฉัน") */
function MyToday() {
  const records = useSyncExternalStore(subscribeRecords, getRecordsSnapshot, getRecordsServerSnapshot);
  const leaveRecords = useLeaveRecords();
  const policy = useMyLeavePolicy();
  const today = todayIso();
  const todayRows = recordsOfDay(records, today);
  const firstIn = todayRows.find((r) => r.type === "in");
  const { isWorking } = currentStatus(records);
  /* เวลาเข้างานตามกติกาบริษัท (ไม่คิดกรณีลาครึ่งวันตรงนี้ หน้าตอกบัตรคิดให้ครบอยู่แล้ว) */
  const startText = formatMinutesOfDay(expectedInMinutes(null));

  const period = currentPeriod();
  const quotas = leaveTypes()
    .filter((t) => entitlementDays(t, period) > 0)
    .slice(0, 3)
    .map((t) => ({ type: t, left: leaveUsage(leaveRecords, t, period).remaining }));

  /* รอบสลิปล่าสุด = เดือนก่อนหน้าเดือนนี้ (รอบจ่ายปิดหลังสิ้นเดือน) */
  const now = bkkNow();
  const slipMonth = `${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}-${String(
    now.getMonth() === 0 ? 12 : now.getMonth(),
  ).padStart(2, "0")}`;

  return (
    <>
      <h2 className="px-5 text-[16px] font-bold">วันนี้ของฉัน</h2>
      <div className={`mx-4 flex flex-col rounded-[24px] ${CARD}`}>
        <Link href="/" className="flex items-center gap-3 px-3.5 py-3 text-foreground">
          <span className="grid size-[38px] flex-none place-items-center rounded-[12px] bg-[#FCE3E7] text-primary">
            <ClockIcon className="size-[18px]" strokeWidth={2.1} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[14px] font-bold">
              {firstIn ? (isWorking ? "กำลังทำงานอยู่" : "ลงเวลาออกแล้ว") : "ยังไม่ได้เช็คอิน"}
            </b>
            <span className="text-[12px] text-muted-foreground">
              {firstIn ? `เข้างาน ${formatTime(new Date(firstIn.at))} น.` : `เข้างาน ${startText} น.`}
            </span>
          </span>
          <ChevronRightIcon className="size-[18px] flex-none text-muted-foreground" strokeWidth={2.1} />
        </Link>

        {policy.quota && quotas.length > 0 && (
          <>
            <span className="mx-3.5 block h-px bg-[rgb(42_31_34/0.07)]" />
            <Link href="/leave" className="flex items-center gap-3 px-3.5 py-2.5 text-foreground">
              <span className="grid size-[38px] flex-none place-items-center rounded-[12px] bg-[#E3EEFC] text-[#1A5DB5]">
                <LeaveIcon className="size-[18px]" strokeWidth={2.1} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <b className="text-[12.5px] font-bold">วันลาคงเหลือ</b>
                <span className="flex gap-1.5">
                  {quotas.map((q) => (
                    <span key={q.type} className="flex flex-1 flex-col items-center rounded-[12px] bg-[rgb(236_240_250/0.9)] py-1.5">
                      <span className="text-[11px] text-muted-foreground">{q.type}</span>
                      <b className="num text-[16px] font-bold text-[#1A5DB5]">{Math.round(q.left * 10) / 10}</b>
                    </span>
                  ))}
                </span>
              </span>
              <ChevronRightIcon className="size-[18px] flex-none text-muted-foreground" strokeWidth={2.1} />
            </Link>
          </>
        )}

        {policy.type !== "intern" && (
          <>
            <span className="mx-3.5 block h-px bg-[rgb(42_31_34/0.07)]" />
            <Link href="/payslip" className="flex items-center gap-3 px-3.5 py-3 text-foreground">
              <span className="grid size-[38px] flex-none place-items-center rounded-[12px] bg-[#DDF2E6] text-[#0F7049]">
                <ReceiptIcon className="size-[18px]" strokeWidth={2.1} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="text-[14px] font-bold">
                  {policy.type === "probat" ? "สลิปค่าจ้าง" : "สลิปเงินเดือน"}
                </b>
                <span className="text-[12px] text-muted-foreground">รอบ{thaiMonth(slipMonth)}</span>
              </span>
              <ChevronRightIcon className="size-[18px] flex-none text-muted-foreground" strokeWidth={2.1} />
            </Link>
          </>
        )}
      </div>
    </>
  );
}
