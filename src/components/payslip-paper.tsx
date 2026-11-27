"use client";

/*
 * กระดาษสลิปเงินเดือน A4 (ยกแบบมาจาก ERP_Test · รอบที่ 135)
 *
 * ใช้ร่วมกันระหว่างหน้าสลิปของฝ่ายบุคคล (hr-payslip-page) กับสลิปของฉัน (my-payslip-page)
 * เดิมสองหน้านี้วาดกระดาษของตัวเองแบบการ์ด เปิดดูบนจอได้แต่พิมพ์ออกมาไม่ตรงแบบที่เจ้าของส่งมา
 *
 * ตัวเลขทุกช่องรับมาจากผลการคำนวณของหน้าที่เรียก (PaySlipCalc ชุดเดียวกับหน้าคำนวณเงินเดือน)
 * ไฟล์นี้ไม่คิดเงินใหม่เลย — กติกาของเจ้าของระบบคือสลิปต้องใช้สูตรเดียวกับหน้าคำนวณ
 *
 * หัวกระดาษอ่านจากข้อมูลผู้ออกเอกสารตั้งต้น (/admin/settings?s=issuer)
 * พิมพ์ด้วย window.print() — สไตล์พิมพ์อยู่ใน globals.css (.ps-paper)
 */

import { baht, thaiDate, thaiMonth } from "@/lib/format";
import { issuerOf } from "@/lib/crm-data";
import { hrDept, hrPos, type Employee } from "@/lib/hr-data";

const BD = "border border-[#c9ced6]";
const HEAD = "bg-[#f1f3f6]";

export type PayslipPaperProps = {
  emp: Employee;
  /** รอบเดือน "YYYY-MM" */
  month: string;
  /** ช่วงวันของรอบ */
  cycle: { from: string; to: string };
  income: [string, number][];
  deductions: [string, number][];
  /** รวมรายได้ (ไม่รวมรายการปรับปรุง ตามกติกาของระบบ) */
  earn: number;
  /** รวมรายการหัก */
  cut: number;
  /** ค่าใช้จ่ายคืนจากใบเบิกที่อนุมัติแล้ว — ไม่ใช่รายได้ ไม่คิดประกันสังคม */
  reimb: number;
  net: number;
  /** ประกันสังคมที่ลูกจ้างถูกหัก (บริษัทสมทบเท่ากัน) */
  ss: number;
};

export function PayslipPaper({
  emp,
  month,
  cycle,
  income,
  deductions,
  earn,
  cut,
  reimb,
  net,
  ss,
}: PayslipPaperProps) {
  const co = issuerOf("MAZ");
  const address = co.address.split("\n").filter(Boolean).join(" ");
  const [monthName, beYear] = thaiMonth(month).split(" ");
  const pos = hrPos(emp.pos);
  const rows = Math.max(income.length, deductions.length);

  return (
    <article className="ps-paper mx-auto w-full max-w-[794px] bg-white px-[34px] py-[32px] text-[12.5px] leading-[1.55] text-[#1f2328] shadow-sm sm:px-[44px] sm:py-[40px]">
      <header className="flex items-start justify-between gap-6">
        <div className="pt-1">
          <p className="text-[24px] leading-none font-extrabold tracking-[0.05em] text-primary">MAZ</p>
          <p className="mt-1 text-[9.5px] font-semibold tracking-[0.12em] text-muted-foreground">
            DIGITAL BUSINESS SOLUTION
          </p>
        </div>
        <div className="max-w-[62%] text-right font-bold">
          <h2 className="text-[15px]">ใบจ่ายเงินเดือน/ค่าจ้าง/เงินประจำตำแหน่ง</h2>
          <p className="font-medium">โปรดตรวจสอบและเก็บเป็นหลักฐานในการติดต่อการเงินและบัญชี</p>
          <p>{co.name}</p>
          {address && <p className="font-medium">{address}</p>}
          <p className="num font-medium">เลขผู้เสียภาษี : {co.taxId || "—"}</p>
        </div>
      </header>

      <div className="mt-3 h-[2px] bg-primary" />

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2 font-semibold">
        <dl className="grid grid-cols-[90px_auto] gap-x-3">
          <dt>ชื่อพนักงาน</dt>
          <dd>{emp.name}</dd>
          <dt>ตำแหน่ง</dt>
          <dd>{pos.label}</dd>
          <dt>แผนก</dt>
          <dd>{hrDept(pos.dept).label}</dd>
        </dl>
        <dl className="grid grid-cols-[86px_auto] gap-x-3">
          <dt>ประจำเดือน</dt>
          <dd>{monthName}</dd>
          <dt>ปี</dt>
          <dd className="num">{beYear}</dd>
          <dt>ช่วงวันที่</dt>
          <dd className="num">
            {thaiDate(cycle.from)} – {thaiDate(cycle.to)}
          </dd>
        </dl>
      </div>

      <table
        className={`mt-3 w-full border-collapse ${BD}`}
        style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
      >
        <colgroup>
          <col />
          <col style={{ width: 104 }} />
          <col />
          <col style={{ width: 104 }} />
        </colgroup>
        <thead>
          <tr className={HEAD}>
            {/* หัวตารางมี "จำนวนเงิน" สองช่อง — คีย์ใช้ลำดับ ไม่ใช่ข้อความ */}
            {["รายได้", "จำนวนเงิน", "รายการหัก", "จำนวนเงิน"].map((h, i) => (
              <th key={i} className={`${BD} px-2 py-1.5 text-center font-bold`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              <td className={`${BD} px-2 py-1`}>{income[i]?.[0] ?? ""}</td>
              <td className={`${BD} num px-2 py-1 text-right`}>
                {income[i] ? baht(income[i][1]) : ""}
              </td>
              <td className={`${BD} px-2 py-1`}>{deductions[i]?.[0] ?? ""}</td>
              <td className={`${BD} num px-2 py-1 text-right`}>
                {deductions[i] ? baht(deductions[i][1]) : ""}
              </td>
            </tr>
          ))}
          <tr className={HEAD}>
            <td className={`${BD} px-2 py-1.5 font-bold`}>รวมรายได้</td>
            <td className={`${BD} num px-2 py-1.5 text-right font-bold`}>{baht(earn)}</td>
            <td className={`${BD} px-2 py-1.5 font-bold`}>รวมรายการหัก</td>
            <td className={`${BD} num px-2 py-1.5 text-right font-bold`}>{baht(cut)}</td>
          </tr>
          {reimb > 0 && (
            <tr>
              {/* ใบเบิกที่อนุมัติแล้ว จ่ายคืนพร้อมเงินเดือน — ไม่ใช่รายได้ จึงอยู่นอกตารางรายได้ */}
              <td className={`${BD} px-2 py-1`} colSpan={3}>
                ค่าใช้จ่ายคืน (ใบเบิกที่อนุมัติแล้ว)
              </td>
              <td className={`${BD} num px-2 py-1 text-right`}>{baht(reimb)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-3 flex items-center justify-between gap-4 border-2 border-primary px-3.5 py-2.5 font-bold">
        <span>เงินรับสุทธิ</span>
        <b className="num text-[17px] text-primary">{baht(net)} บาท</b>
      </div>

      <p className="mt-3 text-[11.5px] leading-[1.7] text-muted-foreground">
        บริษัทสมทบประกันสังคมเท่ากับที่ลูกจ้างถูกหัก {baht(ss)} บาท
        <br />
        เอกสารนี้ออกจากระบบ ERP MAZ ไม่ต้องลงลายมือชื่อ
      </p>
    </article>
  );
}
