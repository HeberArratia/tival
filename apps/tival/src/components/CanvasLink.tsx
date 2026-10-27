"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore, type ComponentProps } from "react";

/**
 * Recuerda la última vista (filtros + view) de un canvas por pestaña, para que
 * los links de navegación vuelvan a ese contexto en vez de la vista limpia.
 */

const STORAGE_PREFIX = "tival:canvas:";
const CHANGE_EVENT = "tival:canvas-href";

function pathOf(href: string): string {
  const cut = href.search(/[?#]/);
  return cut === -1 ? href : href.slice(0, cut);
}

function readRemembered(path: string): string | null {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_PREFIX + path);
    return stored && pathOf(stored) === path ? stored : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Montar en el canvas con la URL canónica (solo params válidos) de la vista actual. */
export function RememberCanvasHref({ href }: { href: string }) {
  useEffect(() => {
    const path = pathOf(href);
    try {
      if (href === path) {
        window.sessionStorage.removeItem(STORAGE_PREFIX + path);
      } else {
        window.sessionStorage.setItem(STORAGE_PREFIX + path, href);
      }
    } catch {
      return;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [href]);
  return null;
}

/** `Link` que, si apunta a un canvas sin query, usa la última vista recordada. */
export function CanvasLink({
  href,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const remembered = useSyncExternalStore(
    subscribe,
    () => (href === pathOf(href) ? readRemembered(href) : null),
    () => null
  );
  return <Link href={remembered ?? href} {...props} />;
}
