/* Shared app state and derived selectors. Pure data — no DOM. */
import { USE_CASES } from './data/use-cases.js';

export const state = {
  selectedId: null,
  category: "all",
  query: "",
  /** Per-use-case live overrides for tunable scene params. Shape:
      { [useCaseId]: { [paramKey]: value } } */
  sceneParams: {},
};

/** Resolve a single tunable param for a use case — user override first,
    falling back to the default declared in USE_CASES[].params.
    Empty strings count as "unset" so a cleared text input falls back to
    the default; `false` / `0` are legitimate overrides and pass through. */
export function paramFor(uc, key) {
  const live = state.sceneParams[uc.id]?.[key];
  if (live !== undefined && live !== '') return live;
  return uc.params?.find(p => p.key === key)?.default;
}

/** Find the param schema entry for a key on a use case. */
export function paramSpec(uc, key) {
  return uc.params?.find(p => p.key === key);
}

export function filteredCases() {
  const q = state.query.trim().toLowerCase();
  return USE_CASES
    .filter(uc => {
      if (state.category !== "all" && uc.category !== state.category) return false;
      if (q) {
        const hay = [uc.title, uc.category, uc.description, ...uc.tags, ...uc.tools.map(t => t.name)].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    // Alphabetical by title — predictable scanning regardless of category.
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getSelected() {
  return USE_CASES.find(u => u.id === state.selectedId);
}
