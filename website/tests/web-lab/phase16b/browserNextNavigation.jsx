// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
import { useMemo } from "react";

export function useParams() {
  return { id: window.__phase16bLab.id };
}

export function useSearchParams() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

export function usePathname() {
  return window.location.pathname;
}

export function useRouter() {
  return { push: value => { window.location.href = value; }, replace: value => { window.location.replace(value); }, refresh: () => window.location.reload() };
}
