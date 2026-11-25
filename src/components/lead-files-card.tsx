"use client";

/*
 * การ์ด "ไฟล์ Proposal และเอกสาร" ในหน้าผู้สนใจ (ยกมาจากสาย ERP_Test 14 ต.ค. 2569)
 *
 * ฝ่ายขายทำ Proposal เอง แล้วแนบไว้ที่นี่ — ไฟล์ หรือลิงก์ (Google Drive, Canva)
 * เรียงใหม่สุดก่อน บอกคนแนบและวันที่ · คนแนบเท่านั้นที่ลบได้ (ยืนยันก่อน)
 *
 * ไฟล์จริงขึ้นถังของระบบตั้งแต่รอบที่ 115 ทีมจึงเปิดดูได้จากทุกเครื่อง
 * ไม่ยกปุ่ม "แม่แบบ Proposal" ของ CEO มา เพราะคลังแม่แบบยังไม่มีในสายนี้
 */

import { useMemo, useState } from "react";
import { thaiDate } from "@/lib/format";
import { addLeadFiles, removeLeadFile, useLeadFiles, type LeadFile } from "@/lib/lead-files";
import { getFile } from "@/lib/file-store";
import { fileUrl } from "@/lib/supabase/files";
import { useProfile } from "@/lib/profile-data";
import { useNameOf } from "@/lib/emp-name";
import { ConfirmDialog } from "./confirm-dialog";
import { FileDrop, fileSize, type PickedFile } from "./file-drop";
import { DownloadIcon, FileIcon, LinkIcon, TrashIcon } from "./icons";
import { Sheet } from "./lead-dialogs";

const CARD = "ld-card glass rounded-2xl px-4 py-5 sm:px-[22px] md:rounded-[20px] md:p-7";
const HEAD = "flex flex-wrap items-center gap-2 text-[15px] font-semibold md:gap-2.5 md:text-[20px]";
const HEAD_ICON = "size-4 shrink-0 text-primary md:size-5";
const LINK_BTN = "text-[12.5px] font-semibold text-primary hover:underline md:text-[14px]";
const MINI = "iconbtn glass-thin grid shrink-0 place-items-center text-muted-foreground max-sm:!size-[38px]";

/** ป้ายชนิด — ลิงก์ หรือนามสกุลไฟล์ */
function Kind({ f }: { f: Pick<LeadFile, "name" | "url"> }) {
  const dot = f.name.lastIndexOf(".");
  const ext = !f.url && dot > 0 ? f.name.slice(dot + 1).toUpperCase().slice(0, 4) : "";
  return (
    <span className="num grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-[10.5px] font-bold text-muted-foreground">
      {f.url ? "LINK" : ext || "FILE"}
    </span>
  );
}

/** ปุ่มเปิดลิงก์ / เปิดไฟล์ในถัง — ไฟล์ที่เก็บแค่ชื่อกดไม่ได้ */
function OpenBtn({ file }: { file: LeadFile }) {
  const box = { width: 30, height: 30 };
  if (file.url)
    return (
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`เปิด ${file.name}`}
        title="เปิดลิงก์"
        className={`${MINI} hover:text-primary`}
        style={box}
      >
        <LinkIcon className="size-[15px]" strokeWidth={2} />
      </a>
    );
  if (file.path)
    return (
      <button
        type="button"
        aria-label={`เปิด ${file.name}`}
        title="เปิดไฟล์"
        className={`${MINI} hover:text-primary`}
        style={box}
        onClick={() =>
          void fileUrl(file.path!).then((url) => {
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          })
        }
      >
        <DownloadIcon className="size-[15px]" strokeWidth={2} />
      </button>
    );
  return (
    <span title="ไฟล์นี้เก็บไว้แค่ชื่อ ยังไม่ได้อัปโหลดจริง" className="inline-flex">
      <button type="button" disabled aria-label={`เปิด ${file.name} — ยังไม่ได้อัปโหลดจริง`} className={`${MINI} opacity-40`} style={box}>
        <DownloadIcon className="size-[15px]" strokeWidth={2} />
      </button>
    </span>
  );
}

export function LeadFilesCard({ code }: { code: string }) {
  const all = useLeadFiles();
  const me = useProfile().name;
  const empName = useNameOf();
  const files = useMemo(
    () => all.filter((f) => f.lead === code).sort((a, b) => b.at.localeCompare(a.at)),
    [all, code],
  );
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<LeadFile | null>(null);

  return (
    <section className={CARD}>
      <h2 className={HEAD}>
        <FileIcon className={HEAD_ICON} strokeWidth={2} />
        <span className="min-w-0">ไฟล์ Proposal และเอกสาร</span>
        <span className="ml-auto flex items-center gap-3">
          <button type="button" className={LINK_BTN} onClick={() => setAdding(true)}>
            แนบไฟล์
          </button>
        </span>
      </h2>

      {files.length === 0 ? (
        <p className="py-5 text-center text-[13px] text-muted-foreground md:py-7 md:text-[14px]">
          ยังไม่มีไฟล์ Proposal หรือเอกสารของรายนี้
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-border md:mt-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5 md:py-3">
              <Kind f={f} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[13.5px] font-medium md:text-[15px]" title={f.name}>
                  {f.name}
                </b>
                <span className="num block text-[11.5px] text-muted-foreground md:text-[13px]">
                  {empName(f.by)} · {thaiDate(f.at.slice(0, 10))} {f.at.slice(11)}
                  {!f.url && f.size > 0 && ` · ${fileSize(f.size)}`}
                </span>
              </span>
              <OpenBtn file={f} />
              {f.by === me && (
                <button
                  type="button"
                  aria-label={`ลบ ${f.name}`}
                  title="ลบ"
                  onClick={() => setRemoving(f)}
                  className={`${MINI} hover:text-destructive`}
                  style={{ width: 30, height: 30 }}
                >
                  <TrashIcon className="size-[15px]" strokeWidth={1.9} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddFilesSheet
          code={code}
          by={me}
          onClose={() => setAdding(false)}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        tone="destructive"
        title="ลบไฟล์นี้?"
        description="ลบแล้วเรียกคืนไม่ได้"
        detail={removing?.name}
        confirmLabel="ลบไฟล์"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) removeLeadFile(removing.id);
          setRemoving(null);
        }}
      />
    </section>
  );
}

function AddFilesSheet({ code, by, onClose }: { code: string; by: string; onClose: () => void }) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    /* ไฟล์จริงเก็บไบต์ไว้ในเครื่องตอนเลือก — ประกอบกลับเป็นไฟล์เพื่อส่งขึ้นถัง */
    const out: { name: string; size: number; url?: string; file?: File }[] = [];
    for (const f of files) {
      const link = f.url && /^https?:\/\//i.test(f.url) ? f.url : undefined;
      let real: File | undefined;
      if (!link && f.fileId) {
        const saved = await getFile(f.fileId);
        if (saved?.blob) real = new File([saved.blob], saved.name, { type: saved.type || saved.blob.type });
      }
      out.push({ name: f.name, size: f.size, url: link, file: real });
    }
    addLeadFiles(code, out, by);
    onClose();
  }

  return (
    <Sheet
      title="แนบไฟล์ Proposal และเอกสาร"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin flex-1 justify-center sm:flex-none" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn solid btn-solid flex-1 justify-center sm:flex-none"
            disabled={busy || saving || files.length === 0}
            onClick={() => void save()}
          >
            {saving ? "กำลังอัปโหลด…" : `แนบ ${files.length > 0 ? `${files.length} รายการ` : ""}`}
          </button>
        </>
      }
    >
      <FileDrop
        files={files}
        onChange={setFiles}
        onBusy={setBusy}
        title="ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์"
        hint="Proposal ที่ทำเอง หรือเอกสารประกอบ (PDF หรือรูปภาพ)"
        label="เลือกไฟล์ Proposal"
        links
        linkPlaceholder="หรือวางลิงก์ เช่น Google Drive, Canva"
      />
    </Sheet>
  );
}
