"use client";

/*
 * ยกเลิกดีลหลังปิดการขาย — ใช้ทั้งหน้าดีล (ฝ่ายขาย ก่อนรับเงิน) และหน้าวางบิล (ฝ่ายบัญชี หลังรับเงิน)
 * บังคับใส่เหตุผลเสมอ และบอกให้ชัดก่อนกดว่าอะไรจะเกิดกับฝ่ายอื่น
 *
 * ช่อง "บันทึกเพิ่มเติม" ไม่บังคับ (เจ้าของระบบสั่งเพิ่ม 24 ก.ย. 2569)
 * ไว้ให้ฝ่ายบัญชีจดว่าตกลงอะไรกับลูกค้าไว้ เช่นออกเอกสารอะไรในโปรแกรมบัญชีของตัวเอง
 * คนที่มาอ่านย้อนหลังจะได้รู้ว่าเรื่องนี้จบลงอย่างไร ไม่ใช่รู้แค่ว่ายกเลิกเพราะอะไร
 */

import { useState } from "react";
import { cancelDealFlow, type CancelBy } from "@/lib/flow";
import { dealPaidAmount, useAcc } from "@/lib/acc-store";
import { baht } from "@/lib/format";
import { Sheet } from "./lead-dialogs";

export function CancelDealDialog({
  dealNo,
  cus,
  total,
  by,
  rows,
  onClose,
}: {
  dealNo: string;
  cus: string;
  total: number;
  by: CancelBy;
  /** แถวข้อมูลแทนชุดตั้งต้น — หน้าวางบิลใช้ตามต้นแบบ billing.html (ลูกค้า · รับชำระแล้ว · ใบแจ้งหนี้ที่จะยกเลิก) */
  rows?: { label: string; value: string }[];
  onClose: () => void;
}) {
  const [why, setWhy] = useState("");
  const [note, setNote] = useState("");
  const [warn, setWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const acc = useAcc();
  /* ลูกค้าจ่ายมาแล้วเท่าไร — ตัวเลขนี้กลายเป็นเพดานงานที่ทีมต้องทำต่อ (รอบที่ 140) */
  const paid = dealPaidAmount(acc, dealNo);

  function confirm() {
    if (!why.trim()) return setWarn(true);
    setBusy(true);
    void cancelDealFlow(dealNo, why, by, note).then((r) => {
      setBusy(false);
      if (r.ok) onClose();
    });
  }

  return (
    <Sheet
      title={rows ? "ยกเลิกดีล" : `ยกเลิกดีล ${dealNo}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ปิด
          </button>
          <button type="button" className="btn solid btn-solid" disabled={busy} onClick={confirm}>
            ยกเลิกดีล
          </button>
        </>
      }
    >
      {rows ? (
        <dl className="flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-[11.5px] font-semibold text-muted-foreground">{r.label}</dt>
              <dd className="num mt-0.5 text-[14.5px] leading-normal">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="grid gap-2 text-[13.5px] sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-x-4">
          <dt className="text-[12.5px] font-semibold text-muted-foreground">ลูกค้า</dt>
          <dd className="font-semibold">{cus}</dd>
          <dt className="text-[12.5px] font-semibold text-muted-foreground">มูลค่าดีล</dt>
          <dd className="num font-semibold">{baht(total)} บาท</dd>
        </dl>
      )}
      <label className="mt-4 block text-[12.5px] font-semibold text-muted-foreground" htmlFor="cancel-why">
        เหตุผลที่ยกเลิก <span className="text-destructive">*</span>
      </label>
      <textarea
        id="cancel-why"
        value={why}
        onChange={(e) => {
          setWhy(e.target.value);
          if (e.target.value.trim()) setWarn(false);
        }}
        placeholder={by === "ฝ่ายบัญชี" ? "เช่น ลูกค้าขอยุติโครงการ" : "เช่น ลูกค้าชะลอโครงการ"}
        rows={3}
        className="field-control mt-1.5 w-full rounded-[11px] px-3 py-2.5 text-[13.5px]"
      />
      {warn && <p className="mt-2 text-[12.5px] text-destructive">ใส่เหตุผลก่อนยกเลิก</p>}
      {/* ไม่บังคับ — ว่างไว้ก็ยกเลิกได้ ป้ายกำกับจึงไม่มีดอกจัน */}
      <label className="mt-4 block text-[12.5px] font-semibold text-muted-foreground" htmlFor="cancel-note">
        บันทึกเพิ่มเติม (ไม่บังคับ)
      </label>
      <textarea
        id="cancel-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="ระบุว่าตกลงกับลูกค้าอย่างไร เช่น ลูกค้ารับทราบและขอเก็บงานที่ส่งแล้วไว้ · แจ้งทางไลน์เมื่อ 24 ก.ย."
        rows={2}
        className="field-control mt-1.5 w-full rounded-[11px] px-3 py-2.5 text-[13.5px]"
      />
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
        ไว้บันทึกว่าตกลงอะไรกับลูกค้าไว้ คนที่มาดูย้อนหลังจะได้รู้ว่าเรื่องนี้จบลงอย่างไร
      </p>
      {/* ใบที่ยังไม่ได้รับชำระถูกยกเลิกทันทีตรงนี้ ต้องบอกให้ชัดก่อนกด ไม่ใช่ให้ไปเห็นเอาทีหลัง */}
      {/* ใบที่ยังไม่ได้รับชำระถูกยกเลิกทันทีตรงนี้ ต้องบอกให้ชัดก่อนกด ไม่ใช่ให้ไปเห็นเอาทีหลัง */}
      <p className="mt-3 rounded-[11px] border border-[rgba(180,99,11,.25)] bg-[var(--warning-soft)] px-3.5 py-3 text-[12.5px] leading-relaxed text-[var(--warning)]">
        ใบแจ้งหนี้ที่ยังไม่ได้รับชำระของดีลนี้จะถูกยกเลิกไปด้วย พร้อมบันทึกชื่อผู้ยกเลิกและเวลา ·
        วางบิลงวดใหม่ของดีลนี้ไม่ได้อีก
        {paid > 0 ? (
          <>
            {" · "}
            ลูกค้าจ่ายมาแล้ว <b className="num font-bold">{baht(paid)}</b> บาท — ระบบไม่คืนเงิน
            และงานของ PM <b className="font-bold">ไม่หยุด</b> แต่ทำต่อได้เท่ายอดที่จ่าย
            แล้ว PM เป็นคนกดปิดงานเมื่อส่งของครบเท่านั้น
          </>
        ) : (
          " · โปรเจคของ PM เปลี่ยนเป็นยกเลิก งานหยุดทันที"
        )}
      </p>
    </Sheet>
  );
}
