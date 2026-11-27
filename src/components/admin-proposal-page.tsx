"use client";

/*
 * แม่แบบ Proposal ของผู้บริหาร (ยกมาจาก ERP_Test · รอบที่ 134)
 *
 * อยู่ในหน้าตั้งค่าระบบ หัวข้อ "แม่แบบ Proposal" — ผู้บริหารหรือผู้ดูแลระบบจัดการ
 * แนบไฟล์จริงขึ้นถังของระบบ หรือใส่ลิงก์ (Google Slides ฯลฯ) ก็ได้
 * ฝ่ายขายเปิดจากการ์ด "แม่แบบ Proposal" ในหน้าผู้สนใจ
 */

import { useState } from "react";
import { thaiDate } from "@/lib/format";
import { useProfile } from "@/lib/profile-data";
import { useRole } from "@/lib/role";
import {
  addProposalTemplate,
  removeProposalTemplate,
  useProposalTemplates,
} from "@/lib/proposal-templates";
import { proposalFileUrl } from "@/lib/supabase/proposal-templates";
import { AdminHead } from "./admin-ui";
import { ConfirmDialog } from "./confirm-dialog";
import { FileIcon, LinkIcon, PlusIcon, TrashIcon } from "./icons";
import { Sheet } from "./lead-dialogs";

/** ขนาดไฟล์แบบอ่านง่าย */
function sizeText(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AdminProposalPage() {
  const list = useProposalTemplates();
  const me = useProfile();
  const role = useRole();
  /* ผู้บริหารกับฝ่ายบุคคล (ผู้ดูแลระบบ) เท่านั้นที่จัดการได้ — ฐานข้อมูลกันอีกชั้น */
  const canEdit = role === "ceo" || role === "hr";
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState("");

  async function open(id: string) {
    const t = list.find((x) => x.id === id);
    if (!t) return;
    const url = await proposalFileUrl(t);
    if (!url) {
      setToast("แม่แบบนี้เก็บไว้แค่ชื่อไฟล์ ยังเปิดไม่ได้");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-4">
      <AdminHead
        title="แม่แบบ Proposal"
        desc="กรอบ Proposal ของบริษัท — ฝ่ายขายและทีมก่อนการขายเปิดไปใช้เป็นโครงก่อนทำข้อเสนอ"
      />

      {toast && <p className="rounded-[11px] bg-muted px-3.5 py-2.5 text-[12.5px] font-semibold">{toast}</p>}

      <section className="panel glass">
        <div className="strip justify-end">
          {canEdit && (
            <button type="button" className="btn solid btn-solid my-2" onClick={() => setAdding(true)}>
              <PlusIcon className="size-[15px]" strokeWidth={2.2} />
              เพิ่มแม่แบบ
            </button>
          )}
        </div>

        {list.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            ยังไม่มีแม่แบบ {canEdit ? "กดเพิ่มแม่แบบเพื่ออัปโหลดไฟล์หรือใส่ลิงก์" : "ให้ผู้บริหารอัปโหลดไว้ก่อน"}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-accent text-primary">
                  {t.url ? <LinkIcon className="size-4" /> : <FileIcon className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block text-[13.5px]">{t.name}</b>
                  {t.note && <p className="text-[12.5px] text-muted-foreground">{t.note}</p>}
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {t.url ? "ลิงก์" : t.file || "ไม่มีไฟล์"}
                    {t.size ? ` · ${sizeText(t.size)}` : ""}
                    {t.by ? ` · โดย ${t.by}` : ""}
                    {t.at ? ` · ${thaiDate(t.at.slice(0, 10))}` : ""}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" className="btn glass-thin btn-mini" onClick={() => void open(t.id)}>
                    เปิด
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`ลบแม่แบบ ${t.name}`}
                      className="btn glass-thin btn-mini"
                      onClick={() => setRemoving({ id: t.id, name: t.name })}
                    >
                      <TrashIcon className="size-4" strokeWidth={1.9} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {adding && (
        <AddDialog
          by={me.name}
          onClose={() => setAdding(false)}
          onDone={(msg) => {
            setAdding(false);
            setToast(msg);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="ลบแม่แบบ Proposal"
        description={removing ? `${removing.name} — ลบแล้วไฟล์ในระบบถูกลบด้วย` : ""}
        confirmLabel="ลบ"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (!target) return;
          void removeProposalTemplate(target.id).then((r) => setToast(r.ok ? "ลบแม่แบบแล้ว" : r.message));
        }}
      />
    </div>
  );
}

function AddDialog({
  by,
  onClose,
  onDone,
}: {
  by: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!name.trim()) {
      setErr("ใส่ชื่อแม่แบบก่อน");
      return;
    }
    if (!file && !url.trim()) {
      setErr("แนบไฟล์ หรือใส่ลิงก์อย่างน้อยหนึ่งอย่าง");
      return;
    }
    setBusy(true);
    const res = await addProposalTemplate({ name, note, url: url.trim() || undefined, file: file ?? undefined, by });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    onDone("เพิ่มแม่แบบแล้ว");
  }

  return (
    <Sheet
      title="เพิ่มแม่แบบ Proposal"
      narrow
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid" disabled={busy} onClick={() => void save()}>
            {busy ? "กำลังบันทึก…" : "เพิ่ม"}
          </button>
        </>
      }
    >
      <label className="block text-[12.5px] font-semibold">ชื่อแม่แบบ</label>
      <input
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        placeholder="เช่น Proposal Framework (CEO)"
        className="field-control mt-1.5"
      />

      <label className="mt-3.5 block text-[12.5px] font-semibold">คำอธิบาย (ไม่บังคับ)</label>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="เช่น ใช้เป็นโครงทุกครั้งก่อนทำข้อเสนอ"
        className="field-control mt-1.5"
      />

      <label className="mt-3.5 block text-[12.5px] font-semibold">ไฟล์แม่แบบ</label>
      <input
        type="file"
        accept=".pdf,.ppt,.pptx,.doc,.docx,image/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="mt-1.5 block w-full text-[12.5px]"
      />

      <label className="mt-3.5 block text-[12.5px] font-semibold">หรือลิงก์</label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://docs.google.com/presentation/…"
        className="field-control mt-1.5"
      />

      {err && <p className="mt-2.5 text-[12.5px] font-semibold text-destructive">{err}</p>}
      <p className="mt-3 rounded-[11px] bg-muted/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
        ไฟล์ขึ้นที่เก็บไฟล์ของระบบ ฝ่ายขายเปิดได้จากทุกเครื่อง · ไฟล์ใหญ่กว่า 10 MB ให้ใช้ลิงก์แทน
      </p>
    </Sheet>
  );
}
