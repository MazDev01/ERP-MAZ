"use client";

import { signedIn, supabase } from "./client";
import type {
  ClientReviewState,
  NewReviewFile,
  ReviewComment,
  ReviewFile,
  ReviewFileKind,
  ReviewRound,
  ReviewStatus,
} from "../client-review-store";

/*
 * ลูกค้าตรวจงานผ่านลิงก์ (รอบที่ 116)
 *
 * ฝั่งคนในบริษัทอ่านตารางตามปกติ (นโยบายของฝ่ายโครงการ)
 * ฝั่งลูกค้าไม่มีบัญชี จึงเรียกผ่านฟังก์ชันที่รับโทเคน — ตัวลิงก์คือกุญแจ
 * ไฟล์ของรอบอยู่ในถัง "review" ที่เป็นถังสาธารณะ ที่อยู่ขึ้นต้นด้วยโทเคน
 */

const BUCKET = "review";
const KINDS: ReviewFileKind[] = ["image", "video", "pdf", "link"];

/** "yyyy-mm-dd HH:mm" ตามเวลาไทย */
function stampOf(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const th = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000);
  return th.toISOString().slice(0, 16).replace("T", " ");
}

const kindOf = (k: string) => (KINDS.includes(k as ReviewFileKind) ? k : "image") as ReviewFileKind;

type RoundRow = {
  id: string;
  token: string;
  task_name: string;
  round: number;
  created_by: string;
  created_at: string;
  expires_at: string;
  message: string;
  contact: string;
  project: string;
  status: string;
  submitted_at: string | null;
  forwarded_at: string | null;
  closed_at: string | null;
  projects: { pj: string } | null;
};

type FileRow = {
  id: string;
  round_id: string;
  name: string;
  kind: string;
  size_text: string;
  url: string | null;
  poster: string | null;
  duration: number | null;
  approved: boolean;
  name_only: boolean;
};

type CommentRow = {
  id: string;
  round_id: string;
  file_id: string;
  author: string;
  tx: string;
  at: string;
  t: number | null;
  frame: string | null;
  pin: { x: number; y: number; n: number } | null;
  page: number | null;
  attach: { name: string; data?: string } | null;
  done: boolean;
};

/* ─── ฝั่งคนในบริษัท ─────────────────────────────────────────────── */

export async function fetchReviews(): Promise<ClientReviewState> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return { rounds: [] };

  const [rd, fl, cm] = await Promise.all([
    sb
      .from("review_rounds")
      .select(
        "id, token, task_name, round, created_by, created_at, expires_at, message, contact," +
          " project, status, submitted_at, forwarded_at, closed_at, projects(pj)",
      )
      .order("created_at"),
    sb
      .from("review_files")
      .select("id, round_id, name, kind, size_text, url, poster, duration, approved, name_only")
      .order("idx"),
    sb
      .from("review_comments")
      .select("id, round_id, file_id, author, tx, at, t, frame, pin, page, attach, done")
      .order("at"),
  ]);
  if (rd.error || fl.error || cm.error) return { rounds: [] };

  const filesBy = new Map<string, ReviewFile[]>();
  for (const f of (fl.data ?? []) as unknown as FileRow[]) {
    const item: ReviewFile = {
      id: f.id,
      name: f.name,
      kind: kindOf(f.kind),
      size: f.size_text,
      url: f.url ?? undefined,
      poster: f.poster ?? undefined,
      duration: f.duration ?? undefined,
      approved: f.approved || undefined,
      /* ไฟล์ที่รู้แค่ชื่อ — ลูกค้าเปิดไม่ได้ ใช้ธงเดิมของหน้าจอ */
      local: f.name_only || undefined,
    };
    filesBy.set(f.round_id, [...(filesBy.get(f.round_id) ?? []), item]);
  }

  const cmBy = new Map<string, ReviewComment[]>();
  for (const c of (cm.data ?? []) as unknown as CommentRow[]) {
    const item: ReviewComment = {
      id: c.id,
      fileId: c.file_id,
      author: c.author,
      text: c.tx,
      at: stampOf(c.at),
      t: c.t ?? undefined,
      frame: c.frame ?? undefined,
      pin: c.pin ?? undefined,
      page: c.page ?? undefined,
      attach: c.attach ?? undefined,
      done: c.done || undefined,
    };
    cmBy.set(c.round_id, [...(cmBy.get(c.round_id) ?? []), item]);
  }

  const rounds = ((rd.data ?? []) as unknown as RoundRow[]).map<ReviewRound>((r) => ({
    token: r.token,
    pj: r.projects?.pj ?? "",
    taskName: r.task_name,
    round: r.round,
    createdAt: stampOf(r.created_at),
    createdBy: r.created_by,
    expiresAt: r.expires_at,
    message: r.message,
    contact: r.contact,
    project: r.project,
    files: filesBy.get(r.id) ?? [],
    status: r.status as ReviewStatus,
    submittedAt: r.submitted_at ? stampOf(r.submitted_at) : undefined,
    comments: cmBy.get(r.id) ?? [],
    forwardedAt: r.forwarded_at ? stampOf(r.forwarded_at) : undefined,
    closedAt: r.closed_at ? stampOf(r.closed_at) : undefined,
  }));
  return { rounds };
}

/**
 * สร้างรอบตรวจ — เขียนหัวรอบ อัปโหลดไฟล์ที่เลือกจากเครื่อง แล้วเขียนรายการไฟล์
 * ไฟล์ส่งมอบที่รู้แค่ชื่อเก็บเป็น name_only ลูกค้าจึงเห็นชื่อแต่เปิดไม่ได้ (เหมือนของเดิม)
 */
export async function sbCreateRound(input: {
  token: string;
  pj: string;
  taskName: string;
  round: number;
  project: string;
  createdBy: string;
  message: string;
  contact: string;
  expiresAt: string;
  files: (NewReviewFile & { file?: File })[];
}): Promise<boolean> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return false;
  const proj = await sb.from("projects").select("id").eq("pj", input.pj).maybeSingle();
  const projectId = (proj.data as { id?: string } | null)?.id;
  if (!projectId) return false;

  const made = await sb
    .from("review_rounds")
    .insert({
      token: input.token,
      project_id: projectId,
      task_name: input.taskName,
      round: input.round,
      created_by: input.createdBy,
      expires_at: input.expiresAt,
      message: input.message,
      contact: input.contact,
      project: input.project,
    })
    .select("id")
    .single();
  if (made.error) return false;
  const roundId = (made.data as { id: string }).id;

  const rows: Record<string, unknown>[] = [];
  for (const [i, f] of input.files.entries()) {
    let url = f.url ?? null;
    let nameOnly = !url;
    if (f.file) {
      /* ที่อยู่ขึ้นต้นด้วยโทเคน — เดาไม่ได้เท่าตัวลิงก์เอง (ถังนี้เป็นถังสาธารณะ) */
      const safe = f.file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || `file-${i}`;
      const path = `${input.token}/${Date.now()}-${i}-${safe}`;
      const up = await sb.storage.from(BUCKET).upload(path, f.file, {
        contentType: f.file.type || "application/octet-stream",
        upsert: false,
      });
      if (!up.error) {
        url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        nameOnly = false;
      }
    }
    rows.push({
      round_id: roundId,
      name: f.name,
      kind: f.kind,
      size_text: f.size,
      url,
      poster: f.poster ?? null,
      duration: f.duration ?? null,
      name_only: nameOnly,
      idx: i,
    });
  }
  if (rows.length) await sb.from("review_files").insert(rows);
  return true;
}

export async function sbToggleCommentDone(id: string, done: boolean) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.from("review_comments").update({ done }).eq("id", id);
}

export async function sbStampRound(token: string, field: "forwarded_at" | "closed_at") {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  await sb.from("review_rounds").update({ [field]: new Date().toISOString() }).eq("token", token);
}

/* ─── ฝั่งลูกค้า (ไม่ต้องล็อกอิน) ─────────────────────────────────
   เรียกฟังก์ชันที่รับโทเคน — ใช้ไคลเอนต์เดียวกัน ไม่ต้องมี session */

export type OpenedRound = {
  round: ReviewRound;
  expired: boolean;
};

export async function sbOpenRound(token: string): Promise<OpenedRound | null> {
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.rpc("review_open", { p_token: token });
  if (got.error || !got.data) return null;
  const out = got.data as {
    ok?: boolean;
    round?: Record<string, unknown>;
    files?: Record<string, unknown>[];
    comments?: Record<string, unknown>[];
  };
  if (!out.ok || !out.round) return null;
  const r = out.round as {
    token: string;
    taskName: string;
    round: number;
    createdBy: string;
    createdAt: string;
    expiresAt: string;
    message: string;
    contact: string;
    project: string;
    status: string;
    submittedAt: string | null;
    expired: boolean;
  };
  const files = (out.files ?? []).map((raw) => {
    const f = raw as {
      id: string; name: string; kind: string; size: string; url: string | null;
      poster: string | null; duration: number | null; approved: boolean; nameOnly: boolean;
    };
    return {
      id: f.id,
      name: f.name,
      kind: kindOf(f.kind),
      size: f.size,
      url: f.url ?? undefined,
      poster: f.poster ?? undefined,
      duration: f.duration ?? undefined,
      approved: f.approved || undefined,
      local: f.nameOnly || undefined,
    } satisfies ReviewFile;
  });
  const comments = (out.comments ?? []).map((raw) => {
    const c = raw as {
      id: string; fileId: string; author: string; text: string; at: string;
      t: number | null; frame: string | null; pin: { x: number; y: number; n: number } | null;
      page: number | null; attach: { name: string; data?: string } | null; done: boolean;
    };
    return {
      id: c.id,
      fileId: c.fileId,
      author: c.author,
      text: c.text,
      at: stampOf(c.at),
      t: c.t ?? undefined,
      frame: c.frame ?? undefined,
      pin: c.pin ?? undefined,
      page: c.page ?? undefined,
      attach: c.attach ?? undefined,
      done: c.done || undefined,
    } satisfies ReviewComment;
  });

  return {
    expired: Boolean(r.expired),
    round: {
      token: r.token,
      pj: "",
      taskName: r.taskName,
      round: r.round,
      createdAt: stampOf(r.createdAt),
      createdBy: r.createdBy,
      expiresAt: r.expiresAt,
      message: r.message,
      contact: r.contact,
      project: r.project,
      files,
      status: r.status as ReviewStatus,
      submittedAt: r.submittedAt ? stampOf(r.submittedAt) : undefined,
      comments,
    },
  };
}

export async function sbAddComment(
  token: string,
  c: Omit<ReviewComment, "id" | "at">,
): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.rpc("review_comment_add", {
    p_token: token,
    p_file: c.fileId,
    p_author: c.author,
    p_text: c.text,
    p_t: c.t ?? null,
    p_frame: c.frame ?? null,
    p_pin: c.pin ?? null,
    p_page: c.page ?? null,
    p_attach: c.attach ?? null,
  });
  const out = got.data as { ok?: boolean; id?: string } | null;
  return out?.ok ? (out.id ?? null) : null;
}

export async function sbEditComment(token: string, id: string, text: string) {
  const sb = supabase();
  if (!sb) return;
  await sb.rpc("review_comment_edit", { p_token: token, p_id: id, p_text: text });
}

export async function sbDeleteComment(token: string, id: string) {
  const sb = supabase();
  if (!sb) return;
  await sb.rpc("review_comment_del", { p_token: token, p_id: id });
}

export async function sbApproveFile(token: string, fileId: string, approved: boolean) {
  const sb = supabase();
  if (!sb) return;
  await sb.rpc("review_file_approve", { p_token: token, p_file: fileId, p_ok: approved });
}

export async function sbSubmitRound(token: string, all: boolean) {
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.rpc("review_submit", { p_token: token, p_all: all });
  return (got.data as { ok?: boolean; status?: string } | null) ?? null;
}
