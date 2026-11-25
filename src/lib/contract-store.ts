"use client";

/*
 * ใบสัญญาที่ระบบออกให้ดีล (ยกมาจากสาย ERP_Test 14 ต.ค. 2569) — เก็บแยกจากสโตร์ CRM
 * ทุกฉบับเก็บไว้ ไม่มีการลบหรือแก้ทับ บันทึกใหม่ = ฉบับถัดไปของเลขที่สัญญาเดิม
 * สัญญาที่ฝ่ายขายเคยแนบเป็นไฟล์ (Deal.contracts) ไม่อยู่ในนี้ คนละเรื่องกัน
 *
 * ต่อฐานข้อมูลแล้ว (รอบที่ 107) อ่านเขียนที่ฐานข้อมูล เลขที่สัญญาออกจากฐานข้อมูล
 * ไม่ใช่จากเบราว์เซอร์ สองคนกดออกสัญญาพร้อมกันจะได้ไม่ได้เลขซ้ำกัน
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { contractPrefix, type ContractDoc } from "./contract-data";
import { bkkStamp } from "./format";
import type { IssuerCode } from "./crm-data";
import { hasBackend } from "./supabase/env";
import { fetchContracts, sbSaveContract } from "./supabase/contracts";

const store = createPersistedStore<ContractDoc[]>(
  "maz-erp.contracts.v1",
  [],
  (v): v is ContractDoc[] => Array.isArray(v),
);

const live = hasBackend;
let docs: ContractDoc[] | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

function load() {
  if (!live || loading || docs !== null) return;
  loading = true;
  void fetchContracts()
    .then((got) => {
      docs = got;
    })
    .catch(() => {
      docs = [];
    })
    .finally(() => {
      loading = false;
      tell();
    });
}

function refresh() {
  if (!live) return;
  docs = null;
  loading = false;
  load();
  tell();
}

const EMPTY: ContractDoc[] = [];

function snapshot(): ContractDoc[] {
  if (!live) return store.get();
  load();
  return docs ?? EMPTY;
}

function subscribeAll(onChange: () => void) {
  const off = store.subscribe(onChange);
  watchers.add(onChange);
  return () => {
    off();
    watchers.delete(onChange);
  };
}

export function useContracts() {
  return useSyncExternalStore(subscribeAll, snapshot, store.getServer);
}

/** ทุกฉบับของดีล เรียงฉบับแรกก่อน */
export function contractsOf(all: ContractDoc[], dealNo: string) {
  return all.filter((c) => c.dealNo === dealNo).sort((a, b) => a.version - b.version);
}

/**
 * บันทึกฉบับใหม่ — ดีลที่ยังไม่มีสัญญาได้เลขที่ใหม่ · มีแล้วใช้เลขเดิม ฉบับที่ +1
 * otherNos = เลขสัญญาที่มีอยู่นอกสโตร์นี้ (ไฟล์สัญญาที่เคยแนบ) กันเลขชน
 */
export async function saveContractVersion(
  input: { dealNo: string; issuer: IssuerCode; body: string; date: string; by: string; from: ContractDoc["from"] },
  otherNos: string[] = [],
): Promise<ContractDoc | null> {
  if (live) {
    const mine = contractsOf(snapshot(), input.dealNo);
    const last = mine[mine.length - 1];
    const got = await sbSaveContract({
      dealNo: input.dealNo,
      no: last?.no ?? "",
      prefix: contractPrefix(input.issuer),
      version: (last?.version ?? 0) + 1,
      issuer: last?.issuer ?? input.issuer,
      body: input.body,
      date: input.date,
      by: input.by,
      from: input.from,
    });
    refresh();
    return got.ok ? (got.doc ?? null) : null;
  }

  let saved!: ContractDoc;
  store.update((all) => {
    const mine = contractsOf(all, input.dealNo);
    const last = mine[mine.length - 1];
    const no = last?.no ?? nextLocalNo(input.issuer, [...all.map((c) => c.no), ...otherNos]);
    saved = {
      id: `CTD-${Date.now().toString(36)}`,
      dealNo: input.dealNo,
      no,
      version: (last?.version ?? 0) + 1,
      issuer: last?.issuer ?? input.issuer,
      body: input.body,
      date: input.date,
      at: bkkStamp(),
      by: input.by,
      from: input.from,
    };
    return [...all, saved];
  });
  return saved;
}

/** เลขที่สัญญาตอนยังไม่ได้ต่อฐานข้อมูล — นับจากเลขที่มีอยู่ในเครื่อง */
function nextLocalNo(issuer: IssuerCode, existing: string[]) {
  const head = `${contractPrefix(issuer)}-${new Date().getFullYear() + 543}-`;
  const max = existing
    .filter((n) => n.startsWith(head))
    .reduce((m, n) => Math.max(m, Number(n.slice(head.length)) || 0), 0);
  return head + String(max + 1).padStart(4, "0");
}
