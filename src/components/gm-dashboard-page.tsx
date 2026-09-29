"use client";

/*
 * แดชบอร์ดของผู้จัดการทั่วไป (ตามต้นแบบ gm-dashboard.html 22 ก.ย. 2569)
 *
 *   1. การ์ดสรุปสี่ใบ — รออนุมัติ · ลาวันนี้ · โปรเจคเลยกำหนด · OT เดือนนี้
 *   2. ลาในสัปดาห์นี้ (อาทิตย์–เสาร์) คู่กับคำขอรออนุมัติ (รอนานสุดก่อน)
 *   3. โปรเจคที่กำลังดำเนินการ — ดูอย่างเดียว PM เป็นผู้วางแผน
 *
 * ทุกตัวเลขคิดสดจากสโตร์ (gm-data.ts) ไม่มีค่าตายตัว
 * ลิงก์อยู่ในเมนูของ GM เท่านั้น — แถวโปรเจคพาไปหน้าโปรเจค ซึ่งอยู่ในเมนู GM อยู่แล้ว (เปิดแบบดูอย่างเดียว)
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { addDays, daysBetween, parseIsoDate, TH_MONTHS_SHORT, todayIso } from "@/lib/format";
import { useApprovedOtHours, useGmPending, useTeamLeave, type TeamLeave } from "@/lib/gm-data";
import { USERS } from "@/lib/mock-data";
import { projectProgress } from "@/lib/pm-data";
import { usePm } from "@/lib/pm-store";

/** รอตั้งแต่กี่วันขึ้นไปถึงเป็นตัวแดง — ตรงกับหน้ารายการรออนุมัติ */
const WAIT_HOT = 3;
/** ส่งมอบภายในกี่วันถึงเตือนสีส้ม */
const SOON_DAYS = 7;
/** มือถือแสดงคำขอรออนุมัติกี่แถวก่อน ที่เหลือกดดูเพิ่มในการ์ดเดิม ไม่ต้องเลื่อนผ่านรายการยาวทุกครั้ง */
const PHONE_CAP = 5;

/** "2026-09-21" → "21 ก.ย." */
function short(iso: string) {
  const d = parseIsoDate(iso);
  return `${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]}`;
}
const range = (from: string, to: string) => (to && to !== from ? `${short(from)} – ${short(to)}` : short(from));

export function GmDashboardPage() {
  const today = todayIso();
  const pm = usePm();
  const leaves = useTeamLeave();
  const pending = useGmPending();
  const otHours = useApprovedOtHours(today.slice(0, 7));
  const [allPending, setAllPending] = useState(false);

  /* สัปดาห์นี้ อาทิตย์ถึงเสาร์ ตามต้นแบบ */
  const [w0, w1] = useMemo(() => {
    const start = addDays(today, -parseIsoDate(today).getDay());
    return [start, addDays(start, 6)];
  }, [today]);
  const week = leaves.filter((l) => l.from <= w1 && l.to >= w0);
  const todayLv = leaves.filter((l) => l.from <= today && l.to >= today);
  /* คนเดียวลาหลายใบในวันเดียวกันนับครั้งเดียว */
  const todayNames = [...new Set(todayLv.map((l) => l.name.split(" ")[0]))];

  const running = pm.projects.filter((p) => p.status === "running");
  const late = running.filter((p) => p.due && p.due < today);

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <h1>แดชบอร์ด</h1>
          <p>{USERS.gm.name} · ผู้จัดการทั่วไป</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5 max-sm:gap-2.5 xl:grid-cols-4">
        <Kpi label="รออนุมัติ" value={pending.length} sub="การลา OT และใบเบิก" />
        <Kpi label="ลาวันนี้" value={todayNames.length} sub={todayNames.length ? todayNames.join(" · ") : "มาทำงานครบ"} />
        <Kpi label="โปรเจคเลยกำหนด" value={late.length} sub={`จาก ${running.length} โปรเจคที่กำลังทำ`} bad={late.length > 0} />
        <Kpi label="OT เดือนนี้" value={otHours} sub="ชั่วโมงที่อนุมัติแล้วทั้งบริษัท" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="ลาในสัปดาห์นี้" more={{ href: "/gm/calendar", label: "ดูตารางงาน" }}>
          {week.length === 0 ? (
            <None>ไม่มีใครลาในสัปดาห์นี้</None>
          ) : (
            <ul>
              {week.map((l) => (
                <Row key={l.key} href="/gm/calendar" title={l.name} sub={`${l.type} ${range(l.from, l.to)}`}
                  right={<LeaveState l={l} />} />
              ))}
            </ul>
          )}
        </Card>

        <Card title="รออนุมัติ" more={{ href: "/approvals", label: "ไปอนุมัติ" }}>
          {pending.length === 0 ? (
            <None>ไม่มีคำขอรออนุมัติ</None>
          ) : (
            <>
            <ul className={allPending ? "" : "max-sm:[&>li:nth-child(n+6)]:hidden"}>
              {pending.map((r) => {
                const w = daysBetween(r.at.slice(0, 10), today);
                const what = r.kind === "leave" && r.from ? `${r.what} ${range(r.from, r.to ?? r.from)}` : r.what;
                return (
                  <Row key={r.key} href="/approvals" title={r.name} sub={what}
                    right={
                      <em
                        className={`text-[12.5px] font-semibold not-italic ${w >= WAIT_HOT ? "text-destructive" : "text-muted-foreground"}`}
                        title={w >= WAIT_HOT ? `รอนานเกิน ${WAIT_HOT} วัน` : undefined}
                      >
                        {w <= 0 ? "วันนี้" : w === 1 ? "เมื่อวาน" : `${w} วันก่อน`}
                      </em>
                    } />
                );
              })}
            </ul>
            {pending.length > PHONE_CAP && (
              <button
                type="button"
                onClick={() => setAllPending((v) => !v)}
                className="h-10 w-full border-t border-border text-[12.5px] font-semibold text-primary sm:hidden"
              >
                {allPending ? "แสดงน้อยลง" : `ดูอีก ${pending.length - PHONE_CAP} รายการ`}
              </button>
            )}
            </>
          )}
        </Card>
      </div>

      <Card title="โปรเจคที่กำลังดำเนินการ" note="ดูอย่างเดียว PM เป็นผู้วางแผน">
        {running.length === 0 ? (
          <None>ไม่มีโปรเจคที่กำลังดำเนินการ</None>
        ) : (
          <ul>
            {running.map((p) => {
              const pr = projectProgress(p);
              /* โปรเจคที่ยังไม่มีแผน ไม่มีวันส่งมอบให้นับ — บอกไปตรง ๆ ไม่ใช่โชว์ NaN */
              const d = p.due ? daysBetween(today, p.due) : null;
              return (
                <Row key={p.deal} href={`/pm/projects?deal=${encodeURIComponent(p.deal)}`} title={p.name || p.cus}
                  sub={`${p.cus} · PM ${p.pm} · เสร็จ ${pr.pct}% (${pr.done}/${pr.all} งาน)`}
                  right={
                    <em className={`num text-[12.5px] font-semibold not-italic ${d === null ? "text-muted-foreground" : d < 0 ? "text-destructive" : d <= SOON_DAYS ? "text-[#B4630B]" : "text-muted-foreground"}`}>
                      {d === null ? "ยังไม่มีกำหนดส่งมอบ" : d < 0 ? `เลยกำหนด ${-d} วัน` : `ส่งมอบอีก ${d} วัน`}
                    </em>
                  } />
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function LeaveState({ l }: { l: TeamLeave }) {
  return (
    <em className={`text-[12.5px] font-semibold not-italic ${l.pending ? "text-[#B4630B]" : "text-muted-foreground"}`}>
      {l.pending ? "รออนุมัติ" : "อนุมัติแล้ว"}
    </em>
  );
}

// ─── โครงร่างที่ใช้ซ้ำ ────────────────────────────────────────────

function Kpi({ label, value, sub, bad }: { label: string; value: number; sub: string; bad?: boolean }) {
  return (
    <div className="glass min-w-0 rounded-[18px] px-[18px] py-4 max-sm:px-3.5 max-sm:py-3">
      <em className="block text-xs font-semibold text-muted-foreground not-italic">{label}</em>
      <b className={`num mt-[3px] block text-[26px] leading-[1.15] font-extrabold tracking-[-.02em] ${bad ? "text-destructive" : ""}`}>
        {value}
      </b>
      <span className="mt-1 block truncate text-[11.5px] leading-normal text-muted-foreground" title={sub}>
        {sub}
      </span>
    </div>
  );
}

function Card({
  title,
  more,
  note,
  children,
}: {
  title: string;
  more?: { href: string; label: string };
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass min-w-0 rounded-[18px] px-5 py-[18px] max-sm:px-4">
      <div className="mb-2 flex items-center justify-between gap-3 max-sm:flex-wrap max-sm:gap-y-1">
        <h2 className="text-[14.5px] font-bold">{title}</h2>
        {more && (
          <Link href={more.href} className="lnk text-[12.5px] font-semibold max-sm:-my-2 max-sm:py-2">
            {more.label}
          </Link>
        )}
        {note && <span className="text-[12.5px] text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** แถวรายการ — ชื่อ + รายละเอียดทางซ้าย สถานะทางขวา · ไม่มี href = ดูอย่างเดียว */
function Row({ href, title, sub, right }: { href?: string; title: string; sub: string; right: React.ReactNode }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[13.5px] font-semibold group-hover:text-primary">{title}</b>
        <span className="block truncate text-[12px] text-muted-foreground max-sm:whitespace-normal">{sub}</span>
      </span>
      <span className="flex-none text-right">{right}</span>
    </>
  );
  const cls = "group flex items-center gap-3 border-t border-border py-2.5";
  return (
    <li>
      {href ? (
        <Link href={href} className={cls}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

function None({ children }: { children: React.ReactNode }) {
  return <p className="py-3.5 text-[13px] text-muted-foreground">{children}</p>;
}
