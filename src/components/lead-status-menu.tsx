"use client";

/*
 * ป้ายสถานะผู้สนใจที่กดเปลี่ยนสถานะได้ (ดรอปดาวน์)
 *
 *   รอนัดหมาย  → เปิดรับพิจารณาใหม่ (ถามยืนยัน)
 *   ติดราคา    → ถามยืนยัน ปกติเกิดเองเมื่อออกใบเสนอราคา
 *   ปฏิเสธ     → ต้องเลือกเหตุผล (ลูกค้าเป็นฝ่ายไม่เอา)
 *   ไม่เสนองาน → ต้องเลือกเหตุผล (เราเป็นฝ่ายไม่เสนอให้)
 *   ปิดงาน     → ถามยืนยัน ปกติเกิดเองเมื่อลูกค้าตอบรับใบเสนอราคา
 *
 * ทุกการเปลี่ยนลงประวัติการเปลี่ยนแปลงผ่าน moveCustomer ใน crm-store
 */

import { useState } from "react";
import { CUSTOMER_STATUS, type CustomerStatus } from "@/lib/crm-data";
import { closeLead, markLeadQuoted, markLeadWon, reopenLead, skipLead } from "@/lib/crm-store";
import { ConfirmDialog } from "./confirm-dialog";
import { CloseLeadDialog } from "./lead-dialogs";
import { StatusMenu } from "./status-menu";

const ORDER: CustomerStatus[] = ["รอนัดหมาย", "ติดราคา", "ปฏิเสธ", "ไม่เสนองาน", "ปิดงาน"];

export function LeadStatusMenu({
  code,
  name,
  status,
}: {
  code: string;
  name: string;
  status: CustomerStatus;
}) {
  const [pick, setPick] = useState<CustomerStatus | null>(null);

  return (
    <>
      <StatusMenu
        current={status}
        options={ORDER.map((s) => ({ value: s, cls: CUSTOMER_STATUS[s] }))}
        onPick={setPick}
      />

      {(pick === "ปฏิเสธ" || pick === "ไม่เสนองาน") && (
        <CloseLeadDialog
          customerName={name}
          code={code}
          kind={pick === "ไม่เสนองาน" ? "skip" : "reject"}
          onClose={() => setPick(null)}
          onSubmit={(reason) => {
            if (pick === "ไม่เสนองาน") skipLead(code, reason);
            else closeLead(code, reason);
            setPick(null);
          }}
        />
      )}
      <ConfirmDialog
        open={pick === "รอนัดหมาย" || pick === "ติดราคา" || pick === "ปิดงาน"}
        title={`เปลี่ยนสถานะเป็น ${pick ?? ""}`}
        description={`${name} (${code}) · ${status} → ${pick ?? ""}`}
        detail={
          pick === "ปิดงาน"
            ? "ปกติระบบเปลี่ยนให้เองเมื่อลูกค้าตอบรับใบเสนอราคา ใช้เมื่อปิดการขายนอกระบบ"
            : pick === "ติดราคา"
              ? "ปกติระบบเปลี่ยนให้เองเมื่อออกใบเสนอราคา ใช้เมื่อเสนอราคาไปนอกระบบ"
              : "กลับมาอยู่ในรายการที่ต้องติดตาม"
        }
        confirmLabel="เปลี่ยนสถานะ"
        onConfirm={() => {
          if (pick === "ปิดงาน") markLeadWon(code, "เปลี่ยนสถานะเป็นปิดงานเอง");
          if (pick === "ติดราคา") markLeadQuoted(code, "เปลี่ยนสถานะเป็นติดราคาเอง");
          if (pick === "รอนัดหมาย") reopenLead(code);
          setPick(null);
        }}
        onCancel={() => setPick(null)}
      />
    </>
  );
}
