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
import { bkkNow, greetNow, thaiMonth, todayIso } from "@/lib/format";
import { currentPeriod, entitlementDays, leaveTypes } from "@/lib/leave-data";
import { leaveUsage, useLeaveRecords } from "@/lib/leave-store";
import { useMyLeavePolicy } from "@/lib/leave-policy";
import { useProfile } from "@/lib/profile-data";
import { useProfilePhoto } from "@/lib/profile-store";
import { roleLabel, useRole } from "@/lib/role";
import { expectedInMinutes, formatMinutesOfDay } from "@/lib/work-schedule";
import type { NavItem } from "@/lib/nav";
import type { Notice } from "@/lib/notifications";
import { ICONS } from "./app-shell";
import { ChevronRightIcon, ClockIcon, HomeIcon, LeaveIcon, ReceiptIcon, SearchIcon } from "./icons";
import { NotificationMenu } from "./notification-menu";

/* สีไอคอนเมนูตามต้นแบบ — ไล่สีคนละชุดเรียงกันไป ไม่ได้ผูกกับเมนูใดเมนูหนึ่ง */
const TILE = [
  "linear-gradient(150deg,#F2A93B,#D9731A)",
  "linear-gradient(150deg,#3CC08A,#138A5B)",
  "linear-gradient(150deg,#9B83F0,#5B3FBF)",
  "linear-gradient(150deg,#5A9BF0,#1F63C4)",
  "linear-gradient(150deg,#EE5A6F,#B0101F)",
];

/* พื้นหลังการ์ด "ต้องทำ" — ไล่สีตามระดับความเร่งด่วนของเรื่องนั้น */
const CARD_BG: Record<Notice["level"], string> = {
  late: "linear-gradient(160deg,#F4A0AC,#8E0012)",
  soon: "linear-gradient(160deg,#F2C58A,#B4630B)",
  info: "linear-gradient(160deg,#9CBCEA,#1A3E8C)",
};

const CARD = "bg-white/72 backdrop-blur-[18px] border border-white/95 shadow-[0_12px_30px_-20px_rgb(140_20_40/0.45)]";

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

  /* เมนูงานของบทบาท — ตัดกลุ่ม "ของฉัน" ออก เพราะมีแถวของตัวเองอยู่ท้ายหน้าแล้ว */
  const work = useMemo(() => items.filter((i) => i.group !== "ของฉัน"), [items]);
  const hits = useMemo(() => {
    const key = q.trim().toLowerCase();
    return key ? items.filter((i) => i.label.toLowerCase().includes(key)) : [];
  }, [items, q]);

  const initials = me.name.split(" ").slice(0, 2).map((w) => w[0]).join("");

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
            <NotificationMenu />
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

        {/* ── การ์ดทักทาย ── */}
        <section className={`mx-4 flex items-center gap-3 rounded-[28px] p-4 ${CARD}`}>
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
            <em className="text-[12px] text-muted-foreground not-italic">{roleLabel(role)}</em>
          </span>
        </section>

        {/* ── เมนู ── */}
        {work.length > 0 && (
          <>
            <h2 className="px-5 text-[16px] font-bold">เมนู</h2>
            <nav aria-label="เมนู" className="grid grid-cols-5 gap-2 px-3">
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
              <h2 className="text-[16px] font-bold">ต้องทำ</h2>
              <span className="num rounded-[6px] bg-primary px-1.5 py-px text-[11px] font-bold text-white">
                {String(notices.length).padStart(2, "0")}
              </span>
            </div>
            <div className="flex gap-3 overflow-x-auto pl-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {notices.slice(0, 6).map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  className="relative h-[184px] w-[150px] flex-none overflow-hidden rounded-[24px] text-white shadow-[0_14px_28px_-18px_rgb(60_10_20/0.7)]"
                  style={{ background: CARD_BG[n.level] }}
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={{ background: "linear-gradient(to top, rgba(38,16,22,.92) 0%, rgba(38,16,22,.5) 45%, rgba(38,16,22,.05) 75%)" }}
                  />
                  <span className="absolute top-2.5 right-2.5 flex h-7 max-w-[86%] items-center truncate rounded-full border border-white/45 bg-white/28 px-2.5 text-[11.5px] font-bold whitespace-nowrap backdrop-blur-[10px]">
                    {n.group}
                  </span>
                  <span className="absolute inset-x-3 bottom-3 flex flex-col gap-2">
                    <span className="line-clamp-3 text-[15px] leading-tight font-bold">{n.title}</span>
                    <span className="line-clamp-2 text-[11.5px] text-white/85">{n.detail}</span>
                  </span>
                </Link>
              ))}
              <span className="w-2 flex-none" />
            </div>
          </>
        )}

        {/* ── วันนี้ของฉัน ── */}
        <MyToday />
      </div>
    </div>
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
