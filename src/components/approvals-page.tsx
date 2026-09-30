"use client";

/*
 * คำขออนุมัติ (ตามต้นแบบ pm-approvals.html) — ใช้ร่วมกันทั้งหัวหน้าสายงานและฝ่ายบัญชี
 *
 * ใครอนุมัติอะไรของใคร กำหนดไว้ที่เดียวใน role.ts (approvesFor)
 * หน้านี้แค่หยิบคำขอที่ตรงกับหน้าที่ของตัวเองมาแสดง ไม่ตัดสินใจเรื่องสายอนุมัติเอง
 *
 * รายการกลาง คำขอทุกประเภทอยู่หน้าเดียว กรองด้วยประเภท (แท็บ) สถานะ และคำค้น
 * เรียงเก่าสุดขึ้นก่อนเพราะรอมานานกว่า
 *
 * ตาราง 3 คอลัมน์ ผู้ขอ · คำขอ · ส่งเมื่อ — กดที่ไหนในแถวก็เปิดรายละเอียด (ไม่มีคอลัมน์ปุ่ม)
 * การตัดสินอยู่ในกล่องเดียว: อนุมัติ = บันทึกทันที · ไม่อนุมัติ = กดครั้งแรกเปิดช่องเหตุผล กดอีกครั้งถึงบันทึก
 * คำขอที่ตัดสินแล้วเปิดดูย้อนหลังได้อย่างเดียว ไม่มีปุ่มตัดสิน
 *
 * PM / GM เห็นคำขอของพนักงานที่ยังไม่มีบัญชีเข้าระบบด้วย (emp-requests ที่ to ตรงกับบทบาท)
 * ชื่อและตำแหน่งของผู้ขออ่านจากทะเบียนฝ่ายบุคคล
 *
 * ⚠️ คิวเป็นของ "คน" ไม่ใช่ของบทบาทที่เลือกอยู่ (ผู้ใช้สั่ง 23 ก.ย. 2569)
 * บริษัทมี 18 คน คนหนึ่งควบหลายบทบาทได้ (เช่น อรอนงค์ E12 เป็นทั้งบัญชีและฝ่ายบุคคล)
 * ถ้าอ่านจากบทบาทที่เลือกอยู่บทบาทเดียว ใบที่รอเขาในอีกบทบาทจะหายไปทั้งที่มีคนรออยู่
 * จึงรวมหน้าที่อนุมัติของทุกบทบาทที่บัญชีนี้ถือ (useMyRoles) แล้วบอกทุกใบว่ามาถึงเราในฐานะอะไร
 *
 * แท็บตามต้นแบบของแต่ละบทบาท (22 ก.ย. 2569)
 *   GM (gm-approvals.html) — ทั้งหมด / ลา / โอที · ไม่มีแท็บค่าใช้จ่าย
 *   PM (pm-approvals.html) — ทั้งหมด / โอที / ค่าใช้จ่าย · ไม่มีแท็บลา (GM อนุมัติการลา PM เห็นแค่วันลาในหน้าวางแผน)
 *   แท็บที่ต้นแบบซ่อน ยังโผล่ถ้าสายอนุมัติส่งคำขอประเภทนั้นมาจริง (ผู้ดูแลระบบย้ายสายได้) — ไม่ให้คำขอตกหล่น
 */

import { useMemo, useState } from "react";
import { decideEmpRequest, empFuelKm, useEmpRequests, type EmpRequest } from "@/lib/emp-requests";
import { claimTotal, fuelRate, type ExpenseClaim } from "@/lib/expense-data";
import { hrPos } from "@/lib/hr-data";
import { useHr } from "@/lib/hr-store";
import { approveClaim, rejectClaim, useAllClaims } from "@/lib/expense-store";
import { baht, daysBetween, thaiDate, thaiMonth, thaiStamp, todayIso } from "@/lib/format";
import { type LeaveRecord } from "@/lib/leave-data";
import {
  approveLeave,
  awaySpans,
  othersAway,
  quotaAfterLeave,
  quotaAfterUsed,
  rejectLeave,
  useAllLeave,
  type AwaySpan,
} from "@/lib/leave-store";
import { USERS } from "@/lib/mock-data";
import { type OtRecord } from "@/lib/ot-data";
import { approveOt, rejectOt, useAllOt } from "@/lib/ot-store";
import { ROLES, approvesFor, roleLabel, useApprovalRoute, type Role } from "@/lib/role";
import { useMyRoles } from "@/lib/hr-link";
import { useSearchParams } from "next/navigation";
import { formatMinutesOfDay, minutesOfDay } from "@/lib/work-schedule";
import { Sheet } from "./lead-dialogs";
import { OtActualFields, useOtDecision, type OtReq } from "./ot-actual-fields";
import { SearchBox } from "./sales-ui";

type Kind = "leave" | "ot" | "expense";
type Status = "pending" | "approved" | "rejected";

/** คำขอหนึ่งใบ — รวมสามประเภทให้อยู่ในรูปเดียวกัน */
type Request = {
  kind: Kind;
  /** role = ใบของบทบาทที่ล็อกอินได้ (leave/ot/expense-store) · emp = คำขอของพนักงานตามรหัสพนักงาน */
  src: "role" | "emp";
  /** บทบาทผู้ยื่น — เฉพาะ src = role */
  role?: Role;
  /** ใบนี้มาถึงเราในฐานะบทบาทไหน — คนหนึ่งควบหลายบทบาทได้ ต้องรู้ว่ากำลังตัดสินในฐานะอะไร */
  as: Role;
  /** ชื่อผู้ยื่นและตำแหน่ง */
  name: string;
  sub: string;
  /** id ของใบลา/โอที หรือเดือนของใบเบิก */
  key: string;
  /** เลขที่เอกสาร (LV-/OT-/EX-) — เอกสารที่ใช้เบิกเงินต้องอ้างอิงได้ */
  no: string;
  status: Status;
  /** เวลาที่ยื่น "yyyy-mm-dd hh:mm" — ใช้เรียงคิว นับวันที่รอ */
  at: string;
  /** หัวข้อคำขอในตาราง — ทำงานล่วงเวลา / ประเภทการลา / ค่าน้ำมัน */
  topic: string;
  /** สรุปหนึ่งบรรทัด — ใช้ค้นหา */
  line: string;
  /** รายการในกล่องรายละเอียด แยกบรรทัด: หัวข้อกับช่วงเวลา / จำนวนรวม / เป็นเงิน */
  lines: string[];
  /** เหตุผลของผู้อนุมัติ — แสดงเมื่อตัดสินแล้ว */
  why: string;
  /** ชั่วโมงที่ขอ — เฉพาะโอที */
  hours?: number;
  /** ชั่วโมงที่อนุมัติจริง — เฉพาะโอทีที่อนุมัติแล้ว (ไม่มี = เท่าที่ขอ) */
  approvedHours?: number | null;
  /** ช่วงเวลาที่ขอ ใช้เทียบกับเวลาตอกบัตรจริงตอนตัดสิน — เฉพาะโอที */
  ot?: OtReq;
  /** สิทธิ์คงเหลือหลังหักใบนี้ — เฉพาะใบลา · ติดลบคือเกินสิทธิ์ (ชุดเดียวกับหน้าของ CEO) */
  quota?: number;
  /** เหตุผลที่ผู้ยื่นเขียนมาเอง — คนละช่องกับเหตุผลของผู้อนุมัติ (why) */
  note?: string;
  /** คนอื่นที่ไม่อยู่ช่วงวันเดียวกัน — เฉพาะใบลา */
  away?: { name: string; text: string }[];
};

/** โอทีที่อนุมัติไม่เท่าที่ขอ — คืนชั่วโมงที่อนุมัติ · เท่ากันหรือยังไม่อนุมัติคืน null */
function cutHours(r: Request) {
  if (r.kind !== "ot" || r.status !== "approved" || r.approvedHours == null) return null;
  return r.approvedHours !== r.hours ? r.approvedHours : null;
}

const KIND: Record<Kind, string> = {
  ot: "ขอโอที",
  leave: "การลา",
  expense: "เบิกค่าใช้จ่าย",
};

const TABS: { key: "all" | Kind; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "leave", label: "ลา" },
  { key: "ot", label: "โอที" },
  { key: "expense", label: "ค่าใช้จ่าย" },
];

/** แท็บประเภทที่ต้นแบบแสดงของแต่ละบทบาท — ไม่ระบุคือแสดงครบทุกประเภท */
const ROLE_TABS: Partial<Record<Role, Kind[]>> = {
  gm: ["leave", "ot", "expense"], /* รับคิวโอทีและใบเบิกของ PM เดิมมาด้วย (22 ก.ย. 2569) */
  pm: ["ot", "expense"],
};

const STATUS_OPTS: { value: Status | ""; label: string }[] = [
  { value: "pending", label: "รออนุมัติ" },
  { value: "approved", label: "อนุมัติแล้ว" },
  { value: "rejected", label: "ไม่อนุมัติ" },
  { value: "", label: "ทุกสถานะ" },
];

/** ตัวเลขวัน — จำนวนเต็มไม่ต้องมีทศนิยม (แบบเดียวกับหน้าของ CEO) */
const num2 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** รอตั้งแต่กี่วันขึ้นไปถึงเป็นตัวแดง */
const WAIT_HOT = 3;

export function ApprovalsPage() {
  /* ทุกบทบาทที่บัญชีนี้ถือ บทบาทที่เลือกอยู่มาก่อนเสมอ — แท็บและคิวจึงเรียงตามบทบาทที่กำลังใช้งาน */
  const myRoles = useMyRoles();
  const leaves = useAllLeave();
  const ots = useAllOt();
  const claims = useAllClaims();
  const extra = useEmpRequests();
  const hr = useHr();
  /* ลิงก์จาก LINE พามาที่แท็บและรายการที่ต้องตัดสิน — /approvals?kind=leave&find=LV-2569-0123 */
  const params = useSearchParams();
  const wantKind = params.get("kind");
  const findId = params.get("find") ?? "";
  const [tab, setTab] = useState<"all" | Kind>(
    wantKind === "leave" || wantKind === "ot" || wantKind === "expense" ? wantKind : "all",
  );
  const [status, setStatus] = useState<Status | "">("pending");
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState<Request | null>(null);
  const today = todayIso();

  /** คำขอประเภทไหนของใครบ้างที่เราต้องอนุมัติ — รวมทุกบทบาทที่ถืออยู่ · ว่างแปลว่าไม่ได้เป็นผู้อนุมัติของใคร */
  const route = useApprovalRoute();
  const duties = useMemo(() => {
    const out: { kind: "leave" | "ot" | "expense"; from: Role; as: Role }[] = [];
    const seen = new Set<string>();
    for (const r of myRoles)
      for (const d of approvesFor(r, route)) {
        /* สายอนุมัติเดียวกันอาจตกมาที่สองบทบาทของคนเดียวกัน — ใบเดียวกันต้องขึ้นใบเดียว */
        if (seen.has(`${d.kind}|${d.from}`)) continue;
        seen.add(`${d.kind}|${d.from}`);
        out.push({ ...d, as: r });
      }
    return out;
  }, [myRoles, route]);

  const all = useMemo(() => {
    const out: Request[] = [];
    /* ใครไม่อยู่วันไหนบ้างทั้งบริษัท — ใบลาของทุกบทบาท บวกคำขอลาของพนักงานที่ยังไม่มีบัญชี
       ถ้าเอาแค่ฝั่งเดียว ผู้อนุมัติจะเห็นครึ่งเดียวแล้วอนุมัติจนไม่เหลือคน */
    const spans: AwaySpan[] = [
      ...awaySpans(leaves),
      ...extra
        .filter((r) => r.kind === "leave" && r.status !== "rejected")
        .map((r) => ({
          id: r.id,
          who: hr.emp.find((x) => x.id === r.emp)?.name ?? r.emp,
          type: r.leaveType ?? "การลา",
          date: r.from ?? "",
          toDate: r.toDate ?? r.from ?? "",
          pending: r.status === "pending",
        })),
    ];
    /*
     * ใบลาของนักศึกษาฝึกงานขึ้นที่ฝ่ายบุคคล ไม่ใช่สายอนุมัติปกติ
     * (เอกสารฝ่ายบุคคล 30 ก.ย. 2569 — ฝึกงานลากับฝ่ายบุคคล)
     * ดูจากชื่อผู้ยื่นเทียบทะเบียน เพราะบทบาทพนักงานมีได้หลายคนหลายประเภทการจ้าง
     */
    const isIntern = (name: string) =>
      hr.emp.some((e) => e.name === name && e.type === "intern");
    for (const { kind, from, as } of duties) {
      /* ใบลาที่ยกเลิกแล้วไม่เข้าคิวอนุมัติ แต่ยังอยู่ในระบบเป็นประวัติ */
      if (kind === "leave")
        for (const v of leaves[from])
          if (v.status !== "ยกเลิก" && !isIntern(v.employee))
            out.push(fromLeave(from, v, as, leaves[from], spans));
      if (kind === "ot")
        for (const v of ots[from]) if (v.status !== "ยกเลิก") out.push(fromOt(from, v, as));
      if (kind === "expense")
        for (const v of claims[from]) if (v.status !== "ร่าง") out.push(fromClaim(from, v, as));
    }
    /* ฝ่ายบุคคลรับใบลาของนักศึกษาฝึกงานทุกคน ไม่ว่าสายอนุมัติปกติจะเป็นใคร */
    if (myRoles.includes("hr"))
      for (const role of ROLES.map((r) => r.key))
        for (const v of leaves[role])
          if (v.status !== "ยกเลิก" && isIntern(v.employee))
            out.push(fromLeave(role, v, "hr", leaves[role], spans));

    /* คิวของ PM / GM — คำขอของพนักงานตามรหัสพนักงาน (ต้นแบบ PM_APPROVALS · gm-approvals) */
    for (const as of myRoles) {
      if (as !== "pm" && as !== "gm") continue;
      for (const r of extra) {
        if (r.to !== as) continue;
        const e = hr.emp.find((x) => x.id === r.emp);
        out.push(fromEmp(r, e?.name ?? r.emp, e ? hrPos(e.pos).label : "", as, spans));
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }, [duties, leaves, ots, claims, extra, hr.emp, myRoles]);

  if (duties.length === 0 && all.length === 0) {
    return (
      <div className="space-y-4">
        <Head />
        <section className="panel glass px-5 py-12 text-center text-[13.5px] text-muted-foreground">
          บทบาท{myRoles.map(roleLabel).join(" และ ")}ไม่ได้เป็นผู้อนุมัติของใคร
        </section>
      </div>
    );
  }

  /* แท็บที่แสดง — ตามต้นแบบของบทบาท บวกประเภทที่มีคำขอเข้ามาจริง */
  /* ควบหลายบทบาทเท่านั้นที่ต้องเห็นว่าใบไหนมาถึงในฐานะอะไร — คนบทบาทเดียวไม่มีอะไรให้สับสน */
  const multi = myRoles.length > 1;
  /* คนที่ควบหลายบทบาทเห็นแท็บของทุกบทบาทรวมกัน ไม่งั้นใบของอีกบทบาทจะไม่มีแท็บให้เปิด */
  const tabs = TABS.filter((t) => {
    if (t.key === "all") return true;
    const k = t.key;
    return myRoles.some((r) => !ROLE_TABS[r] || ROLE_TABS[r]!.includes(k)) || all.some((r) => r.kind === k);
  });
  /* ?kind= ชี้ไปแท็บที่บทบาทนี้ไม่มี — กลับไปแท็บทั้งหมด */
  const cur = tabs.some((t) => t.key === tab) ? tab : "all";
  const byStatus = all.filter((r) => !status || r.status === status);
  const count = (k: "all" | Kind) => byStatus.filter((r) => k === "all" || r.kind === k).length;
  const term = q.trim().toLowerCase();
  const rows = byStatus.filter(
    (r) =>
      (cur === "all" || r.kind === cur) &&
      (!term || `${r.no} ${r.name} ${r.topic} ${r.line}`.toLowerCase().includes(term)),
  );

  return (
    <div className="space-y-4">
      <Head />

      {/* แถบแท็บและตัวกรองอยู่นอกการ์ดตาราง ตามต้นแบบ (.apbar) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={cur === t.key ? "on" : ""}
              onClick={() => setTab(t.key)}
            >
              {t.label} <b>{count(t.key)}</b>
            </button>
          ))}
        </div>
        {/* มือถือ: ช่องค้นหากับตัวกรองสถานะอยู่แถวเดียวกัน ค้นหากินที่ที่เหลือ */}
        <div className="flex w-full flex-wrap items-center gap-2.5 max-sm:flex-nowrap sm:ml-auto sm:w-auto sm:flex-nowrap">
          <div className="w-full max-sm:min-w-0 max-sm:flex-1 sm:w-[260px]">
            <SearchBox value={q} onChange={setQ} placeholder="ค้นหาผู้ขอหรือรายละเอียด" />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status | "")}
            aria-label="กรองตามสถานะ"
            className="field-control h-9 !w-[150px] flex-none cursor-pointer pr-8 text-[13px] max-sm:h-10 max-sm:!w-[124px]"
          >
            {STATUS_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* มือถือ: แถวละคำขอ กดทั้งแถวเปิดรายละเอียด ชื่อผู้ขอกับเรื่องที่ขออยู่ซ้าย รอมากี่วันอยู่ขวา */}
      <section className="panel glass sm:hidden">
        {rows.length === 0 ? (
          <p className="py-[30px] text-center text-[13px] text-muted-foreground">ไม่มีคำขอตามเงื่อนไขที่เลือก</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((item) => {
              const wait = daysBetween(item.at.split(" ")[0], today);
              const hot = wait >= WAIT_HOT && item.status === "pending";
              const hit = Boolean(findId) && item.key === findId;
              return (
                <li key={`${item.kind}-${item.src}-${item.role ?? ""}-${item.key}`}>
                  <button
                    type="button"
                    aria-label={`เปิดคำขอของ ${item.name}`}
                    onClick={() => setViewing(item)}
                    className={`flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left active:bg-muted ${
                      hit ? "ring-2 ring-primary ring-inset" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[14px] font-semibold">{item.name}</b>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{item.sub}</span>
                      <span className="mt-1 block text-[13px] leading-snug">
                        {item.topic}
                        {cutHours(item) != null && (
                          <span className="text-[11.5px] text-muted-foreground"> · อนุมัติ {cutHours(item)?.toFixed(2)} ชม.</span>
                        )}
                        {multi && (
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            มาถึงคุณในฐานะ {roleLabel(item.as)}
                          </span>
                        )}
                        {/* เลขที่เอกสาร — เอกสารที่ใช้เบิกเงินต้องอ้างอิงได้ */}
                        {item.no && (
                          <span className="num block truncate text-[11.5px] text-muted-foreground">{item.no}</span>
                        )}
                      </span>
                    </span>
                    <span
                      className={`flex-none text-right text-[12px] whitespace-nowrap ${
                        hot ? "font-semibold text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {wait <= 0 ? "วันนี้" : wait === 1 ? "เมื่อวาน" : `${wait} วันก่อน`}
                    </span>
                    <span aria-hidden className="flex-none text-[18px] leading-none text-muted-foreground">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel glass flex flex-col max-sm:hidden">
        <div className="scroll-stable min-h-0 flex-1 overflow-auto">
          <table className="data-table cards-sm min-w-[560px]">
            <thead>
              <tr>
                <th style={{ width: 210 }}>ผู้ขอ</th>
                <th>คำขอ</th>
                <th style={{ width: 130 }}>ส่งเมื่อ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-[30px] text-center text-muted-foreground">
                    ไม่มีคำขอตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                rows.map((item) => {
                  const wait = daysBetween(item.at.split(" ")[0], today);
                  const hot = wait >= WAIT_HOT && item.status === "pending";
                  const hit = Boolean(findId) && item.key === findId;
                  return (
                    <tr
                      key={`${item.kind}-${item.src}-${item.role ?? ""}-${item.key}`}
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      aria-label={`เปิดคำขอของ ${item.name}`}
                      className={`hover:[&>td]:bg-[rgba(208,2,27,.04)] ${hit ? "ring-2 ring-primary ring-inset" : ""}`}
                      onClick={() => setViewing(item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setViewing(item);
                        }
                      }}
                    >
                      <td data-label="ผู้ขอ">
                        <b className="block font-semibold">{item.name}</b>
                        <span className="why">{item.sub}</span>
                      </td>
                      <td data-label="คำขอ">
                        {item.topic}
                        {cutHours(item) != null && (
                          <span className="why block">อนุมัติ {cutHours(item)?.toFixed(2)} ชม.</span>
                        )}
                        {multi && <span className="why block">มาถึงคุณในฐานะ {roleLabel(item.as)}</span>}
                        {item.no && <span className="why num block">{item.no}</span>}
                      </td>
                      <td
                        data-label="ส่งเมื่อ"
                        className={`text-[12.5px] whitespace-nowrap ${hot ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                        title={hot ? `รอนานเกิน ${WAIT_HOT} วัน` : undefined}
                      >
                        {wait <= 0 ? "วันนี้" : wait === 1 ? "เมื่อวาน" : `${wait} วันก่อน`}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {viewing && <RequestDialog item={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Head() {
  return (
    <div className="bar">
      <div>
        <h1>คำขออนุมัติ</h1>
      </div>
    </div>
  );
}

/**
 * รายละเอียดคำขอ + ตัดสินในกล่องเดียว
 * อนุมัติ = บันทึกทันที · ไม่อนุมัติ = กดครั้งแรกเปิดช่องเหตุผล กดอีกครั้งถึงบันทึก (ต้องมีเหตุผล)
 */
function RequestDialog({ item, onClose }: { item: Request; onClose: () => void }) {
  const done = item.status !== "pending";
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const [warn, setWarn] = useState(false);
  /* โอทีที่รอตัดสิน — เทียบเวลาตอกบัตรจริง ให้แก้ชั่วโมงก่อนอนุมัติ */
  const ot = useOtDecision(!done && item.ot ? item.ot : null);
  const cut = cutHours(item);

  function reject() {
    if (!rejecting) return setRejecting(true);
    if (!why.trim()) return setWarn(true);
    applyDecision(item, false, why.trim());
    onClose();
  }

  function approve() {
    if (item.kind === "ot" && item.ot) {
      /* ต่ำกว่า 0.5 ชม. หรือยังไม่ยืนยันชั่วโมงเมื่อบัตรตอกไม่ครอบคลุม — อนุมัติไม่ได้ */
      if (!ot.ready) return;
      applyDecision(item, true, ot.finalComment(), ot.hours);
    } else applyDecision(item, true, "");
    onClose();
  }

  return (
    <Sheet
      title={`${KIND[item.kind]} ${item.name}`}
      onClose={onClose}
      footer={
        done ? null : (
          /* ปุ่มตัดสินแบ่งครึ่งเต็มความกว้าง สูงพอให้กดง่ายทั้งเมาส์และนิ้ว */
          <div className="grid w-full grid-cols-2 gap-3">
            <button
              type="button"
              className="btn solid h-12 w-full justify-center rounded-[12px] !bg-primary text-[15px] !text-white hover:!bg-[#B00018]"
              onClick={reject}
            >
              {rejecting ? "ยืนยันไม่อนุมัติ" : "ไม่อนุมัติ"}
            </button>
            <button
              type="button"
              className="btn solid h-12 w-full justify-center rounded-[12px] !bg-[#14875A] text-[15px] !text-white hover:!bg-[#0F7049]"
              onClick={approve}
              disabled={item.kind === "ot" && Boolean(item.ot) && !ot.ready}
            >
              อนุมัติ
            </button>
          </div>
        )
      }
    >
      <dl className="mt-1 grid grid-cols-[104px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-[13.5px]">
        <Kv label="เลขที่" value={<span className="num font-semibold">{item.no || "—"}</span>} />
        <Kv label="ผู้ยื่น" value={item.name} />
        <Kv label="ประเภท" value={KIND[item.kind]} />
        <Kv
          label="รายการ"
          value={
            <span className="block leading-[1.8]">
              {item.lines.map((l) => (
                <span key={l} className="block">
                  <NumBold text={l} />
                </span>
              ))}
            </span>
          }
        />
        {/* สิทธิ์คงเหลือหลังลา — ตัวเลขชุดเดียวกับที่ CEO เห็น (quotaAfterLeave) */}
        {item.quota !== undefined && (
          <Kv
            label="เหลือสิทธิ์หลังลา"
            value={
              item.quota >= 0 ? (
                <span className="num font-semibold">{num2(item.quota)} วัน</span>
              ) : (
                <span className="num font-semibold text-destructive">เกินสิทธิ์ {num2(-item.quota)} วัน — ส่วนที่เกินเป็นลาไม่รับค่าจ้าง หักเงินเดือน</span>
              )
            }
          />
        )}
        {/* เหตุผลที่ผู้ยื่นเขียนมา — ตัดสินโดยไม่อ่านเหตุผลไม่ได้ */}
        {item.kind === "leave" && (
          <Kv label="เหตุผลของผู้ยื่น" value={item.note || "ไม่ได้เขียนเหตุผล"} />
        )}
        <Kv label="ยื่นเมื่อ" value={thaiStamp(item.at)} />
        {/* คนหนึ่งควบหลายบทบาทได้ — บอกให้ชัดว่ากำลังตัดสินใบนี้ในฐานะอะไร จะได้ไม่สับสน */}
        <Kv label="ถึงคุณในฐานะ" value={roleLabel(item.as)} />
        {done && (
          <Kv
            label="ผล"
            value={
              item.status === "approved"
                ? cut != null
                  ? `อนุมัติ ${cut.toFixed(2)} ชม. (ขอ ${(item.hours ?? 0).toFixed(2)} ชม.)`
                  : "อนุมัติแล้ว"
                : "ไม่อนุมัติ"
            }
          />
        )}
        {done && item.why && <Kv label="เหตุผล" value={item.why} />}
      </dl>

      {/* ใครไม่อยู่ช่วงเดียวกันบ้าง — ข้อที่การอนุมัติลาตัดสินจากมันจริง ๆ */}
      {item.away && (
        <section className="mt-4 border-t border-border pt-3.5">
          <h3 className="mb-2 text-[12.5px] font-semibold text-muted-foreground">คนอื่นที่ไม่อยู่ช่วงวันเดียวกัน</h3>
          {item.away.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">ไม่มีใครลาทับช่วงวันนี้</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {item.away.map((a) => (
                <li key={`${a.name}-${a.text}`} className="rounded-[10px] bg-muted px-3 py-2 text-[13px]">
                  <b className="font-semibold">{a.name}</b>
                  <span className="ml-2 text-[12.5px] text-muted-foreground">{a.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!done && item.kind === "ot" && item.ot && !rejecting && (
        <div className="mt-4 border-t border-border pt-3.5">
          <OtActualFields d={ot} idPrefix={`appr-${item.key}`} />
        </div>
      )}

      {rejecting && !done && (
        <div className="mt-4">
          <label htmlFor="appr-why" className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
            เหตุผลที่ไม่อนุมัติ
          </label>
          <textarea
            id="appr-why"
            autoFocus
            value={why}
            onChange={(e) => {
              setWhy(e.target.value);
              if (e.target.value) setWarn(false);
            }}
            placeholder="บอกให้ผู้ยื่นรู้ว่าต้องแก้อะไร"
            className="field-control h-[78px] w-full resize-y rounded-[10px] px-[11px] py-[9px] text-[13.5px] leading-[1.5]"
          />
          {warn && (
            <p className="mt-[9px] rounded-[11px] border border-[rgba(192,18,31,.2)] bg-[var(--destructive-soft)] px-[13px] py-2.5 text-[12.5px] leading-[1.55] text-destructive">
              ไม่อนุมัติต้องระบุเหตุผล เพื่อให้ผู้ยื่นรู้ว่าต้องแก้อะไร
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** ตัวเลขจำนวนและยอดเงิน (มีทศนิยม) เข้มขึ้น อ่านได้เร็ว — วันที่ไม่นับ */
function NumBold({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,]*\.\d{2})/);
  return (
    <>
      {parts.map((x, i) =>
        i % 2 ? (
          <b key={i} className="font-bold text-foreground">
            {x}
          </b>
        ) : (
          x
        ),
      )}
    </>
  );
}

/** บันทึกผลลงสโตร์ของคำขอแต่ละชนิด — ที่เดียว */
/* hours = ชั่วโมงโอทีที่อนุมัติ (ปรับตามเวลาตอกบัตรจริงแล้ว) — ไม่ส่งมาใช้เท่าที่ขอ */
function applyDecision(item: Request, approve: boolean, why: string, hours?: number) {
  if (item.src === "emp")
    return decideEmpRequest(item.key, approve, why, item.kind === "ot" ? hours : undefined);
  if (!item.role) return;
  if (approve) {
    if (item.kind === "leave") approveLeave(item.role, item.key);
    if (item.kind === "ot") approveOt(item.role, item.key, hours ?? item.hours ?? 0, why);
    if (item.kind === "expense") approveClaim(item.role, item.key, why);
  } else {
    if (item.kind === "leave") rejectLeave(item.role, item.key, why);
    if (item.kind === "ot") rejectOt(item.role, item.key, why);
    if (item.kind === "expense") rejectClaim(item.role, item.key, why);
  }
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="contents">
      {/* หัวข้อทางซ้ายจางกว่าค่า ให้สายตาไปที่ข้อมูลก่อน */}
      <dt className="text-[12.5px] font-medium text-[var(--ink-faint,#9AA1AE)]">{label}</dt>
      <dd className="leading-[1.6]">{value}</dd>
    </div>
  );
}

// ─── แปลงคำขอแต่ละประเภทให้อยู่ในรูปเดียวกัน ────────────────────────

/** ใบลาเก่าที่ยังไม่มีเวลายื่น ใช้วันที่ลาแทน จะได้เรียงคิวและนับวันที่รอได้เหมือนกัน */
function stampOf(submittedAt: string, fallbackDate: string) {
  return submittedAt || `${fallbackDate} 00:00`;
}

function statusOf(s: string): Status {
  return s === "อนุมัติแล้ว" ? "approved" : s === "ไม่อนุมัติ" ? "rejected" : "pending";
}

/** ชื่อและตำแหน่งของบทบาทที่ล็อกอินได้ */
/* บทบาทพนักงานมีหลายคน — ใบที่จำชื่อผู้ยื่นไว้ต้องขึ้นชื่อคนนั้น ไม่ใช่ชื่อตัวแทนของบทบาท */
function who(role: Role, name?: string) {
  return { src: "role" as const, role, name: name || USERS[role].name, sub: roleLabel(role) };
}

/** คำขอของพนักงานตามรหัสพนักงาน (emp-requests) — รูปเดียวกับใบของบทบาท */
/** แปลงช่วงที่ไม่อยู่เป็นบรรทัดอ่านง่าย — ใช้ทั้งใบลาของบทบาทและคำขอลาของพนักงาน */
function awayList(spans: AwaySpan[], me: { id: string; who: string; date: string; toDate: string }) {
  return othersAway(spans, me).map((x) => ({
    name: x.who,
    text: `${x.type} ${x.date === x.toDate ? thaiDate(x.date) : `${thaiDate(x.date)} – ${thaiDate(x.toDate)}`}${
      x.pending ? " · ยังรออนุมัติ" : ""
    }`,
  }));
}

function fromEmp(r: EmpRequest, name: string, sub: string, as: Role, spans: AwaySpan[]): Request {
  const base = { src: "emp" as const, as, name, sub, key: r.id, no: r.id, status: r.status, at: r.at, why: r.reason ?? "" };
  if (r.kind === "ot") {
    const lines = [`${thaiDate(r.date ?? "")} เวลา ${r.start}–${r.end}`, `รวม ${(r.hours ?? 0).toFixed(2)} ชม.`];
    const ot: OtReq | undefined =
      r.date && r.start && r.end
        ? { date: r.date, startMin: minutesOfDay(r.start), endMin: minutesOfDay(r.end), hours: r.hours ?? 0, emp: r.emp }
        : undefined;
    return {
      ...base, kind: "ot", topic: "ทำงานล่วงเวลา", line: `${lines.join(" ")} ${r.note}`, lines,
      hours: r.hours, approvedHours: r.approvedHours ?? null, ot,
    };
  }
  if (r.kind === "leave") {
    const range = r.from === r.toDate ? thaiDate(r.from ?? "") : `${thaiDate(r.from ?? "")} – ${thaiDate(r.toDate ?? "")}`;
    const lines = [`${r.leaveType} ${range}`, `รวม ${(r.days ?? 0).toFixed(2)} วัน`];
    return {
      ...base,
      kind: "leave",
      topic: r.leaveType ?? "การลา",
      line: `${lines.join(" ")} ${r.note}`,
      lines,
      /* สูตรเดียวกับหน้าของ CEO สำหรับคำขอของพนักงาน (quota − ที่ใช้ไปก่อนใบนี้ − ใบนี้) */
      quota: quotaAfterUsed(r.leaveType ?? "", r.used ?? 0, r.days ?? 0),
      note: r.note,
      away: awayList(spans, {
        id: r.id,
        who: name,
        date: r.from ?? "",
        toDate: r.toDate ?? r.from ?? "",
      }),
    };
  }
  const km = empFuelKm(r);
  const lines = [`ค่าน้ำมัน ${thaiMonth(r.month ?? "")}`, `รวม ${km.toFixed(2)} กม.`, `เป็นเงิน ${baht(km * fuelRate())} บาท`];
  return { ...base, kind: "expense", topic: "ค่าน้ำมัน", line: `${r.id} ${lines.join(" ")}`, lines };
}

/*
 * ใบลาหนึ่งใบ — ผู้อนุมัติต้องได้ข้อมูลชุดเดียวกับที่ CEO เห็น (ผู้ใช้สั่ง 24 ก.ย. 2569)
 * เดิมหน้านี้บอกแค่ประเภท ช่วงวัน และจำนวนวัน คนที่อนุมัติการลามากที่สุดกลับรู้น้อยที่สุด
 * สิทธิ์คงเหลือคิดจาก quotaAfterLeave ตัวเดียวกับหน้าของ CEO จะได้ไม่มีเลขสองชุด
 */
function fromLeave(
  role: Role,
  v: LeaveRecord,
  as: Role,
  records: LeaveRecord[],
  spans: AwaySpan[],
): Request {
  const range = v.date === v.toDate ? thaiDate(v.date) : `${thaiDate(v.date)} – ${thaiDate(v.toDate)}`;
  const status = statusOf(v.status);
  const lines = [`${v.type} ${range}`, `รวม ${v.days.toFixed(2)} วัน`];
  const away = awayList(spans, { id: v.id, who: v.employee, date: v.date, toDate: v.toDate });
  return {
    quota: quotaAfterLeave(records, v),
    /* ไม่อนุมัติแล้ว comment ถูกแทนด้วยเหตุผลของผู้อนุมัติ — ไม่ใช่เหตุผลของผู้ยื่นอีกต่อไป */
    note: status === "rejected" ? "" : v.comment,
    away,
    kind: "leave",
    ...who(role, v.employee),
    as,
    key: v.id,
    no: v.id,
    status,
    /* ใบใหม่มีเวลายื่นจริง ใบตั้งต้นบางใบไม่มี จึงถอยไปใช้วันลาแทน */
    at: stampOf(v.submittedAt ?? "", v.date),
    topic: v.type,
    line: `${lines.join(" ")} ${status === "rejected" ? "" : v.comment}`,
    lines,
    /* ไม่อนุมัติแล้ว comment ของใบลาถูกแทนด้วยเหตุผลของผู้อนุมัติ */
    why: status === "rejected" ? v.comment : "",
  };
}

function fromOt(role: Role, v: OtRecord, as: Role): Request {
  const lines = [
    `${thaiDate(v.date)} เวลา ${formatMinutesOfDay(v.startMin)}–${formatMinutesOfDay(v.endMin)}`,
    `รวม ${v.hours.toFixed(2)} ชม.`,
  ];
  return {
    kind: "ot",
    ...who(role, v.employee),
    as,
    key: v.id,
    no: v.id,
    status: statusOf(v.status),
    at: stampOf(v.submittedAt, v.date),
    topic: "ทำงานล่วงเวลา",
    line: `${lines.join(" ")} ${v.reason}`,
    lines,
    hours: v.hours,
    approvedHours: v.approvedHours,
    ot: { date: v.date, startMin: v.startMin, endMin: v.endMin, hours: v.hours, role },
    why: v.comment,
  };
}

function fromClaim(role: Role, v: ExpenseClaim, as: Role): Request {
  const km = v.fuel.reduce((sum, r) => sum + (Number(String(r.km).replace(/,/g, "")) || 0), 0);
  const lines = [`ค่าน้ำมัน ${thaiMonth(v.month)}`, `รวม ${km.toFixed(2)} กม.`, `เป็นเงิน ${baht(claimTotal(v))} บาท`];
  return {
    kind: "expense",
    ...who(role, v.employee),
    as,
    key: v.month,
    no: v.no ?? "",
    status: statusOf(v.status),
    at: stampOf(v.submittedAt, `${v.month}-01`),
    topic: "ค่าน้ำมัน",
    line: `${v.no ?? ""} ${lines.join(" ")}`,
    lines,
    why: v.comment,
  };
}
