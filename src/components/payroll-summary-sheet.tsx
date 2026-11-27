"use client";

/*
 * ใบสรุปเงินเดือนของรอบ — A4 แนวนอน พิมพ์หรือบันทึกเป็น PDF ได้
 * (ยกแนวมาจาก ERP_Test · เจ้าของสั่ง 16 ต.ค. 2569 — ผู้บริหารใช้ใบนี้โอนเงินเดือน)
 *
 * ตัวเลขมาจาก payLines ชุดเดียวกับหน้าคำนวณเงินเดือน ไม่คิดใหม่ในไฟล์นี้
 * รอบที่ปิดแล้วหน้าคำนวณอ่านยอดที่บันทึกไว้ ใบนี้จึงตรงกับสลิปและยอดที่ CEO อนุมัติเสมอ (HR-BR-03)
 *
 * แถวจัดกลุ่มตามแผนก มีแถวรวมย่อยของแต่ละแผนกและแถวรวมทั้งรอบ
 * ธนาคารกับเลขบัญชีอ่านผ่านฟังก์ชันของฐานข้อมูล เห็นได้เฉพาะฝ่ายบุคคลกับผู้บริหาร (รอบที่ 144)
 */

import { Fragment, useEffect, useState } from "react";
import { baht, thaiDate, thaiMonth } from "@/lib/format";
import { issuerOf } from "@/lib/crm-data";
import { hrDept, hrPos, type Cycle, type PayLine } from "@/lib/hr-data";
import { bankText, fetchBankList, type BankAccount } from "@/lib/supabase/bank";
import { Sheet } from "./lead-dialogs";

/** คอลัมน์เงินของใบนี้ — เรียงตามที่ผู้บริหารอ่านเวลาโอน */
const COLS: { k: keyof Sum; label: string }[] = [
  { k: "base", label: "เงินเดือน/ค่าจ้าง" },
  { k: "ot", label: "โอที" },
  { k: "com", label: "ค่าคอม" },
  { k: "inc", label: "Incentive" },
  { k: "allow", label: "ค่าครองชีพ" },
  { k: "adj", label: "ปรับปรุง" },
  { k: "ss", label: "ประกันสังคม" },
  { k: "cut", label: "สาย/ขาด/ลาไม่รับค่าจ้าง" },
  { k: "reimb", label: "ค่าใช้จ่ายคืน" },
  { k: "net", label: "สุทธิ" },
];

type Sum = {
  base: number;
  ot: number;
  com: number;
  inc: number;
  allow: number;
  adj: number;
  ss: number;
  cut: number;
  reimb: number;
  net: number;
};

const zero = (): Sum => ({ base: 0, ot: 0, com: 0, inc: 0, allow: 0, adj: 0, ss: 0, cut: 0, reimb: 0, net: 0 });

const r2 = (v: number) => Math.round(v * 100) / 100;

function sumOf(line: PayLine): Sum {
  const c = line.c;
  return {
    base: c.base,
    ot: c.ot,
    com: c.com,
    inc: c.inc,
    allow: c.allow,
    adj: c.adj,
    ss: c.ss,
    /* รายการหักที่มาจากเวลาทำงาน รวมเป็นช่องเดียวบนใบโอน รายละเอียดดูในสลิป */
    cut: r2(c.late + c.absent + c.unpaid),
    reimb: c.reimb,
    net: c.net,
  };
}

function addTo(a: Sum, b: Sum) {
  for (const k of Object.keys(a) as (keyof Sum)[]) a[k] = r2(a[k] + b[k]);
}

/**
 * พิมพ์เฉพาะกระดาษใบสรุป แนวนอนเต็ม A4
 * ย้ายสำเนาไปไว้ใต้ body ก่อนพิมพ์ — กระดาษอยู่ในกล่องที่เลื่อนได้ ถ้าพิมพ์ทั้งหน้าจะโดนตัดขอบ
 */
export function printPayrollSummary() {
  const paper = document.querySelector(".pr-sum");
  if (!paper) return;
  const host = document.createElement("div");
  host.className = "pr-sum-host";
  host.appendChild(paper.cloneNode(true));
  document.body.appendChild(host);
  const st = document.createElement("style");
  st.textContent = "@page { size: A4 landscape; margin: 8mm; }";
  document.head.appendChild(st);
  document.body.classList.add("print-sum");
  window.print();
  window.setTimeout(() => {
    document.body.classList.remove("print-sum");
    st.remove();
    host.remove();
  }, 400);
}

export function PayrollSummarySheet({
  lines,
  month,
  cycle,
  onClose,
}: {
  /** บรรทัดเงินเดือนของกลุ่มที่กำลังดู (รายเดือนหรือรายวัน) */
  lines: PayLine[];
  /** รอบเดือน "YYYY-MM" */
  month: string;
  cycle: Cycle;
  onClose: () => void;
}) {
  const co = issuerOf("MAZ");
  const [banks, setBanks] = useState<Record<string, BankAccount>>({});
  useEffect(() => {
    void fetchBankList().then(setBanks);
  }, []);

  /* จัดกลุ่มตามแผนกของตำแหน่งหลัก แล้วเรียงชื่อในแต่ละกลุ่ม */
  const byDept = new Map<string, PayLine[]>();
  for (const l of lines) {
    const d = hrPos(l.e.pos).dept;
    const list = byDept.get(d) ?? [];
    list.push(l);
    byDept.set(d, list);
  }
  const groups = [...byDept.entries()].map(([dept, list]) => ({
    dept,
    list: [...list].sort((a, b) => a.e.name.localeCompare(b.e.name, "th")),
  }));

  const all = zero();
  for (const l of lines) addTo(all, sumOf(l));

  let seq = 0;

  return (
    <Sheet
      title={`ใบสรุปเงินเดือน ${thaiMonth(month)}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ปิด
          </button>
          <button type="button" className="btn solid btn-solid" onClick={printPayrollSummary}>
            พิมพ์ / บันทึก PDF
          </button>
        </>
      }
    >
      <div className="overflow-auto">
        <article className="pr-sum w-max min-w-full bg-white px-6 py-5 text-[11.5px] text-[#1f2328]">
          <header className="flex items-start justify-between gap-6">
            <div>
              <p className="text-[18px] leading-none font-extrabold tracking-[0.05em] text-primary">MAZ</p>
              <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{co.name}</p>
            </div>
            <div className="text-right">
              <h2 className="text-[15px] font-bold">ใบสรุปเงินเดือนประจำรอบ</h2>
              <p className="num font-medium">
                {thaiMonth(month)} · {thaiDate(cycle.from)} – {thaiDate(cycle.to)}
              </p>
              <p className="num text-muted-foreground">
                {lines.length} คน · ยอดโอนรวม {baht(all.net)} บาท
              </p>
            </div>
          </header>

          <table className="mt-3 w-full border-collapse text-[10.5px]">
            <thead>
              <tr className="bg-[#f1f3f6]">
                <th className="border border-[#c9ced6] px-1.5 py-1 text-center">ลำดับ</th>
                <th className="border border-[#c9ced6] px-1.5 py-1 text-left">ชื่อ-สกุล</th>
                <th className="border border-[#c9ced6] px-1.5 py-1 text-left">ตำแหน่ง</th>
                <th className="border border-[#c9ced6] px-1.5 py-1 text-left">ธนาคาร / เลขบัญชี</th>
                {COLS.map((c) => (
                  <th key={c.k} className="border border-[#c9ced6] px-1.5 py-1 text-right">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const sub = zero();
                for (const l of g.list) addTo(sub, sumOf(l));
                return (
                  /* กลุ่มแผนกใช้ Fragment — tbody ซ้อน tbody เป็น HTML ที่ไม่ถูกต้อง (React ฟ้องตอนทดสอบรอบที่ 144) */
                  <Fragment key={g.dept}>
                    {g.list.map((l) => {
                      seq += 1;
                      const m = sumOf(l);
                      return (
                        <tr key={l.e.id}>
                          <td className="num border border-[#c9ced6] px-1.5 py-1 text-center">{seq}</td>
                          <td className="border border-[#c9ced6] px-1.5 py-1">{l.e.name}</td>
                          <td className="border border-[#c9ced6] px-1.5 py-1">{hrPos(l.e.pos).label}</td>
                          <td className="num border border-[#c9ced6] px-1.5 py-1">
                            {bankText(banks[l.e.id]) || "—"}
                          </td>
                          {COLS.map((c) => (
                            <td key={c.k} className="num border border-[#c9ced6] px-1.5 py-1 text-right">
                              {m[c.k] ? baht(m[c.k]) : "-"}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    <tr className="bg-[#f7f8fa] font-semibold">
                      <td className="border border-[#c9ced6] px-1.5 py-1" colSpan={4}>
                        รวม{hrDept(g.dept).label} ({g.list.length} คน)
                      </td>
                      {COLS.map((c) => (
                        <td key={c.k} className="num border border-[#c9ced6] px-1.5 py-1 text-right">
                          {sub[c.k] ? baht(sub[c.k]) : "-"}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
              <tr className="bg-[#e9edf3] font-bold">
                <td className="border border-[#c9ced6] px-1.5 py-1.5" colSpan={4}>
                  รวมทั้งรอบ ({lines.length} คน)
                </td>
                {COLS.map((c) => (
                  <td key={c.k} className="num border border-[#c9ced6] px-1.5 py-1.5 text-right">
                    {all[c.k] ? baht(all[c.k]) : "-"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          <p className="mt-2 text-[10px] leading-[1.6] text-muted-foreground">
            ช่อง &quot;สาย/ขาด/ลาไม่รับค่าจ้าง&quot; รวมรายการหักที่มาจากเวลาทำงาน รายละเอียดรายคนดูได้ในสลิปเงินเดือน ·
            ค่าใช้จ่ายคืนเป็นการจ่ายคืนใบเบิกที่อนุมัติแล้ว ไม่ใช่รายได้ และไม่คิดประกันสังคม
          </p>
        </article>
      </div>
    </Sheet>
  );
}
