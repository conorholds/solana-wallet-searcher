/* Apply before styles load so a saved appearance does not flash the other theme. */
(() => {
  const storageKey = "solanaWalletSearcherTheme";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const normalize = value => ["light", "dark", "system"].includes(value) ? value : "system";
  let preference = "system";
  try { preference = normalize(localStorage.getItem(storageKey)); } catch { /* Appearance still works without storage. */ }

  function apply() {
    document.documentElement.dataset.theme = preference === "system" ? (system.matches ? "dark" : "light") : preference;
    document.querySelectorAll('input[name="appearance"]').forEach(input => { input.checked = input.value === preference; });
  }
  apply();
  system.addEventListener("change", () => { if (preference === "system") apply(); });
  window.addEventListener("storage", event => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = normalize(event.newValue);
    apply();
  });
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.getElementById("appearance-control").addEventListener("change", event => {
      if (event.target.name !== "appearance") return;
      preference = normalize(event.target.value);
      apply();
      try { localStorage.setItem(storageKey, preference); } catch { /* Keep the selection for this visit. */ }
    });
  });
})();
