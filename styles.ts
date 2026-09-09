// Scoped to this plugin. Colors follow the host's current BB palette.
export const INBOX_STYLES = `
.ny-panel, .ny-home, .ny-toast {
  color: var(--foreground);
  font-family: inherit;
  --ny-error: color-mix(in srgb, var(--destructive-text, var(--destructive)) 65%, var(--foreground));
  --ny-waiting: color-mix(in srgb, var(--warning-text, var(--primary)) 60%, var(--foreground));
  --ny-success: var(--success-foreground, var(--muted-foreground));
}
.ny-panel { height: 100%; min-height: 0; overflow-y: auto; container-type: inline-size; }
.ny-panel-inner { width: 100%; padding: 28px 24px 32px; }
.ny-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
.ny-header h2 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -.025em; line-height: 1.3; }
.ny-summary { margin: 7px 0 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.6; }
.ny-summary strong { font-weight: 550; color: var(--foreground); }
.ny-header-icon { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted-foreground); background: var(--muted); }
.ny-header-icon svg { width: 18px; height: 18px; }
.ny-group + .ny-group { margin-top: 23px; }
.ny-group-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 0 0 7px; padding-inline: 2px; color: var(--muted-foreground); }
.ny-group-heading h3 { margin: 0; font-size: 11px; font-weight: 550; }
.ny-count { font-size: 11px; font-variant-numeric: tabular-nums; }
.ny-rows { list-style: none; padding: 0; margin: 0 -10px; }
.ny-row { display: flex; align-items: center; gap: 8px; border-radius: 7px; min-width: 0; }
.ny-row:hover { background: var(--accent); }
.ny-open { display: flex; align-items: flex-start; gap: 12px; min-width: 0; flex: 1; text-align: start; padding: 13px 0 13px 10px; border: 0; background: transparent; border-radius: 7px; cursor: pointer; color: inherit; }
.ny-item-text { display: block; flex: 1; min-width: 0; }
.ny-item-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; font-weight: 550; }
.ny-item-reason { display: block; margin-top: 3px; color: var(--muted-foreground); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.ny-item-detail { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 12px; color: var(--muted-foreground); line-height: 1.6; margin-top: 5px; }
.ny-status-icon { display: grid; place-items: center; flex: none; width: 28px; height: 28px; margin-top: 1px; border-radius: 7px; }
.ny-status-icon svg { width: 16px; height: 16px; }
.ny-status-icon[data-kind="error"] { color: var(--ny-error); background: color-mix(in srgb, var(--ny-error) 9%, transparent); }
.ny-status-icon[data-kind="blocked"] { color: var(--ny-waiting); background: color-mix(in srgb, var(--ny-waiting) 9%, transparent); }
.ny-status-icon[data-kind="finished"] { color: var(--ny-success); background: color-mix(in srgb, var(--ny-success) 9%, transparent); }
.ny-row-end { display: flex; align-items: center; gap: 3px; flex: none; }
.ny-time { font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted-foreground); }
.ny-icon-button { display: inline-grid; place-items: center; flex: none; width: 36px; height: 44px; color: var(--muted-foreground); border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
.ny-icon-button svg { width: 15px; height: 15px; }
.ny-icon-button:hover:not(:disabled) { color: var(--foreground); background: var(--muted); }
.ny-icon-button:disabled { opacity: .6; cursor: wait; }
.ny-finished { margin-top: 22px; padding-top: 22px; border-top: 1px solid var(--border); }
.ny-finished-note { margin: 12px 2px 0; color: var(--muted-foreground); font-size: 11px; line-height: 1.6; }
.ny-empty { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 11px; padding: 44px 20px; text-align: center; }
.ny-empty-icon { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 4px; border: 1px solid var(--border); background: var(--muted); border-radius: 50%; color: var(--ny-success); }
.ny-empty-icon svg { width: 22px; height: 22px; }
.ny-empty h3 { margin: 0; font-size: 16px; font-weight: 550; letter-spacing: -.015em; }
.ny-empty p { margin: 0; max-width: 280px; font-size: 12px; line-height: 1.8; color: var(--muted-foreground); }
.ny-load-error { display: flex; align-items: flex-start; gap: 11px; border: 1px solid var(--border); border-radius: 8px; padding: 15px; margin-bottom: 22px; background: color-mix(in srgb, var(--ny-error) 5%, transparent); }
.ny-load-error > svg { width: 17px; height: 17px; margin-top: 2px; flex: none; color: var(--ny-error); }
.ny-load-error strong { font-size: 12px; font-weight: 550; }
.ny-load-error p { margin: 5px 0 9px; color: var(--muted-foreground); font-size: 12px; line-height: 1.7; }
.ny-retry { min-height: 34px; padding: 7px 11px; font-size: 11px; font-weight: 550; color: var(--foreground); background: var(--background); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.ny-retry:disabled { opacity: .6; cursor: wait; }
.ny-retry:hover:not(:disabled) { background: var(--muted); }
.ny-loading { padding-top: 6px; }
.ny-skeleton { height: 12px; width: 67%; margin: 12px 0; border-radius: 4px; background: var(--muted); animation: ny-pulse 1.7s ease-in-out infinite; }
.ny-skeleton-short { width: 44%; height: 9px; margin-bottom: 29px; }
.ny-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.ny-home { container-type: inline-size; min-width: 0; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--card, var(--background)); }
.ny-home-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.ny-home-header h3 { display: flex; gap: 8px; align-items: center; margin: 0; font-size: 14px; font-weight: 550; }
.ny-home-header h3 > svg { width: 16px; height: 16px; color: var(--muted-foreground); }
.ny-view-inbox { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; background: transparent; border: 0; color: var(--muted-foreground); font-size: 11px; cursor: pointer; }
.ny-view-inbox:hover { color: var(--foreground); }
.ny-view-inbox svg { width: 13px; height: 13px; }
.ny-home .ny-load-error { margin-bottom: 0; }
.ny-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 17px; padding: 1px 5px; border: 1px solid var(--border); border-radius: 5px; color: var(--foreground); background: var(--muted); font-size: 10px; font-weight: 550; font-variant-numeric: tabular-nums; }
.ny-panel :is(button, a):focus-visible, .ny-home :is(button, a):focus-visible, [data-sonner-toast].ny-toast :is(button, a):focus-visible { outline: 2px solid var(--ring, var(--foreground)); outline-offset: 2px; }
[data-sonner-toast].ny-toast[data-styled="true"] { display: flex; flex-direction: column; align-items: flex-start; gap: 0; padding: 16px; color: var(--foreground); background: var(--popover, var(--background)); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 28px color-mix(in srgb, var(--foreground) 8%, transparent); }
[data-sonner-toast].ny-toast .ny-toast-content { width: 100%; min-width: 0; }
.ny-toast-brand { display: flex; align-items: center; gap: 7px; padding-inline-end: 28px; color: var(--muted-foreground); font-size: 10px; font-weight: 400; line-height: 1.6; }
.ny-toast-brand svg { width: 13px; height: 13px; }
.ny-toast-time { margin-inline-start: auto; }
.ny-toast-kind { margin: 15px 0 5px; font-size: 11px; font-weight: 550; line-height: 1.5; overflow-wrap: anywhere; }
.ny-toast-kind[data-kind="error"] { color: var(--ny-error); }
.ny-toast-kind[data-kind="blocked"] { color: var(--ny-waiting); }
.ny-toast-kind[data-kind="finished"] { color: var(--ny-success); }
.ny-toast-thread { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; padding-inline-end: 8px; overflow-wrap: anywhere; font-size: 14px; font-weight: 550; line-height: 1.5; }
.ny-toast-detail { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; margin-top: 5px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted-foreground); font-size: 12px; font-weight: 400; line-height: 1.6; }
[data-sonner-toast].ny-toast [data-button].ny-toast-action { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; height: auto; margin: 12px 0 0; padding: 8px 10px; color: var(--foreground); background: var(--muted); border: 0; border-radius: 6px; font-size: 11px; font-weight: 550; }
[data-sonner-toast].ny-toast [data-button].ny-toast-action:hover { background: var(--accent); }
.ny-toast-action svg { width: 13px; height: 13px; }
[data-sonner-toast].ny-toast [data-close-button].ny-toast-close { inset: 3px 3px auto auto; transform: none; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 6px; color: var(--muted-foreground); background: transparent; }
[data-sonner-toast].ny-toast [data-close-button].ny-toast-close:hover { color: var(--foreground); background: var(--muted); }
[data-sonner-toast].ny-toast [data-close-button].ny-toast-close svg { width: 14px; height: 14px; }
.ny-spinner { display: inline-block; width: 14px; height: 14px; border: 1.5px solid currentColor; border-inline-end-color: transparent; border-radius: 50%; animation: ny-spin 900ms linear infinite; }

.ny-view-nav { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--border); border-radius: 8px; }
.ny-view-nav button { min-height: 36px; padding: 8px 12px; border: 0; border-radius: 5px; color: var(--muted-foreground); background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.ny-view-nav button[aria-pressed="true"] { background: var(--muted); color: var(--foreground); }
.ny-welcome { margin-bottom: 28px; padding: 20px; border: 1px solid var(--border); border-radius: 10px; background: var(--card, var(--background)); }
.ny-welcome h3, .ny-settings h3 { margin: 0 0 8px; font-size: 17px; font-weight: 550; }
.ny-welcome p, .ny-settings p, .ny-token-form li { font-size: 12px; line-height: 1.75; color: var(--muted-foreground); margin: 6px 0 12px; max-width: 70ch; }
.ny-settings-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 6px 0 26px; }
.ny-settings-top h3 { margin: 0; }
.ny-settings h4 { font-size: 14px; font-weight: 600; margin: 0 0 18px; }
.ny-settings-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; }
.ny-settings-columns > section { min-width: 0; }
.ny-settings-fields { padding: 0; margin: 0; border: 0; min-width: 0; }
.ny-setting-toggle { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; cursor: pointer; min-height: 44px; }
.ny-setting-toggle input { width: 16px; height: 16px; margin-top: 3px; flex: none; accent-color: var(--primary); }
.ny-setting-toggle strong { font-size: 12px; font-weight: 550; }
.ny-setting-toggle small { display: block; margin-top: 3px; font-size: 11px; line-height: 1.6; color: var(--muted-foreground); }
.ny-settings-field, .ny-settings-times label { display: flex; flex-direction: column; gap: 7px; font-size: 12px; line-height: 1.6; }
.ny-settings input:not([type="checkbox"]) { min-width: 0; width: 100%; min-height: 42px; padding: 9px 11px; color: var(--foreground); background: var(--background); border: 1px solid var(--border); border-radius: 6px; font: inherit; }
.ny-settings input:focus-visible { outline: 2px solid var(--ring, var(--foreground)); outline-offset: 2px; }
.ny-settings-times { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin: 20px 0 8px; }
.ny-settings-field input[type="number"] { max-width: 160px; }
.ny-settings-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
.ny-primary, .ny-secondary { display: inline-flex; justify-content: center; align-items: center; min-height: 42px; padding: 9px 13px; border: 1px solid var(--border); border-radius: 6px; font: inherit; font-size: 12px; font-weight: 550; line-height: 1.6; cursor: pointer; text-decoration: none; }
.ny-primary { background: var(--foreground); color: var(--background); }
.ny-secondary { color: var(--foreground); background: var(--background); }
.ny-primary:hover:not(:disabled) { opacity: .9; }
.ny-secondary:hover:not(:disabled) { background: var(--muted); }
.ny-primary:disabled, .ny-secondary:disabled { opacity: .55; cursor: default; }
.ny-settings a:not(.ny-primary) { color: var(--foreground); text-decoration: underline; text-underline-offset: 3px; }
.ny-token-form { margin-top: 18px; }
.ny-token-form ol { padding-left: 20px; }
.ny-token-form li { margin-bottom: 5px; }
.ny-connection, .ny-pairing { margin: 16px 0; padding: 16px; border: 1px solid var(--border); border-radius: 8px; overflow-wrap: anywhere; }
.ny-connection > strong, .ny-pairing > strong { font-size: 13px; font-weight: 550; }
.ny-pairing-user { display: inline-block; margin-left: 6px; }
.ny-cancel-pairing { margin-top: 12px; }
.ny-disconnect { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 16px; }
.ny-settings .ny-telegram-help { margin-top: 22px; }
.ny-settings-feedback { padding: 12px 14px; margin: 0 0 20px !important; border: 1px solid var(--border); border-radius: 7px; font-size: 12px; line-height: 1.7; }
.ny-settings-feedback[role="alert"] { color: var(--ny-error); }
.ny-updates { margin-top: 34px; padding-top: 24px; border-top: 1px solid var(--border); }
.ny-updates h4 { margin-bottom: 8px; }
.ny-updates a { font-size: 12px; padding: 10px; }
.ny-update-notice { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 12px 14px; margin-bottom: 20px; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; background: var(--muted); }
.ny-update-notice button, .ny-setup-error button { border: 0; background: transparent; color: inherit; text-decoration: underline; text-underline-offset: 3px; padding: 8px; cursor: pointer; }
.ny-setup-error { font-size: 12px; color: var(--muted-foreground); }
@container (max-width: 720px) { .ny-settings-columns { grid-template-columns: minmax(0, 1fr); gap: 32px; } }
@container (max-width: 430px) { .ny-header { flex-wrap: wrap; } .ny-welcome { padding: 16px; } }
@keyframes ny-spin { to { transform: rotate(360deg); } }
@keyframes ny-pulse { 50% { opacity: .45; } }
@container (max-width: 430px) {
  .ny-panel-inner { padding: 24px 18px; }
  .ny-row { gap: 3px; }
  .ny-open { gap: 9px; }
  .ny-row-end { gap: 0; }
}
@container (max-width: 310px) {
  .ny-panel-inner { padding-inline: 14px; }
  .ny-time { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ny-panel *, .ny-home * { animation: none !important; transition: none !important; }
  [data-sonner-toast].ny-toast { transition-duration: 0ms !important; }
}
`;
