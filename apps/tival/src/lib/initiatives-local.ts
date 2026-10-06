"use client";

import type { FakeInitiative } from "@/lib/fake-data";

const KEY = "tival.initiatives.user";

export function loadUserInitiatives(): FakeInitiative[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FakeInitiative[];
  } catch {
    return [];
  }
}

export function saveUserInitiative(ini: FakeInitiative) {
  const all = loadUserInitiatives().filter((x) => x.id !== ini.id);
  all.unshift(ini);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function findUserInitiative(slug: string) {
  return loadUserInitiatives().find((i) => i.slug === slug) ?? null;
}

export function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
