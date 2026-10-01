"use client";

import Link from "next/link";

import { useSearchParams } from "next/navigation";
import { settings } from "@/lib/system-settings";
import { Fragment, useEffect, useRef, useMemo, useState } from "react";
import {
  currentPeriod,
  leavePeriods,
  leaveYearOf,
  periodRange,
  leaveTypes,
  type LeaveRecord,
  type LeaveStatus,
} from "@/lib/leave-data";
import {
  cancelLeaveRequest,
  carriedDays,
  entitlementDays,
  leaveUsage,
  useLeaveRecords,
} from "@/lib/leave-store";
import { formatMinutesOfDay } from "@/lib/work-schedule";
import { ApproverNote } from "./approver-note";
import { LeaveDialog } from "./leave-dialog";
import { useMyLeavePolicy } from "@/lib/leave-policy";
import { HR_EMPTYPE } from "@/lib/hr-data";
import { Sheet } from "./lead-dialogs";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, LeaveIcon, PlusIcon } from "./icons";

const PER_PAGE = 10;

const TH_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

const TH_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

const STATUS_CLASS: Record<LeaveStatus, string> = {
  รอการอนุมัติ: "t-early",
  อนุมัติแล้ว: "t-ok",
  ไม่อนุมัติ: "t-late",
  /* ยกเลิกเป็นสีกลาง ๆ — ใบยังอยู่ในรายการแต่ไม่นับเป็นวันลา */
  ยกเลิก: "bg-muted text-muted-foreground",
};

const TABS: { key: "all" | LeaveStatus; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "รอการอนุมัติ", label: "รอการอนุมัติ" },
  { key: "อนุมัติแล้ว", label: "อนุมัติแล้ว" },
  { key: "ไม่อนุมัติ", label: "ไม่อนุมัติ" },
  { key: "ยกเลิก", label: "ยกเลิก" },
];

const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** 1 เม.ย. 69 — สั้นพอให้ช่วงรอบปีอยู่บรรทัดเดียวในแถบเลือกปี */
function shortThai(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MON[m - 1]} ${String(y + 543).slice(2)}`;
}

/*
 * สีแผ่นไอคอนของการ์ดสิทธิ์วันลา — วนตามลำดับประเภท ใช้โทนชุดเดียวกับหน้าอื่นในดีไซน์ใหม่
 * ประเภทการลาผู้ดูแลเพิ่มเองได้ จึงไม่ผูกสีไว้กับชื่อประเภท
 */
const QUOTA_TONE = [
  "bg-[var(--accent)] text-primary",
  "bg-[var(--info-soft)] text-[var(--info)]",
  "bg-[var(--success-soft)] text-[var(--success)]",
  "bg-[var(--warning-soft)] text-[var(--warning)]",
];

export function LeavePage() {
  const records = useLeaveRecords();
  const params = useSearchParams();
  /* ลิงก์จากแจ้งเตือน LINE — /leave?find=LV-2569-0123 เปิดรอบปีของใบนั้นแล้วไฮไลต์ให้ */
  const findId = useSearchParams().get("find") ?? "";
  const found = records.find((r) => r.id === findId);
  const LEAVE_PERIODS = leavePeriods();
  const CURRENT_PERIOD = currentPeriod();
  const [periodIndex, setPeriodIndex] = useState(() => {
    const periods = leavePeriods();
    const year = found ? String(leaveYearOf(found.date)) : "";
    const i = year ? periods.findIndex((p) => p.startsWith(year)) : -1;
    return i >= 0 ? i : Math.max(0, periods.indexOf(currentPeriod()));
  });
  const [tab, setTab] = useState<"all" | LeaveStatus>("all");
  const [page, setPage] = useState(1);
  /* หน้าบันทึกเวลาส่งลิงก์ ?new=1&date=... มาเปิดฟอร์มพร้อมวันที่ให้เลย */
  const presetDate = params.get("date") ?? undefined;
  const [dialogOpen, setDialogOpen] = useState(params.get("new") !== null);
  const [flash, setFlash] = useState<number | null>(null);
  /* ใบที่กำลังกดยกเลิก — ต้องกรอกเหตุผลก่อน ใบไม่ถูกลบทิ้ง (ผู้ใช้ตัดสิน 23 ก.ย. 2569) */
  const [cancelling, setCancelling] = useState<LeaveRecord | null>(null);
  /* กติกาวันลาของคนที่ล็อกอินอยู่ — ประจำ / ทดลองงาน / ฝึกงาน คนละกติกากัน */
  const policy = useMyLeavePolicy();
  /* ใบที่กำลังแก้ — เปิดกล่องเดียวกับตอนยื่น แต่เติมค่าเดิมไว้ให้ (เจ้าของสั่ง 29 ก.ย. 2569) */
  const [editing, setEditing] = useState<LeaveRecord | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const period = LEAVE_PERIODS[periodIndex];
  const year = Number(period.slice(0, 4));
  const [pFrom, pTo] = periodRange(period);

  const inPeriod = useMemo(
    () => records.filter((r) => r.date >= pFrom && r.date <= pTo),
    [records, pFrom, pTo],
  );

  const scoped = useMemo(() => {
    const list = tab === "all" ? inPeriod : inPeriod.filter((r) => r.status === tab);
    return [...list].sort((a, b) => b.date.localeCompare(a.date));
  }, [inPeriod, tab]);

  const maxPage = Math.max(1, Math.ceil(scoped.length / PER_PAGE));
  const safePage = Math.min(page, maxPage);
  const from = (safePage - 1) * PER_PAGE;
  const list = scoped.slice(from, from + PER_PAGE);

  const approvedDays = inPeriod
    .filter((r) => r.status === "อนุมัติแล้ว")
    .reduce((sum, r) => sum + r.days, 0);

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <ApproverNote kind="leave" />
        </div>
        <div className="tools w-full flex-wrap sm:w-auto">
          <div className="mo glass-thin w-full justify-center sm:w-auto">
            <button
              type="button"
              disabled={periodIndex === 0}
              onClick={() => {
                setPeriodIndex((v) => v - 1);
                setPage(1);
              }}
              aria-label="ปีก่อนหน้า"
            >
              <ChevronLeftIcon className="size-[15px]" strokeWidth={2.4} />
            </button>
            {/* รอบที่ไม่ได้เริ่ม 1 ม.ค. บอกช่วงวันเต็ม ๆ จะได้ไม่งงว่าปีไหน */}
            <span>
              {pFrom.endsWith("-01-01") ? `ปี ${year + 543}` : `${shortThai(pFrom)} – ${shortThai(pTo)}`}
            </span>
            <button
              type="button"
              disabled={periodIndex >= LEAVE_PERIODS.indexOf(CURRENT_PERIOD)}
              onClick={() => {
                setPeriodIndex((v) => v + 1);
                setPage(1);
              }}
              aria-label="ปีถัดไป"
            >
              <ChevronRightIcon className="size-[15px]" strokeWidth={2.4} />
            </button>
          </div>
          {/* มือถือ: ปุ่มลอยเหนือแถบเมนูล่าง แบบเดียวกับหน้าโอที (เจ้าของสั่ง 1 ต.ค. 2569) */}
          <button
            type="button"
            className="btn solid btn-solid btn-block-mobile fab-mobile shrink-0"
            onClick={() => setDialogOpen(true)}
          >
            <PlusIcon className="size-[15px]" strokeWidth={2.2} />
            <span className="lbl">ยื่นใบลา</span>
          </button>
        </div>
      </div>

      {flash !== null && (
        <p className="flex items-center gap-2.5 rounded-xl border border-[var(--success)]/20 bg-[var(--success-soft)] px-4 py-3 text-sm font-medium text-[var(--success)]">
          <CheckIcon className="size-4 shrink-0" strokeWidth={2.4} />
          ส่งใบลา {flash} วันเรียบร้อย — รอหัวหน้าอนุมัติ
        </p>
      )}

      {/*
        กติกาวันลาต่างกันตามประเภทการจ้าง (เอกสารฝ่ายบุคคล 30 ก.ย. 2569)
        ทดลองงานกับฝึกงานไม่มีโควตา จึงไม่ต้องขึ้นการ์ดสิทธิ์ให้เข้าใจผิดว่ามีวันลาสะสม
      */}
      {!policy.quota && (
        <p className="glass flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
          <LeaveIcon className="mt-0.5 size-4 flex-none text-primary" strokeWidth={2.2} />
          <span>
            <b className="font-semibold text-foreground">{HR_EMPTYPE[policy.type].label}</b> · {policy.note}
          </span>
        </p>
      )}

      {/* ── สิทธิ์คงเหลือแบบย่อสำหรับมือถือ ──
         เจ้าของสั่ง 30 ก.ย. 2569 ให้เอาการ์ดตัวเลขใหญ่ (KPI) ออกจากจอมือถือ
         เหลือแถวเดียวอ่านรวดเดียวจบ แบบเดียวกับ "วันนี้ของฉัน" ในหน้าหลัก */}
      {policy.quota && (
        <ul className="flex list-none rounded-[16px] border border-[#E3D3D7] bg-white p-0 py-3 md:hidden">
          {leaveTypes().filter((t) => entitlementDays(t, period) > 0).map((t) => {
            const q = leaveUsage(records, t, period);
            return (
              <li
                key={t}
                className="flex flex-1 flex-col items-center gap-0.5 border-r border-[#D9C8CC] px-1 text-center last:border-r-0"
              >
                <b className="num text-[17px] leading-tight font-bold whitespace-nowrap">
                  {round1(q.remaining)}
                  <span className="ml-0.5 text-[11px] font-semibold text-[#6B5F62]">วัน</span>
                </b>
                <span className="truncate text-[11px] text-[#8A7E81]">{t}คงเหลือ</span>
                {q.pending > 0 && (
                  <em className="num text-[10.5px] font-medium text-[var(--warning)] not-italic">
                    รอ {round1(q.pending)}
                  </em>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── สิทธิ์คงเหลือแต่ละประเภท (จอคอม) ── */}
      <div className={`grid grid-cols-2 gap-2.5 max-md:hidden sm:gap-3.5 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] ${policy.quota ? "" : "hidden"}`}>
        {leaveTypes().filter((t) => entitlementDays(t, period) > 0).map((t, n) => {
          const base = entitlementDays(t, period);
          /* ลาพักร้อนที่ยกมาจากปีก่อน (ถ้าผู้ดูแลระบบเปิดให้ยกยอด) รวมเข้าไปในสิทธิ์ของปีนี้ */
          const carried = carriedDays(records, t, period);
          /* ตัวเลขทั้งการ์ดมาจากตัวคำนวณชุดเดียวของระบบ — ห้ามบวกลบเอง
             ไม่งั้นการ์ดกับกล่องยื่นใบลาและหน้าอนุมัติจะพูดคนละเลขอีก (24 ก.ย. 2569) */
          const q = leaveUsage(records, t, period);
          const total = q.entitled;
          const left = q.remaining;
          const pct = total ? Math.min(100, Math.round((q.approved / total) * 100)) : 0;
          return (
            <div key={t} className="glass flex h-full flex-col rounded-2xl px-3.5 py-3 sm:px-[17px] sm:py-[15px]">
              {/* หัวการ์ดอยู่บรรทัดเดียวเสมอ — ชื่อยาวให้ตัดท้าย ไม่ดันให้การ์ดสูงไม่เท่ากัน */}
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <i className={`grid size-[26px] flex-none place-items-center rounded-[9px] ${QUOTA_TONE[n % QUOTA_TONE.length]}`}>
                    <LeaveIcon className="size-3.5" strokeWidth={2.2} />
                  </i>
                  <b className="min-w-0 text-[13.5px] leading-tight font-semibold">{t}</b>
                </span>
                {/* จอแคบไม่ต้องมีป้ายสิทธิ์ต่อปี — บรรทัด "ใช้ไปแล้ว x จาก y วัน" บอกอยู่แล้ว
                    เอาออกแล้วชื่อประเภทการลาได้ความกว้างเต็ม ไม่ถูกตัดท้าย */}
                <em className="glass-thin flex-none rounded-full px-[9px] py-0.5 text-[11.5px] font-semibold text-muted-foreground not-italic max-md:hidden">
                  {base} วัน/ปี
                </em>
              </div>
              <p className="num mt-2 text-[24px] leading-tight font-bold sm:text-[27px]">
                {round1(left)}
                <span className="ml-1.5 text-[12px] font-semibold text-muted-foreground sm:text-[13px]">
                  วันคงเหลือ
                </span>
              </p>
              <p className="num mt-0.5 text-xs text-muted-foreground">
                ใช้ไปแล้ว {round1(q.approved)} จาก {round1(total)} วัน
                {carried > 0 && ` (ยกมาจากปีก่อน ${round1(carried)} วัน)`}
              </p>
              <span className="grow" aria-hidden="true" />
              {/* ยื่นแล้วแต่ยังไม่อนุมัติ — ยังไม่หักสิทธิ์ แต่ต้องเห็นว่าค้างอยู่เท่าไร */}
              {q.pending > 0 && (
                <p className="num mt-0.5 text-xs font-medium text-[var(--warning)]">
                  รออนุมัติ {round1(q.pending)} วัน · อนุมัติครบจะเหลือ {round1(q.afterPending)} วัน
                </p>
              )}
              {/* ลาเกินสิทธิ์ไปแล้ว — ส่วนที่เกินเป็นลาไม่รับค่าจ้าง พูดให้ตรงกับกล่องยื่นใบลา */}
              {q.over > 0 && (
                <p className="num mt-0.5 text-xs font-medium text-destructive">
                  ลาเกินสิทธิ์ {round1(q.over)} วัน — ส่วนที่เกินถูกหักจากเงินเดือน
                </p>
              )}
              <span className="mt-auto block h-[5px] translate-y-0 overflow-hidden rounded bg-black/10">
                <i className="block h-full rounded bg-primary" style={{ width: `${pct}%` }} />
              </span>
            </div>
          );
        })}
      </div>

      {/* ── รายการใบลา ── */}
      <section className="panel glass flex flex-col max-md:mb-[120px] max-md:border-0! max-md:bg-transparent! max-md:shadow-none!">
        <div className="strip">
          <div className="tabs">
            {TABS.map((t) => {
              const count =
                t.key === "all"
                  ? inPeriod.length
                  : inPeriod.filter((r) => r.status === t.key).length;
              return (
                <button
                  key={t.key}
                  type="button"
                  className={tab === t.key ? "on" : ""}
                  onClick={() => {
                    setTab(t.key);
                    setPage(1);
                  }}
                >
                  {t.label} <b>{count}</b>
                </button>
              );
            })}
          </div>
          <div className="legend hidden! sm:flex!">
            <span><i style={{ background: "var(--warning)" }} />รอการอนุมัติ</span>
            <span><i style={{ background: "var(--success)" }} />อนุมัติแล้ว</span>
            <span><i style={{ background: "var(--destructive)" }} />ไม่อนุมัติ</span>
            <span><i style={{ background: "var(--ink-faint,#9AA1AE)" }} />ยกเลิก</span>
          </div>
        </div>

        <div className="scroll-stable hidden min-h-0 flex-1 overflow-auto md:block">
          <table className="data-table min-w-[900px]">
            <thead>
              <tr>
                <th style={{ width: 158 }}>เลขที่คำขอ</th>
                <th style={{ width: 118 }}>ประเภท</th>
                <th style={{ width: 196 }}>ช่วงวันลา</th>
                <th className="c" style={{ width: 104 }}>จำนวนวัน</th>
                <th>เหตุผล</th>
                <th style={{ width: 132 }}>สถานะ</th>
                <th className="c" style={{ width: 96 }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-[50px] text-center text-muted-foreground">
                    ไม่มีรายการในหมวดนี้
                  </td>
                </tr>
              ) : (
                list.map((r) => (
                  <LeaveRow key={r.id} row={r} hit={r.id === findId} onCancel={() => setCancelling(r)} onEdit={() => setEditing(r)} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* มือถือ: แสดงทั้งรอบ ไม่แบ่งหน้า แทรกหัวข้อเดือนคั่น (ต้นแบบ leave.html 1 ต.ค. 2569) */}
        <ul className="flex flex-col gap-2.5 pt-2.5 md:hidden">
          {scoped.length === 0 ? (
            <li className="rounded-[20px] bg-white px-5 py-10 text-center text-[#A3979A] shadow-[0_1px_2px_rgb(40_20_25/0.04)]">
              ไม่มีรายการในหมวดนี้
            </li>
          ) : (
            scoped.map((r, i) => (
              <Fragment key={r.id}>
                {monthKey(r.date) !== monthKey(scoped[i - 1]?.date) && (
                  <li className="px-1 pt-1.5 text-[15px] font-bold">{thaiMonth(r.date)}</li>
                )}
                <MobileLeaveRow row={r} hit={r.id === findId} onCancel={() => setCancelling(r)} onEdit={() => setEditing(r)} />
              </Fragment>
            ))
          )}
        </ul>

        {/* มือถือไม่ต้องมีแถบสรุปท้ายรายการ — สิทธิ์คงเหลืออยู่ในแถวด้านบนแล้ว และปุ่มลอยจะทับพอดี */}
        <div className="foot flex-col items-stretch gap-3 text-center max-md:hidden! sm:flex-row sm:items-center sm:text-left">
          <span>
            {scoped.length === 0
              ? "แสดง 0 รายการ"
              : `แสดง ${from + 1}–${from + list.length} จาก ${scoped.length} รายการ`}
          </span>
          <span className="sum">
            วันลาที่อนุมัติแล้วรวม<b>{round1(approvedDays)}</b> วัน
          </span>
          <div className="pages justify-center sm:justify-start">
            <button
              type="button"
              className="glass-thin"
              disabled={safePage === 1}
              onClick={() => setPage(safePage - 1)}
              aria-label="ก่อนหน้า"
            >
              ‹
            </button>
            {Array.from({ length: maxPage }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className={`glass-thin ${n === safePage ? "on" : ""}`}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className="glass-thin"
              disabled={safePage === maxPage}
              onClick={() => setPage(safePage + 1)}
              aria-label="ถัดไป"
            >
              ›
            </button>
          </div>
        </div>
      </section>

      {cancelling && (
        <CancelLeaveDialog row={cancelling} onClose={() => setCancelling(null)} />
      )}

      {(dialogOpen || editing) && (
        <LeaveDialog
          period={period}
          records={records}
          presetDate={editing ? undefined : presetDate}
          edit={editing ?? undefined}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          onSubmitted={(days) => {
            setFlash(days);
            if (flashTimer.current) clearTimeout(flashTimer.current);
            flashTimer.current = setTimeout(() => setFlash(null), 6000);
            setTab("all");
            setPage(1);
          }}
        />
      )}
    </div>
  );
}

function LeaveRow({ row, hit, onCancel, onEdit }: { row: LeaveRecord; hit?: boolean; onCancel: () => void; onEdit: () => void }) {
  const canCancel = row.status === "รอการอนุมัติ";
  const partial =
    row.startMin != null && row.endMin != null
      ? row.hours
        ? /* ลาด่วนรายชั่วโมง — บอกชั่วโมงที่ลา ไม่ใช่ครึ่งวันเช้า/บ่าย */
          `ลาด่วน ${row.hours} ชม. ${formatMinutesOfDay(row.startMin)}–${formatMinutesOfDay(row.endMin)}`
        : `ครึ่งวัน${row.half === "afternoon" ? "บ่าย" : "เช้า"} ${formatMinutesOfDay(row.startMin)}–${formatMinutesOfDay(row.endMin)}`
      : null;

  return (
    <tr className={hit ? "ring-2 ring-primary ring-inset" : undefined}>
      <td className="day">
        <b>{shortId(row.id)}</b>
        {/* วันที่ยื่นจริง — ใบเก่าที่ไม่ได้เก็บเวลายื่นไว้ ใช้วันแรกของช่วงลาแทน */}
        <span>
          ยื่น {thaiDate(row.submittedAt ? row.submittedAt.slice(0, 10) : row.date)}
          {row.editedAt ? ` · แก้ไข ${thaiDate(row.editedAt.slice(0, 10))}` : ""}
        </span>
      </td>
      <td>{row.type}</td>
      <td>
        {/* กดช่วงวันลาเพื่อไปดูเวลาทำงานของเดือนนั้น ว่าวันที่ลาถูกบันทึกไว้อย่างไร */}
        <Link
          href={`/records?month=${row.date.slice(0, 7)}`}
          className="clip hover:text-primary hover:underline"
        >
          {thaiRange(row.date, row.toDate)}
        </Link>
        {partial && <span className="why">{partial}</span>}
      </td>
      <td className="c num">
        <b className="font-semibold">{round1(row.days)}</b>
      </td>
      <td>
        <span className="clip">{row.comment || "—"}</span>
        {/* ใบที่ยกเลิกแล้ว — เหตุผลและผู้ยกเลิกต้องตามรอยย้อนหลังได้ */}
        {row.status === "ยกเลิก" && (
          <span className="why">
            ยกเลิก: {row.cancelReason || "—"}
            {row.cancelledBy ? ` · โดย ${row.cancelledBy}` : ""}
          </span>
        )}
      </td>
      <td>
        <span className={`tag ${STATUS_CLASS[row.status]}`}>
          <i />
          {row.status}
        </span>
      </td>
      <td className="c">
        {canCancel ? (
          <span className="flex items-center justify-center gap-2.5">
            <button type="button" className="lnk" onClick={onEdit}>
              แก้ไข
            </button>
            <button type="button" className="lnk" onClick={onCancel}>
              ยกเลิก
            </button>
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

/**
 * ใบลาหนึ่งใบในรูปการ์ด สำหรับจอแคบ — ต้นแบบ leave.html (#lv-mobile · 1 ต.ค. 2569)
 * บนสุด: วงไอคอนปฏิทิน + ประเภทการลา + จำนวนวันชิดขวา · ใต้ลงมาคือเหตุผล
 * เส้นประคั่น แล้วแถวล่างเป็นช่วงวันลา + สถานะ และบรรทัดสุดท้ายเลขที่คำขอ + ปุ่มจัดการ
 */
function MobileLeaveRow({ row, hit, onCancel, onEdit }: { row: LeaveRecord; hit?: boolean; onCancel: () => void; onEdit: () => void }) {
  const canCancel = row.status === "รอการอนุมัติ";
  const partial =
    row.startMin != null && row.endMin != null
      ? row.hours
        ? /* ลาด่วนรายชั่วโมง — บอกชั่วโมงที่ลา ไม่ใช่ครึ่งวันเช้า/บ่าย */
          `ลาด่วน ${row.hours} ชม. ${formatMinutesOfDay(row.startMin)}–${formatMinutesOfDay(row.endMin)}`
        : `ครึ่งวัน${row.half === "afternoon" ? "บ่าย" : "เช้า"} ${formatMinutesOfDay(row.startMin)}–${formatMinutesOfDay(row.endMin)}`
      : null;

  return (
    <li
      className={`rounded-[20px] bg-white p-3.5 shadow-[0_1px_2px_rgb(40_20_25/0.04),0_12px_28px_-20px_rgb(120_20_35/0.3)] ${
        hit ? "ring-2 ring-primary ring-inset" : ""
      }`}
    >
      <div className="flex gap-2.5">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-[#E8F0FC] text-[#1A5DB5]">
          <LeaveIcon className="size-[19px]" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2.5">
            <b className="min-w-0 text-[15px] font-bold">{row.type}</b>
            <span className="num flex-none text-[15px] font-bold whitespace-nowrap">
              {round1(row.days)} <span className="font-semibold">วัน</span>
            </span>
          </div>
          {row.comment && (
            <p className="mt-0.5 text-[13px] leading-snug break-words text-[#6E6164]">{row.comment}</p>
          )}
          {row.status === "ยกเลิก" && (
            <p className="mt-0.5 text-[12px] break-words text-[#9A8E91]">
              ยกเลิก: {row.cancelReason || "—"}
              {row.cancelledBy ? ` · โดย ${row.cancelledBy}` : ""}
            </p>
          )}
        </div>
      </div>

      <hr className="mt-2 mb-1.5 border-0 border-t-[1.5px] border-dashed border-[#ECE3E5]" />

      <div className="flex items-start justify-between gap-2.5">
        <span className="min-w-0 text-[12.5px] font-semibold text-[#6E6164]">
          <Link href={`/records?month=${row.date.slice(0, 7)}`} className="flex items-center gap-1.5 hover:text-primary">
            <LeaveIcon className="size-3.5 flex-none text-[#8A7E81]" strokeWidth={2.2} />
            <span className="num">{thaiRange(row.date, row.toDate)}</span>
          </Link>
          {partial && <span className="mt-0.5 block pl-[19px] text-[11.5px] font-medium text-[#9A8E91]">{partial}</span>}
        </span>
        <span className={`tag flex-none ${STATUS_CLASS[row.status]}`}>
          <i />
          {row.status}
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2.5">
        <span className="num text-[12px] whitespace-nowrap text-[#9A8E91]">{shortId(row.id)}</span>
        {canCancel && (
          <span className="flex flex-none items-center gap-4">
            <button type="button" className="lnk" onClick={onEdit}>
              แก้ไข
            </button>
            <button type="button" className="lnk" onClick={onCancel}>
              ยกเลิก
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * กล่องยืนยันยกเลิกใบลา — ต้องกรอกเหตุผลก่อน
 * ใบไม่ถูกลบ เปลี่ยนเป็นสถานะ "ยกเลิก" เก็บเหตุผล ผู้ยกเลิก และเวลาไว้ เลขที่จึงไม่ถูกใช้ซ้ำ
 */
function CancelLeaveDialog({ row, onClose }: { row: LeaveRecord; onClose: () => void }) {
  const [why, setWhy] = useState("");
  const [warn, setWarn] = useState(false);

  function send() {
    if (!why.trim()) return setWarn(true);
    cancelLeaveRequest(row.id, why.trim());
    onClose();
  }

  return (
    <Sheet
      title={`ยกเลิกใบลา ${shortId(row.id)}`}
      onClose={onClose}
      footer={
        <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:justify-end">
          <button type="button" className="btn glass-thin h-11 justify-center rounded-[12px]" onClick={onClose}>
            ไม่ยกเลิกแล้ว
          </button>
          <button
            type="button"
            className="btn solid h-11 justify-center rounded-[12px] !bg-primary !text-white hover:!bg-[#B00018]"
            onClick={send}
          >
            ยืนยันยกเลิกใบลา
          </button>
        </div>
      }
    >
      <p className="text-[13.5px] leading-[1.7] text-muted-foreground">
        {row.type} {thaiRange(row.date, row.toDate)} รวม {round1(row.days)} วัน
        <span className="mt-1 block">
          ใบลานี้จะไม่ถูกลบ แต่เปลี่ยนเป็นสถานะ “ยกเลิก” และเลขที่ {shortId(row.id)} จะไม่ถูกนำไปใช้ซ้ำ
        </span>
      </p>
      <label htmlFor="leave-cancel-why" className="mt-3.5 mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
        เหตุผลที่ยกเลิก
      </label>
      <textarea
        id="leave-cancel-why"
        autoFocus
        value={why}
        onChange={(e) => {
          setWhy(e.target.value);
          if (e.target.value.trim()) setWarn(false);
        }}
        placeholder="เช่น เลื่อนวันเดินทาง ไม่ต้องลาแล้ว"
        className="field-control h-[78px] w-full resize-y rounded-[10px] px-[11px] py-[9px] text-[13.5px] leading-[1.5]"
      />
      {warn && (
        <p className="mt-[9px] rounded-[11px] border border-[rgba(192,18,31,.2)] bg-[var(--destructive-soft)] px-[13px] py-2.5 text-[12.5px] leading-[1.55] text-destructive">
          ยกเลิกใบลาต้องระบุเหตุผล เพราะใบลายังเก็บไว้เป็นประวัติ
        </p>
      )}
    </Sheet>
  );
}

function round1(n: number) {
  /* ลาด่วนรายชั่วโมงได้วันเป็นเศษสองตำแหน่ง (0.25 วัน) ปัดทศนิยมเดียวแล้วเลขจะเพี้ยน */
  return Math.round(n * 100) / 100;
}

/*
 * เลขที่คำขอ — รหัสใบลามีตัวนำหน้าติดมาแล้ว (nextDocNo) แสดงตามนั้นเลย ห้ามเติมซ้ำ
 * ตัวนำหน้าตั้งได้ที่หน้าตั้งค่า จึงห้ามเขียน "LV-" ตายตัวที่นี่ (ใบเก่าที่ไม่มีตัวนำหน้าค่อยเติมให้)
 */
function shortId(id: string) {
  const up = id.toUpperCase();
  return /^[A-Z0-9]+-/.test(up) ? up : `${settings().docs.leave}-${up.slice(-6)}`;
}

/** คีย์เดือนของใบลา ใช้เทียบว่าต้องขึ้นหัวข้อเดือนใหม่ไหม */
function monthKey(iso?: string) {
  return iso ? iso.slice(0, 7) : "";
}

function thaiMonth(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return `${TH_MONTHS_FULL[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function thaiDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function thaiRange(a: string, b: string) {
  return a === b ? thaiDate(a) : `${thaiDate(a)} – ${thaiDate(b)}`;
}
