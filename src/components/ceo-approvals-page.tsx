"use client";

/*
 * คำขออนุมัติของผู้บริหาร (ตามต้นแบบ dose-erp-maz/ceo-approvals.html)
 *
 * สองส่วน
 * 1. ยอดเงินเดือนรออนุมัติ — ฝ่ายบุคคลส่งยอดของแต่ละรอบ/กลุ่มมา CEO อนุมัติแล้วฝ่ายบุคคลจึงปิดรอบได้
 *    ตีกลับต้องมีเหตุผล ฝ่ายบุคคลเห็นบนป้ายสถานะแล้วแก้ไขส่งใหม่
 * 2. คำขอของพนักงานแบบห้องแชท — แยกห้องตามพนักงาน คำขอเป็นการ์ดฝั่งซ้าย ผลการตัดสินเป็นข้อความฝั่งขวา
 *    ใครส่งอะไรมาถึงผู้บริหาร กำหนดที่สายอนุมัติใน role.ts (approvesFor) หน้านี้ไม่ตัดสินเอง
 *    คนที่ล็อกอินได้อ่านจากใบลา/โอที/ใบเบิกของบทบาทนั้น · พนักงานที่ยังไม่มีบัญชีอ่านจาก emp-requests.ts
 *    อนุมัติกดแล้วบันทึกทันทีตามต้นแบบ · ไม่อนุมัติต้องพิมพ์เหตุผลในช่องด้านล่างก่อนส่ง
 *
 * ?req=<id> จากแดชบอร์ดหรือ LINE เปิดห้องของผู้ขอแล้วเลื่อนไปที่การ์ดนั้น
 */

import { useSearchParams } from "next/navigation";
import { setMobileBack } from "@/lib/mobile-back";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { claimTotal } from "@/lib/expense-data";
import { approveClaim, rejectClaim, useAllClaims } from "@/lib/expense-store";
import {
  TH_MONTHS_SHORT,
  baht,
  bkkStamp,
  daysBetween,
  initials,
  parseIsoDate,
  thaiDate,
  thaiMonth,
  thaiStamp,
  todayIso,
} from "@/lib/format";
import { GROUP_LABEL, ROLE_EMPLOYEE, empOf, hrPos, type PayGroup } from "@/lib/hr-data";
import { decideEmpRequest, useEmpRequests } from "@/lib/emp-requests";
import { decidePayroll, useHr } from "@/lib/hr-store";
import { usePayrollSumFn, usePayrollVoidWatch } from "@/lib/hr-link";
import { approveLeave, quotaAfterLeave, quotaAfterUsed, rejectLeave, useAllLeave } from "@/lib/leave-store";
import { approveOt, rejectOt, useAllOt } from "@/lib/ot-store";
import { approvesFor, useApprovalRoute, type Role } from "@/lib/role";
import { formatMinutesOfDay, minutesOfDay } from "@/lib/work-schedule";
import { ConfirmDialog } from "./confirm-dialog";
import { ChevronRightIcon } from "./icons";
import { OtActualFields, useOtDecision, type OtReq } from "./ot-actual-fields";

type Kind = "leave" | "ot" | "expense";
type Status = "pending" | "approved" | "rejected";

/** คำขอหนึ่งใบในห้องแชท — รวมสามประเภทให้อยู่ในรูปเดียวกัน */
export type CeoRequest = Item;

type Item = {
  kind: Kind;
  /** รหัสพนักงานผู้ขอ — ห้องแชทแยกตามคนนี้ */
  emp: string;
  /** role = ใบของผู้ใช้ที่ล็อกอินได้ (ตัดสินผ่านสโตร์ของบทบาท) · emp = คำขอของพนักงานที่ยังไม่มีบัญชี */
  src: "role" | "emp";
  role?: Role;
  /** รหัสที่ใช้กับ ?req= — ใบลา/โอทีใช้เลขใบ ใบเบิกใช้ บทบาท-เดือน */
  id: string;
  /** คีย์ที่สโตร์ใช้ตัดสิน — ใบเบิกคือเดือน */
  key: string;
  /** เลขที่เอกสาร (LV-/OT-/EX-) — เอกสารที่ใช้เบิกเงินต้องอ้างอิงได้ */
  no: string;
  status: Status;
  /** "yyyy-mm-dd hh:mm" — ใบลาไม่มีเวลายื่น ใช้วันที่ลา */
  at: string;
  hasTime: boolean;
  /** ชื่อคำขอสั้น ๆ เช่น "ลาพักร้อน 2 วัน" */
  title: string;
  label: string;
  big: string;
  lines: string[];
  /** บรรทัดสิทธิ์คงเหลือของใบลา — ติดลบคือเกินสิทธิ์ */
  quota?: number;
  note: string;
  reason: string;
  hours?: number;
  /** ชั่วโมงโอทีที่อนุมัติจริง — ไม่มี = เท่าที่ขอ */
  approvedHours?: number | null;
  /** ช่วงเวลาที่ขอ ใช้เทียบเวลาตอกบัตรจริงตอนตัดสิน — เฉพาะโอที */
  ot?: OtReq;
  /** "yyyy-mm-dd hh:mm" เวลาที่ตัดสิน — ขึ้นเป็นข้อความฝั่งขวาของห้อง */
  decidedAt?: string;
};

const WEEKDAY = ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"];

function statusOf(s: string): Status {
  return s === "อนุมัติแล้ว" ? "approved" : s === "ไม่อนุมัติ" ? "rejected" : "pending";
}

const num2 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** โอทีที่อนุมัติไม่เท่าที่ขอ — คืนชั่วโมงที่อนุมัติ · เท่ากันหรือยังไม่อนุมัติคืน null */
function cutHours(it: Item) {
  if (it.kind !== "ot" || it.status !== "approved" || it.approvedHours == null) return null;
  return it.approvedHours !== it.hours ? it.approvedHours : null;
}

/**
 * คำขอทั้งหมดที่ส่งถึงผู้บริหาร (ใบลา โอที ใบเบิก) เรียงตามเวลายื่น
 * ใช้ทั้งหน้าคำขออนุมัติและตาราง "คำขอรออนุมัติ" ในแดชบอร์ด CEO
 */
export function useCeoRequests(): Item[] {
  const leaves = useAllLeave();
  const ots = useAllOt();
  const claims = useAllClaims();
  const route = useApprovalRoute();
  const extra = useEmpRequests();

  return useMemo(() => {
    const out: Item[] = [];
    for (const { kind, from } of approvesFor("ceo", route)) {
      const emp = ROLE_EMPLOYEE[from] ?? from;
      if (kind === "leave") {
        for (const v of leaves[from]) {
          /* ใบลาที่ยกเลิกแล้วไม่ขึ้นคิวอนุมัติ แต่ยังอยู่ในระบบเป็นประวัติ */
          if (v.status === "ยกเลิก") continue;
          const range = v.date === v.toDate ? thaiDate(v.date) : `${thaiDate(v.date)} – ${thaiDate(v.toDate)}`;
          out.push({
            kind,
            emp,
            src: "role",
            role: from,
            id: v.id,
            key: v.id,
            no: v.id,
            status: statusOf(v.status),
            at: v.submittedAt ?? `${v.date} 00:00`,
            hasTime: Boolean(v.submittedAt),
            title: `${v.type} ${num2(v.days)} วัน`,
            label: v.type,
            big: `${num2(v.days)} วัน`,
            lines: [range],
            /* สิทธิ์หลังลา — สูตรเดียวกับหน้าอนุมัติของ GM และการ์ดในหน้าการลาของผู้ยื่น */
            quota: quotaAfterLeave(leaves[from], v),
            note: statusOf(v.status) === "rejected" ? "" : v.comment,
            reason: statusOf(v.status) === "rejected" ? v.comment : "",
            decidedAt: v.decidedAt,
          });
        }
      }
      if (kind === "ot") {
        for (const v of ots[from]) {
          if (v.status === "ยกเลิก") continue;
          out.push({
            kind,
            emp,
            src: "role",
            role: from,
            id: v.id,
            key: v.id,
            no: v.id,
            status: statusOf(v.status),
            at: v.submittedAt || `${v.date} 00:00`,
            hasTime: Boolean(v.submittedAt),
            title: `OT ${num2(v.hours)} ชั่วโมง`,
            label: "ขอ OT",
            big: `${num2(v.hours)} ชั่วโมง`,
            lines: [thaiDate(v.date), `${formatMinutesOfDay(v.startMin)} – ${formatMinutesOfDay(v.endMin)} น.`],
            note: v.reason,
            reason: v.comment,
            hours: v.hours,
            decidedAt: v.decidedAt,
            approvedHours: v.approvedHours,
            ot: {
              date: v.date,
              startMin: v.startMin,
              endMin: v.endMin,
              hours: v.hours,
              role: from,
            },
          });
        }
      }
      if (kind === "expense") {
        for (const v of claims[from]) {
          if (v.status === "ร่าง") continue;
          const total = claimTotal(v);
          out.push({
            kind,
            emp,
            src: "role",
            role: from,
            id: `${from}-${v.month}`,
            key: v.month,
            no: v.no ?? "",
            status: statusOf(v.status),
            at: v.submittedAt || `${v.month}-01 00:00`,
            hasTime: Boolean(v.submittedAt),
            title: `เบิกค่าใช้จ่าย ${baht(total)} บาท`,
            label: "เบิกค่าใช้จ่าย",
            big: `${baht(total)} บาท`,
            lines: [
              `รอบ ${thaiMonth(v.month)}`,
              `${v.fuel.length} เที่ยว${v.plate ? ` · ทะเบียน ${v.plate}` : ""}`,
            ],
            note: "",
            reason: v.comment,
            decidedAt: v.decidedAt,
          });
        }
      }
    }
    /* พนักงานที่ยังไม่มีบัญชี — OT ของ SA / Dev / Website ขึ้นถึง CEO (CEO-BR-02) */
    for (const r of extra) {
      if (r.to !== "exec") continue;
      const base = {
        emp: r.emp,
        src: "emp" as const,
        id: r.id,
        key: r.id,
        no: r.id,
        status: r.status,
        at: r.at,
        hasTime: true,
        note: r.status === "rejected" ? r.note : r.note,
        reason: r.reason ?? "",
        decidedAt: r.decidedAt,
      };
      if (r.kind === "ot")
        out.push({
          ...base,
          kind: "ot",
          hours: r.hours,
          approvedHours: r.approvedHours ?? null,
          ot:
            r.date && r.start && r.end
              ? {
                  date: r.date,
                  startMin: minutesOfDay(r.start),
                  endMin: minutesOfDay(r.end),
                  hours: r.hours ?? 0,
                  emp: r.emp,
                }
              : undefined,
          title: `OT ${num2(r.hours ?? 0)} ชั่วโมง`,
          label: "ขอ OT",
          big: `${num2(r.hours ?? 0)} ชั่วโมง`,
          lines: [thaiDate(r.date ?? ""), `${r.start} – ${r.end} น.`],
        });
      else {
        const type = r.leaveType ?? "";
        const range =
          r.from === r.toDate ? thaiDate(r.from ?? "") : `${thaiDate(r.from ?? "")} – ${thaiDate(r.toDate ?? "")}`;
        out.push({
          ...base,
          kind: "leave",
          title: `${type} ${num2(r.days ?? 0)} วัน`,
          label: type,
          big: `${num2(r.days ?? 0)} วัน`,
          lines: [range],
          quota: quotaAfterUsed(type, r.used ?? 0, r.days ?? 0),
        });
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }, [route, leaves, ots, claims, extra]);
}

/** เวลาเคลื่อนไหวล่าสุดของคำขอ — ตัดสินแล้วใช้เวลาที่ตัดสิน */
const lastAt = (it: Item) => (it.decidedAt && it.decidedAt > it.at ? it.decidedAt : it.at);

export function CeoApprovalsPage() {
  const params = useSearchParams();
  const reqId = params.get("req") ?? "";
  const today = todayIso();

  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const hr = useHr();
  const person = (id: string) => {
    const e = empOf(hr.emp, id);
    return { name: e?.name ?? id, pos: e ? hrPos(e.pos).label : "" };
  };
  const [replying, setReplying] = useState<Item | null>(null);
  /*
   * มือถือ: เลือกก่อนว่าจะดู "อนุมัติเงินเดือน" หรือ "คำขอของพนักงาน" (ต้นแบบ ceo-approvals.html · ca-tiles)
   * สองเรื่องนี้คนละงานกัน เอามาต่อกันในจอเดียวต้องเลื่อนยาว จอใหญ่ยังเห็นพร้อมกันเหมือนเดิม
   */
  const [pane, setPane] = useState<"" | "pay" | "req">("");

  const items = useCeoRequests();

  /* ห้องละหนึ่งพนักงาน เรียงห้องที่มีความเคลื่อนไหวล่าสุด (ยื่นหรือตัดสิน) ขึ้นก่อน */
  const rooms = useMemo(() => {
    const by = new Map<string, Item[]>();
    for (const it of items) by.set(it.emp, [...(by.get(it.emp) ?? []), it]);
    return [...by.entries()]
      .map(([emp, list]) => {
        const last = list.reduce((x, y) => (lastAt(y) > lastAt(x) ? y : x));
        return { emp, list, last };
      })
      .sort((a, b) => lastAt(b.last).localeCompare(lastAt(a.last)));
  }, [items]);

  const term = q.trim().toLowerCase();
  const shown = rooms.filter((r) => !term || person(r.emp).name.toLowerCase().includes(term));
  const reqRoom = items.find((i) => i.id === reqId)?.emp ?? null;
  /** จำนวนบนป้ายของสองช่อง — ยอดเงินเดือนที่ยังไม่ตัดสิน และคำขอที่ยังรออยู่ทุกห้อง */
  const payWaiting = Object.values(hr.payApprove).filter((a) => a.status === "waiting").length;
  const reqWaiting = items.filter((i) => i.status === "pending").length;
  /* มือถือ: ยังไม่เลือกห้อง = เห็นรายการห้อง · จอใหญ่: เปิดห้องแรกไว้เลย */
  const mobileRoom = sel ?? reqRoom;
  /* มาจากลิงก์ ?req= ให้ข้ามหน้าเลือกไปที่ห้องนั้นเลย */
  const mPane = reqRoom ? "req" : pane;
  /*
   * ปุ่มย้อนกลับบนแถบหัว (มือถือ): อยู่ในห้องของพนักงาน -> กลับไปรายการ · อยู่ในส่วนย่อย -> กลับไปหน้าเลือก
   * ไม่ใช่เด้งออกจากหน้าไปเลย (เจ้าของสั่ง 2 ต.ค. 2569 — แบบเดียวกับสายรอบเงินเดือน)
   */
  useEffect(() => {
    if (!sel && !pane) return;
    setMobileBack(() => {
      if (sel) {
        setSel(null);
        /* ปิดช่องพิมพ์เหตุผลที่ค้างอยู่ด้วย ไม่งั้นกลับเข้าห้องแล้วเจอช่องเปิดค้าง */
        setReplying(null);
      } else setPane("");
    });
    return () => setMobileBack(null);
  }, [sel, pane]);
  const active = mobileRoom ?? rooms[0]?.emp ?? null;
  const room = rooms.find((r) => r.emp === active);

  /* เปิดห้องแล้วเห็นเรื่องล่าสุดก่อนแบบแชท — ถ้ามาจาก ?req= เลื่อนไปที่การ์ดนั้นแทน */
  const feed = useRef<HTMLDivElement>(null);
  const hitRoom = Boolean(reqId) && reqRoom === active;
  useEffect(() => {
    if (hitRoom) document.getElementById(`req-${reqId}`)?.scrollIntoView({ block: "center" });
    else if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [active, hitRoom, reqId]);

  /* hours/comment = ชั่วโมงโอทีที่ปรับตามเวลาตอกบัตรจริง กับเหตุผล (เฉพาะโอที) */
  function approve(it: Item, hours?: number, comment = "") {
    if (it.src === "emp" || !it.role)
      return decideEmpRequest(it.id, true, comment, it.kind === "ot" ? hours : undefined);
    if (it.kind === "leave") approveLeave(it.role, it.key);
    if (it.kind === "ot") approveOt(it.role, it.key, hours ?? it.hours ?? 0, comment);
    if (it.kind === "expense") approveClaim(it.role, it.key, "");
  }

  function reject(it: Item, why: string) {
    if (it.src === "emp" || !it.role) return decideEmpRequest(it.id, false, why);
    if (it.kind === "leave") rejectLeave(it.role, it.key, why);
    if (it.kind === "ot") rejectOt(it.role, it.key, why);
    if (it.kind === "expense") rejectClaim(it.role, it.key, why);
  }


  return (
    <div className="space-y-4">
      {/* มือถือ: เปิดห้องแล้วซ่อนหัวหน้าและแถบเงินเดือน ให้ห้องแชทเต็มจอ — กดกลับก็เห็นเหมือนเดิม */}
      <div className={mobileRoom ? "max-sm:hidden" : ""}>
        <div className="bar">
          <div>
            {/* ต้นแบบมีวันที่ครั้งเดียวที่หัวหน้า (ceo-approvals.html · tk-head) — แถบบนของแอปแสดงให้แล้ว ไม่ซ้ำอีกที่นี่ */}
          </div>
        </div>
      </div>

      {/* มือถือ: สองช่องให้เลือกก่อน หน้าตาเดียวกับการ์ดกลุ่มในสายรอบเงินเดือน (เจ้าของสั่ง 5 ต.ค. 2569) */}
      {mPane === "" && !mobileRoom && (
        <div className="grid grid-cols-2 gap-3 sm:hidden">
          {([
            {
              k: "pay",
              label: "อนุมัติเงินเดือน",
              sub: "ยอดจากฝ่ายบุคคล",
              n: payWaiting,
              unit: "รอบ",
              note: payWaiting ? "รออนุมัติ" : "อนุมัติครบแล้ว",
            },
            {
              k: "req",
              label: "คำขอของพนักงาน",
              sub: "ลา โอที เบิก",
              n: reqWaiting,
              unit: "รายการ",
              note: reqWaiting ? "รอพิจารณา" : "พิจารณาครบแล้ว",
            },
          ] as const).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setPane(t.k)}
              className="flex min-h-[132px] flex-col items-start rounded-[24px] bg-card p-4 text-left shadow-[0_1px_2px_rgb(40_20_25/0.04),0_12px_24px_-20px_rgb(90_20_35/0.45)] active:bg-accent/60"
            >
              <span className="flex w-full items-start justify-between gap-2">
                <span className="min-w-0">
                  <b className="block text-[18px] leading-tight font-bold">{t.label}</b>
                  <small className="mt-0.5 block text-[12px] text-muted-foreground">{t.sub}</small>
                </span>
                <ChevronRightIcon className="mt-1 size-4 flex-none text-muted-foreground" strokeWidth={2.2} />
              </span>
              <span className="mt-auto flex flex-col gap-0.5 pt-3">
                <b className="num text-[22px] leading-none font-bold">
                  {t.n}
                  <small className="ml-1 text-[12px] font-medium text-muted-foreground">{t.unit}</small>
                </b>
                <small className="text-[12px] text-muted-foreground">{t.note}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* มือถือ: บอกว่าอยู่ส่วนไหน — ย้อนกลับใช้ปุ่มบนแถบหัว ไม่ต้องมีปุ่มซ้ำในเนื้อหา
          (เจ้าของสั่ง 5 ต.ค. 2569 · แบบเดียวกับ GroupBack ในสายรอบเงินเดือน) */}
      {mPane !== "" && !mobileRoom && (
        <p className="flex h-9 items-center text-[16px] font-bold sm:hidden">
          {mPane === "pay" ? "อนุมัติเงินเดือน" : "คำขอของพนักงาน"}
        </p>
      )}

      {/* empty:hidden — ไม่มียอดรออนุมัติ กล่องว่างจะได้ไม่กินระยะห่างเพิ่ม */}
      <div className={`empty:hidden ${mobileRoom || mPane !== "pay" ? "max-sm:hidden" : ""}`}>
        <PayrollStrip />
      </div>

      <section
        className={`glass grid overflow-hidden rounded-[14px] max-sm:overflow-clip md:h-[calc(100dvh-200px)] md:min-h-[480px] md:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)] ${
          mPane === "req" || mobileRoom ? "" : "max-sm:hidden"
        }`}
      >
        {/* รายการห้อง */}
        <div className={`${mobileRoom ? "hidden md:flex" : "flex"} min-h-0 flex-col border-border md:border-r`}>
          <div className="border-b border-border p-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ"
              aria-label="ค้นหาชื่อ"
              className="field-control h-9 w-full rounded-[10px] px-3 text-[13px]"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rooms.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">ยังไม่มีคำขอที่ส่งถึงผู้บริหาร</p>
            ) : shown.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">ไม่พบชื่อที่ค้นหา</p>
            ) : (
              shown.map((r) => {
                const wait = r.list.filter((i) => i.status === "pending").length;
                const last = r.last;
                const preview =
                  last.status === "approved"
                    ? "คุณ: อนุมัติ"
                    : last.status === "rejected"
                      ? `คุณ: ${last.reason || "ไม่อนุมัติ"}`
                      : last.title;
                return (
                  <button
                    key={r.emp}
                    type="button"
                    onClick={() => {
                      setSel(r.emp);
                      setReplying(null);
                      /* มือถือ: ห้องเปิดแทนรายการ เลื่อนกลับขึ้นบนให้เห็นหัวห้อง */
                      if (window.matchMedia("(max-width: 639px)").matches) window.scrollTo({ top: 0 });
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted ${
                      r.emp === active ? "md:bg-[var(--destructive-soft)]" : ""
                    }`}
                  >
                    <Face name={person(r.emp).name} size={46} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <b className="min-w-0 flex-1 truncate text-[14px] font-semibold">{person(r.emp).name}</b>
                        <em className="flex-none text-[11.5px] text-muted-foreground not-italic">
                          {whenLabel(last, today)}
                        </em>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{preview}</span>
                        {wait > 0 && (
                          <span className="grid h-5 min-w-5 flex-none place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">
                            {wait}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ห้องแชท */}
        <div className={`${mobileRoom ? "flex" : "hidden md:flex"} min-h-[70dvh] flex-col md:min-h-0`}>
          {!room ? (
            <p className="m-auto text-[13px] text-muted-foreground">เลือกห้องคำขอ</p>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-3 max-sm:sticky max-sm:top-[72px] max-sm:z-10 max-sm:bg-card">
                <Face name={person(room.emp).name} size={38} />
                <span className="min-w-0">
                  <b className="block truncate text-[14.5px] font-semibold">{person(room.emp).name}</b>
                  <em className="text-[12px] text-muted-foreground not-italic">{person(room.emp).pos}</em>
                </span>
              </div>

              <div ref={feed} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#F3F4F7] px-4 py-4">
                {roomEvents(room.list).map((ev, i, all) => {
                  const day = ev.at.slice(0, 10);
                  const newDay = i === 0 || all[i - 1].at.slice(0, 10) !== day;
                  const it = ev.it;
                  return (
                    <Fragment key={`${ev.t}-${it.kind}-${it.id}`}>
                      {newDay && (
                        <p className="py-1 text-center">
                          <span className="inline-block rounded-full bg-black/5 px-3 py-1 text-[11.5px] font-semibold text-muted-foreground">
                            {dayLabel(day, today)}
                          </span>
                        </p>
                      )}
                      {ev.t === "req" ? (
                        <div className="flex items-end gap-2">
                          {/* มือถือ: ไม่มีรูปข้างการ์ด ให้การ์ดกว้างเต็มแถว */}
                          <span className="max-sm:hidden">
                            <Face name={person(room.emp).name} size={30} />
                          </span>
                          <RequestCard
                            it={it}
                            hit={it.id === reqId}
                            replying={replying?.id === it.id}
                            onApprove={(h, c) => approve(it, h, c)}
                            onReject={() => setReplying(it)}
                          />
                          {it.hasTime && (
                            <span className="flex-none pb-1 text-[11px] text-muted-foreground max-sm:hidden">
                              {it.at.slice(11)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-end justify-end gap-2">
                          <span className="flex-none pb-1 text-[11px] text-muted-foreground">{ev.at.slice(11)}</span>
                          <p
                            className={`max-w-[78%] rounded-[18px_18px_4px_18px] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                              it.status === "approved"
                                ? "bg-[var(--success-soft)] text-[var(--success)]"
                                : "bg-primary text-white"
                            }`}
                          >
                            {it.status === "approved"
                              ? cutHours(it) != null
                                ? `อนุมัติ OT ${num2(cutHours(it) ?? 0)} ชั่วโมง (ขอ ${num2(it.hours ?? 0)})`
                                : `อนุมัติ ${it.title}`
                              : it.reason || "ไม่อนุมัติ"}
                            {it.status === "approved" && it.reason && (
                              <span className="block text-[12px] opacity-80">{it.reason}</span>
                            )}
                          </p>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>

              {replying && replying.emp === room.emp && (
                <RejectComposer
                  key={replying.id}
                  item={replying}
                  onCancel={() => setReplying(null)}
                  onSend={(why) => {
                    reject(replying, why);
                    setReplying(null);
                  }}
                />
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── ยอดเงินเดือนรออนุมัติ ────────────────────────────────────────

/*
 * ยอดเงินเดือนรออนุมัติ
 *
 * ⚠️ ห้ามคิดยอดเอง และห้ามเก็บยอดของตัวเอง (ผู้ใช้กำหนด 23 ก.ย. 2569)
 * ยอดที่แสดงคือผลการคำนวณของรอบตัวเดียวกับหน้า /hr/payroll อ่านผ่าน usePayrollSumFn
 * ถ้าอ่านจากยอดที่ฝ่ายบุคคลส่งมา CEO จะอนุมัติเลขหนึ่งแล้วจ่ายอีกเลขหนึ่ง = การอนุมัติไม่มีความหมาย
 * ยอดที่บันทึกไว้ตอนส่งใช้ตรวจอย่างเดียวว่าตัวเลขขยับหลังส่งหรือยัง ขยับเมื่อไรการอนุมัติเป็นโมฆะ
 * (usePayrollVoidWatch ล้างให้เอง แถวนั้นจะหายไปจากคิวจนกว่าฝ่ายบุคคลจะส่งใหม่)
 *
 * ยอดก้อนนี้ใหญ่ที่สุดที่ CEO เซ็นในเดือนหนึ่ง จึงไม่ใช่การกดปุ่มเดียวเหมือนใบลา/โอที
 *   ดูรายชื่อ — กางบรรทัดรายคนของรอบ (sum.lines ชุดเดียวกับ /hr/payroll) ก่อนเซ็น
 *   ยืนยัน   — กล่องยืนยันบอกรอบ กลุ่ม จำนวนคน และยอด แล้วจึงบันทึก
 *   ตีกลับ   — อยู่คนละแถวและห่างจากปุ่มอนุมัติ นิ้วที่พลาดจะได้ไม่ไปโดน
 */
function PayrollStrip() {
  const hr = useHr();
  const sumOf = usePayrollSumFn();
  usePayrollVoidWatch();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const [warn, setWarn] = useState(false);
  /* แถวที่กางรายชื่อไว้ — เซ็นยอดก้อนใหญ่ที่สุดของเดือนต้องเห็นก่อนว่าใครได้เท่าไร */
  const [listing, setListing] = useState<string | null>(null);
  /* แถวที่กำลังยืนยันก่อนอนุมัติ — กดปุ่มเดียวแล้วเซ็นเลยไม่ได้ */
  const [confirming, setConfirming] = useState<string | null>(null);

  const waiting = Object.entries(hr.payApprove)
    .filter(([, a]) => a.status === "waiting")
    .map(([key, a]) => {
      const [month, group] = key.split("|") as [string, PayGroup];
      /* ตัวเลขที่ CEO เห็นและกดอนุมัติ = ผลคำนวณของรอบ ณ ตอนนี้ */
      const sum = sumOf(month, group);
      return { key, month, group, a, sum };
    })
    /* รอบเก่าก่อน · ในรอบเดียวกันรายเดือนก่อนรายวัน (ต้นแบบ) */
    .sort((x, y) => x.month.localeCompare(y.month) || (x.group === "month" ? -1 : 1));

  if (waiting.length === 0) return null;

  return (
    <section className="glass rounded-[14px]">
      <h2 className="px-5 pt-[15px] pb-2 text-[15px] font-bold">
        ยอดเงินเดือนรออนุมัติ <b className="ml-1 text-primary">{waiting.length}</b>
      </h2>
      {waiting.map(({ key, month, group, a, sum }) => (
        <div key={key} className="border-t border-border px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-3.5">
            <div className="min-w-0 flex-1 sm:min-w-[240px]">
              <b className="block text-[14px] font-semibold">
                รอบ {thaiMonth(month)} · {GROUP_LABEL[group]}
              </b>
              {/* จอใหญ่อ่านเป็นบรรทัดเดียว · มือถือแยกเป็นช่องในกรอบเทาตามต้นแบบ (cpay-kv) */}
              <p className="mt-0.5 text-[13px] max-sm:hidden">
                {sum.n} คน · ยอดจ่ายสุทธิ {baht(sum.net)} บาท · นำส่งประกันสังคม {baht(sum.ss * 2)} บาท
              </p>
              <dl className="mt-2.5 rounded-[14px] bg-[#FAF6F7] px-3 sm:hidden">
                {[
                  { k: "จำนวน", v: `${sum.n} คน`, big: false },
                  { k: "ยอดจ่ายสุทธิ", v: `${baht(sum.net)} บาท`, big: true },
                  { k: "นำส่งประกันสังคม", v: `${baht(sum.ss * 2)} บาท`, big: false },
                ].map((r) => (
                  <div
                    key={r.k}
                    className="flex items-center justify-between gap-3 border-b border-[#F0E6E8] py-2.5 last:border-0"
                  >
                    <dt className="text-[13px] text-[#6E6164]">{r.k}</dt>
                    <dd className={`num font-bold ${r.big ? "text-[16px] text-primary" : "text-[14px]"}`}>{r.v}</dd>
                  </div>
                ))}
              </dl>
              {/* ตัวเลขนี้คิดเมื่อไร ต้องอ่านออกจากหน้าจอ ไม่ใช่เดาว่าเป็นของวันนี้ */}
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                คำนวณเมื่อ {thaiStamp(a.sentAt ?? "")} · ฝ่ายบุคคลส่งมา
                {a.sentBy && ` โดย ${empOf(hr.emp, a.sentBy)?.name ?? a.sentBy}`}
              </p>
            </div>
            {/* มือถือ: ปุ่มอยู่แถวเดียวชิดขวาใต้เส้นประ ปุ่มอนุมัติเป็นสีเขียว (ต้นแบบ ceo-approvals.html) */}
            {rejecting !== key && (
              <div className="flex flex-none gap-2 max-sm:w-full max-sm:justify-end max-sm:border-t max-sm:border-dashed max-sm:border-[#ECE3E5] max-sm:pt-3">
                <button
                  type="button"
                  className="btn glass-thin max-sm:!h-10 max-sm:justify-center"
                  aria-expanded={listing === key}
                  onClick={() => setListing(listing === key ? null : key)}
                >
                  {listing === key ? "ซ่อนรายชื่อ" : `ดูรายชื่อ ${sum.n} คน`}
                </button>
                <button
                  type="button"
                  className="btn glass-thin !text-destructive max-sm:!h-10 max-sm:justify-center"
                  onClick={() => {
                    setRejecting(key);
                    setListing(null);
                    setWhy("");
                    setWarn(false);
                  }}
                >
                  ตีกลับ
                </button>
                <button
                  type="button"
                  className="btn solid btn-solid max-sm:!h-10 max-sm:justify-center max-sm:!bg-[var(--success)] max-sm:!bg-none"
                  onClick={() => setConfirming(key)}
                >
                  อนุมัติยอดนี้
                </button>
              </div>
            )}
          </div>

          {/* รายชื่อรายคนของรอบนี้ — บรรทัดชุดเดียวกับหน้า /hr/payroll (sum.lines) ไม่ได้คิดใหม่
              ยอดรวมท้ายตารางจึงตรงกับยอดที่กดอนุมัติเสมอ ถ้าไม่ตรงคือคนละชุดข้อมูล */}
          {listing === key && rejecting !== key && (
            <div className="mt-3 overflow-hidden rounded-[12px] border border-border">
              <ul className="divide-y divide-border text-[12.5px]">
                {sum.lines.map((l) => (
                  <li key={l.id} className="flex items-baseline gap-3 px-3.5 py-2">
                    <span className="min-w-0 flex-1">
                      <b className="block truncate font-semibold">{l.name}</b>
                      <em className="text-[11.5px] text-muted-foreground not-italic">{hrPos(l.pos).label}</em>
                    </span>
                    <span className="num flex-none font-semibold">{baht(l.net)}</span>
                  </li>
                ))}
              </ul>
              <p className="flex items-baseline gap-3 border-t border-border bg-muted px-3.5 py-2 text-[12.5px]">
                <b className="min-w-0 flex-1 font-semibold">รวม {sum.n} คน</b>
                <b className="num flex-none font-bold">{baht(sum.net)} บาท</b>
              </p>
            </div>
          )}
          {rejecting === key && (
            /* ตีกลับต้องมีเหตุผล ฝ่ายบุคคลเห็นบนป้ายสถานะแล้วแก้ไขส่งใหม่ */
            <div className="mt-3 flex flex-wrap items-center gap-2 max-sm:grid max-sm:grid-cols-2">
              <input
                autoFocus
                value={why}
                onChange={(e) => {
                  setWhy(e.target.value);
                  if (e.target.value.trim()) setWarn(false);
                }}
                placeholder="เหตุผลที่ตีกลับ"
                aria-label="เหตุผลที่ตีกลับ"
                className="field-control h-9 min-w-[220px] flex-1 rounded-[10px] px-3 text-[13px] max-sm:col-span-2 max-sm:!h-11 max-sm:min-w-0 max-sm:!text-[16px]"
              />
              <button
                type="button"
                className="btn glass-thin max-sm:!h-12 max-sm:justify-center"
                onClick={() => setRejecting(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn solid btn-solid max-sm:!h-12 max-sm:justify-center"
                onClick={() => {
                  if (!why.trim()) return setWarn(true);
                  decidePayroll(month, group, false, why.trim(), bkkStamp());
                  setRejecting(null);
                }}
              >
                ส่งตีกลับ
              </button>
              {warn && <p className="w-full text-[12.5px] text-destructive max-sm:col-span-2">ใส่เหตุผลก่อนส่ง</p>}
            </div>
          )}
        </div>
      ))}

      {/* ขั้นยืนยันก่อนเซ็น — บอกให้ครบว่ากำลังอนุมัติรอบไหน กลุ่มไหน กี่คน ยอดเท่าไร
          ยอดในกล่องนี้คือตัวเดียวกับที่ส่งเข้า decidePayroll ไม่ได้คิดใหม่อีกชุด */}
      {(() => {
        const w = waiting.find((x) => x.key === confirming);
        if (!w) return null;
        return (
          <ConfirmDialog
            open
            title="อนุมัติยอดเงินเดือน"
            description={`รอบ ${thaiMonth(w.month)} · ${GROUP_LABEL[w.group]} · ${w.sum.n} คน`}
            detail={
              <>
                <b className="num block text-[17px] font-bold">{baht(w.sum.net)} บาท</b>
                <span className="block text-[12.5px] text-muted-foreground">
                  ยอดจ่ายสุทธิ · นำส่งประกันสังคม {baht(w.sum.ss * 2)} บาท
                </span>
                <span className="mt-1 block text-[12.5px] text-muted-foreground">
                  อนุมัติแล้วฝ่ายบุคคลปิดรอบและจ่ายตามยอดนี้
                </span>
              </>
            }
            confirmLabel="อนุมัติยอดนี้"
            onCancel={() => setConfirming(null)}
            /* บันทึกเลขที่เห็นบนจอไปกับการอนุมัติ ขยับเมื่อไรจะได้รู้ว่าขยับจากอะไร */
            onConfirm={() => {
              decidePayroll(w.month, w.group, true, "", bkkStamp(), "CEO", {
                people: w.sum.n,
                net: w.sum.net,
                ss: w.sum.ss,
              });
              setConfirming(null);
              setListing(null);
            }}
          />
        );
      })()}
    </section>
  );
}

// ─── ชิ้นส่วนของห้องแชท ───────────────────────────────────────────

function RequestCard({
  it,
  hit,
  replying,
  onApprove,
  onReject,
}: {
  it: Item;
  hit: boolean;
  replying: boolean;
  onApprove: (hours?: number, comment?: string) => void;
  onReject: () => void;
}) {
  /* โอทีที่รอตัดสิน — เห็นเวลาตอกบัตรจริงและแก้ชั่วโมงได้ก่อนอนุมัติ */
  const ot = useOtDecision(it.status === "pending" && it.ot ? it.ot : null);
  const isOt = it.kind === "ot" && Boolean(it.ot);
  const cut = cutHours(it);
  return (
    <div className="min-w-0 flex-1 sm:max-w-[340px] sm:flex-none">
      <div
        id={`req-${it.id}`}
        className={`w-full sm:w-[340px] overflow-hidden rounded-[18px_18px_18px_4px] bg-white shadow-sm ${
          hit ? "ring-2 ring-primary/50" : ""
        }`}
      >
        <div className="px-4 pt-3.5 pb-3">
          <p className="text-[12px] font-bold text-primary">{it.label}</p>
          {/* เลขที่เอกสาร — ทุกประเภทคำขอต้องอ้างอิงเลขได้ */}
          {it.no && <p className="num mt-0.5 text-[11.5px] text-muted-foreground">{it.no}</p>}
          <p className="num mt-1 text-[22px] leading-tight font-extrabold">{it.big}</p>
          {it.lines.map((l) => (
            <p key={l} className="mt-0.5 text-[12.5px] text-muted-foreground">
              {l}
            </p>
          ))}
          {it.quota !== undefined &&
            (it.quota >= 0 ? (
              <p className="mt-1 text-[12.5px] text-muted-foreground">เหลือสิทธิ์หลังลา {num2(it.quota)} วัน</p>
            ) : (
              <p className="mt-1 text-[12.5px] font-semibold text-destructive">เกินสิทธิ์ {num2(-it.quota)} วัน — ส่วนที่เกินเป็นลาไม่รับค่าจ้าง หักเงินเดือน</p>
            ))}
          {it.note && <p className="mt-2.5 border-t border-border pt-2.5 text-[12.5px] leading-relaxed">{it.note}</p>}
          {isOt && it.status === "pending" && !replying && (
            <div className="mt-2.5 border-t border-border pt-2.5">
              <OtActualFields d={ot} idPrefix={`ceo-${it.id}`} />
            </div>
          )}
        </div>
        {it.status === "pending" ? (
          replying ? (
            <p className="border-t border-border px-4 py-2.5 text-center text-[12.5px] text-muted-foreground">
              กำลังพิมพ์เหตุผลที่ไม่อนุมัติ
            </p>
          ) : (
            /* มือถือ: ปุ่มใหญ่เต็มความกว้างการ์ด อนุมัติเป็นปุ่มแดงทึบ */
            <div className="grid grid-cols-2 border-t border-border text-[13.5px] font-semibold max-sm:gap-2 max-sm:border-t-0 max-sm:px-3 max-sm:pb-3 max-sm:text-[15px]">
              <button
                type="button"
                className="py-2.5 hover:bg-muted max-sm:h-12 max-sm:rounded-[12px] max-sm:border max-sm:border-border"
                onClick={onReject}
              >
                ไม่อนุมัติ
              </button>
              <button
                type="button"
                className="border-l border-border py-2.5 text-primary hover:bg-muted disabled:opacity-40 max-sm:h-12 max-sm:rounded-[12px] max-sm:border-l-0 max-sm:bg-primary max-sm:text-white max-sm:hover:bg-primary"
                disabled={isOt && !ot.ready}
                onClick={() => (isOt ? onApprove(ot.hours, ot.finalComment()) : onApprove())}
              >
                อนุมัติ
              </button>
            </div>
          )
        ) : (
          <p
            className={`border-t border-border px-4 py-2.5 text-center text-[12.5px] font-semibold ${
              it.status === "approved" ? "text-[var(--success)]" : "text-destructive"
            }`}
          >
            {it.status === "approved" ? (cut != null ? `อนุมัติ ${cut.toFixed(2)} ชม.` : "อนุมัติแล้ว") : "ไม่อนุมัติ"}
          </p>
        )}
      </div>
    </div>
  );
}

/** ช่องพิมพ์เหตุผลที่ไม่อนุมัติ — Enter ส่ง · Shift+Enter ขึ้นบรรทัด · Esc ยกเลิก */
function RejectComposer({
  item,
  onCancel,
  onSend,
}: {
  item: Item;
  onCancel: () => void;
  onSend: (why: string) => void;
}) {
  const [why, setWhy] = useState("");
  const [warn, setWarn] = useState(false);

  function send() {
    if (!why.trim()) return setWarn(true);
    onSend(why.trim());
  }

  return (
    <div className="border-t border-border bg-card px-4 py-3 max-sm:sticky max-sm:bottom-[calc(58px+env(safe-area-inset-bottom))] max-sm:z-10 max-sm:shadow-[0_-6px_16px_-10px_rgb(0_0_0/0.25)]">
      <div className="mb-2 flex items-center gap-2 rounded-[10px] bg-muted px-3 py-2 text-[12.5px]">
        <span className="min-w-0 flex-1 truncate">
          ไม่อนุมัติ <b>{item.title}</b>
        </span>
        <button
          type="button"
          className="text-muted-foreground max-sm:-my-2 max-sm:grid max-sm:size-9 max-sm:place-items-center"
          onClick={onCancel}
          aria-label="ยกเลิกการตอบ"
        >
          ✕
        </button>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          autoFocus
          rows={1}
          value={why}
          onChange={(e) => {
            setWhy(e.target.value);
            if (e.target.value.trim()) setWarn(false);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
            if (e.key === "Escape") onCancel();
          }}
          placeholder="เหตุผลที่ไม่อนุมัติ"
          aria-label="เหตุผลที่ไม่อนุมัติ"
          className="field-control min-h-[40px] flex-1 resize-none rounded-[12px] px-3 py-2.5 text-[13px] max-sm:min-h-[44px] max-sm:!text-[16px]"
        />
        <button
          type="button"
          onClick={send}
          aria-label="ส่ง"
          className="grid size-10 flex-none place-items-center rounded-full bg-primary text-white"
        >
          ➤
        </button>
      </div>
      {warn && <p className="mt-1.5 text-[12.5px] text-destructive">ใส่เหตุผลก่อนส่ง</p>}
    </div>
  );
}

function Face({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="grid flex-none place-items-center rounded-full bg-[var(--destructive-soft)] font-bold text-primary"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(name)}
    </span>
  );
}

/** คำขอและผลตัดสินเป็นเหตุการณ์แยกกัน เรียงตามเวลา — คำขอก่อนผลตัดสินเมื่อเวลาเท่ากัน */
function roomEvents(list: Item[]) {
  const evs: { t: "req" | "dec"; at: string; it: Item }[] = [];
  for (const it of list) {
    evs.push({ t: "req", at: it.at, it });
    if (it.status !== "pending") evs.push({ t: "dec", at: it.decidedAt ?? it.at, it });
  }
  return evs.sort((a, b) => a.at.localeCompare(b.at) || (a.t === "req" ? -1 : 1));
}

/** เวลาข้างชื่อห้อง — วันนี้เป็นเวลา เมื่อวานเป็นคำ ที่เหลือเป็นวันที่สั้น */
function whenLabel(it: Item, today: string) {
  const at = lastAt(it);
  const day = at.slice(0, 10);
  const gap = daysBetween(day, today);
  if (gap === 0) return it.hasTime ? at.slice(11) : "วันนี้";
  if (gap === 1) return "เมื่อวาน";
  const d = parseIsoDate(day);
  return `${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]}`;
}

/** ตัวคั่นวันในห้องแชท */
function dayLabel(day: string, today: string) {
  const gap = daysBetween(day, today);
  if (gap === 0) return "วันนี้";
  if (gap === 1) return "เมื่อวาน";
  return `${WEEKDAY[parseIsoDate(day).getDay()]} ${thaiDate(day)}`;
}
