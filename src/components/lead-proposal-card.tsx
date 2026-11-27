"use client";

/*
 * การ์ด "แม่แบบ Proposal" ในหน้าผู้สนใจ (ยกมาจาก ERP_Test · รอบที่ 134)
 *
 * กรอบ Proposal ของบริษัทที่ผู้บริหารอัปโหลดไว้ที่หน้าตั้งค่าระบบ
 * ฝ่ายขายกับทีมก่อนการขายเปิดหรือดาวน์โหลดจากที่นี่ แล้วใช้เป็นโครงก่อนทำข้อเสนอ
 * ไม่ใช่ไฟล์ของลูกค้ารายนี้ (ไฟล์ของรายนี้อยู่ในการ์ดไฟล์และเอกสาร)
 */

import { useState } from "react";
import { useProposalTemplates } from "@/lib/proposal-templates";
import { proposalFileUrl } from "@/lib/supabase/proposal-templates";
import { FileIcon, LinkIcon } from "./icons";

export function LeadProposalCard() {
  const list = useProposalTemplates();
  const [msg, setMsg] = useState("");

  if (!list.length) return null;

  async function open(id: string) {
    const t = list.find((x) => x.id === id);
    if (!t) return;
    const url = await proposalFileUrl(t);
    if (!url) {
      setMsg("แม่แบบนี้เก็บไว้แค่ชื่อไฟล์ ยังเปิดไม่ได้ — แจ้งผู้ดูแลระบบ");
      return;
    }
    setMsg("");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="ld-card glass rounded-2xl px-4 py-5 sm:px-[22px]">
      <h2 className="text-[15px] font-bold">แม่แบบ Proposal</h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        กรอบของบริษัท ใช้เป็นโครงก่อนทำข้อเสนอให้ลูกค้า
      </p>
      <ul className="mt-3 grid gap-2">
        {list.map((t) => (
          <li key={t.id} className="flex items-start gap-2.5 rounded-[12px] border border-border px-3 py-2.5">
            <span className="grid size-8 flex-none place-items-center rounded-[9px] bg-accent text-primary">
              {t.url ? <LinkIcon className="size-4" /> : <FileIcon className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <b className="block text-[13px]">{t.name}</b>
              {t.note && <p className="text-[12px] text-muted-foreground">{t.note}</p>}
            </div>
            <button type="button" className="btn glass-thin btn-mini" onClick={() => void open(t.id)}>
              เปิด
            </button>
          </li>
        ))}
      </ul>
      {msg && <p className="mt-2 text-[12px] font-semibold text-destructive">{msg}</p>}
    </section>
  );
}
