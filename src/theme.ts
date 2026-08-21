// Blueprint is the light theme, Void the dark: one design system, two token
// sets. Defaults to the OS preference, and remembers an explicit override.
const KEY = "bgsvg-studio-theme";

type Theme = "light" | "dark";

function preferred(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(t: Theme, button: HTMLButtonElement): void {
  document.documentElement.dataset.theme = t;
  button.textContent = t === "dark" ? "Void" : "Blueprint";
  button.setAttribute("aria-label", `Theme: ${t === "dark" ? "Void" : "Blueprint"}. Switch.`);
}

export function initTheme(button: HTMLButtonElement): void {
  let current = preferred();
  apply(current, button);
  button.addEventListener("click", () => {
    current = current === "dark" ? "light" : "dark";
    localStorage.setItem(KEY, current);
    apply(current, button);
  });
}
