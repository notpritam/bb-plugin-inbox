# Changelog

## 0.2.0-beta.3 — 2026-09-09

- Durable extension activity API, with one inbox item per review or job and deduplication across retries, dismissal, and reloads.
- Guided Review completion/failure popups open the review directly and stay quiet when that review is already open.
- Separate Extension activity setting; quiet hours and desktop/Telegram preferences apply.
- Settings deep link and a close-button race fix for rapidly replaced notifications.
- Developer integration guide for other BB extensions.

## 0.2.0-beta.2 — 2026-09-09

- Optional first-run welcome with a persistent skip choice and an in-plugin Settings tab.
- Guided Telegram setup: validate your own dedicated bot, pair a private chat, confirm identity, explicitly test, change or disconnect.
- Notification preferences, quiet hours, completion cooldown and popup preview inside Needs You.
- Update notices, manual checks and explicit installation through BB’s native updater; existing settings are retained.
- Connection writes fail closed; disconnect drains in-flight sends and prevents later delivery. Pairing and updates cannot overlap.
- Safe Telegram errors and no token readback. Remote replies and approvals remain disabled.

## 0.2.0-beta.1 — 2026-09-09

- First packaged public beta with a credential-free BB inbox.
- Approved calm UI, full available width, and visible finished-thread history.
- One active popup per thread; later updates replace it, and old events do not
  overwrite newer ones. Active-thread suppression and accessible dismissal.
- Telegram notification setup is manual. Phone replies, remote approvals and
  Telegram task commands are withheld while their request binding is hardened.
- Added installation, configuration, privacy and platform-limit documentation.

This is an early release. Guided pairing and compact-client popup delivery
remain planned; the working inbox is available on compact clients.
