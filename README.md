# Needs You for BB

One inbox for questions, failed runs, finished threads, and extension activity. Open the right
conversation, keep finished work until you dismiss it, and receive one popup
per thread. Popups stay quiet while you are reading that thread.

**Version 0.2.0.** Requires BB 0.41+ and Node 24+ on its host.
The inbox needs no separate account, token, or other plugin.

## Install

Add the marketplace once in a terminal on the machine running BB:

```sh
bb marketplace add git:github.com/notpritam/bb-marketplace@main
```

Open **Extensions**, search **Needs You**, and choose **Install**. Or run:

```sh
bb plugin install inbox@notpritam
```

You can use this marketplace now. The BB Community listing is submitted separately and appears after maintainer approval.

Review BB's installation prompt, then open **Needs You** in the sidebar.
The release includes its built files; you do not need npm to install it.

On first open, choose **Set up Telegram** or **Use inbox**. Setup is optional;
your threads remain available. Open the plugin's **Settings** tab any time to
change notifications, quiet hours, Telegram, or updates. Enable **Completed
turns** and save if you want completion alerts; questions and failures are on
by default.

The internal plugin ID is `inbox`. Closing a popup leaves the inbox entry in
place; dismissing an inbox entry hides it until that thread or activity has a new update.

## Extension activity

Guided Review 0.2.1+ sends an alert when a guide is ready or generation fails.
Choose **Open review** to return directly to the guide. Repeated deliveries and
regenerated guides share one inbox entry; completed work stays until dismissed.

**Settings → Extension activity** is enabled by default and is separate from
completed-thread alerts. Quiet hours and channel preferences still apply.
Telegram is optional. Other extensions can use the same
[activity API](docs/extension-activity.md).

## Optional Telegram notifications

Each person uses their own bot and their own BB installation.

1. Open **Needs You → Settings**. Create a dedicated bot with
   [@BotFather](https://t.me/BotFather) using `/newbot` and copy its token.
2. Paste the token into **Telegram bot token** and choose **Connect bot**.
   The token is masked, validated, and never returned from the server.
3. Choose **Open bot in Telegram**, press **Start**, then return and choose
   **I pressed Start**. The pairing link expires after 10 minutes.
4. Check the displayed private chat and choose **Confirm this chat**.
5. Choose **Send test notification** and confirm it arrives on your phone.
   Finish setup when ready.

No chat-ID lookup command is needed. Use **Change bot** or **Disconnect** in
Settings to manage the connection. Pairing and update checks send no messages;
a test is sent only when you request it. Partial connection saves pause Telegram
alerts until you reconnect successfully.

Enable BB Connect for links that open from a phone. A localhost link only works
on its host. Telegram replies, remote approvals, and task commands are unavailable; respond to requests inside BB.

## Scope and privacy

- The inbox works at desktop and compact widths. Bottom popups currently mount
  with BB's desktop sidebar accessory; use the inbox itself on compact clients.
- Native desktop notifications require macOS on the BB server host. They are
  not browser push notifications on a remotely connected laptop.
- Quiet hours use the BB server's timezone and are checked on thread changes.
  Finished notifications default to a 45-second cooldown, adjustable in Settings; delivery is best effort.
- Telegram receives thread titles and the displayed request context. The bot
  token stays in BB's server-side secret settings. Dismissal and notification
  history stay in the local BB installation. No author-operated relay is used.
- Optional task CLI commands require Atlas; the inbox does not.

## Update or remove

The marketplace tracks compatible release tags in `^0.2.0`. Run
`bb marketplace refresh notpritam` to discover new listings; refresh does not
install or update code. Needs You checks for updates when opened (cached for
15 minutes). **Settings → Version & updates → Check for updates** forces a
check. **Update now** asks BB to install the latest compatible release and
preserves your preferences and Telegram connection. Finish or cancel pairing
first. Pinned/local installs and incompatible or unavailable releases show
specific guidance. Checks never auto-install; **Release notes** opens GitHub.
You can also run `bb plugin update inbox`.

For a direct install that follows compatible 0.2.x releases:

```sh
bb plugin install 'git:https://github.com/notpritam/bb-plugin-inbox.git@^0.2.0'
```

Published tags will not be moved. To remove Needs You:

```sh
bb plugin remove inbox
```

BB deletes this plugin's saved settings and credentials when it is removed.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Run `NY_TEST_BB_URL=http://127.0.0.1:4343 npm run test:browser` only against a fresh, isolated BB profile with this plugin installed. It checks onboarding, settings, and demo activity without real Telegram credentials; it changes test-profile preferences and captures screenshots.

Commit matching `dist/` files for Git installation. See [CHANGELOG.md](CHANGELOG.md)
for release changes. [Report a problem](https://github.com/notpritam/bb-plugin-inbox/issues)
without including tokens or private thread content.

Attention detection draws on `bb-plugin-attention`; notification deduplication
and BB Connect links draw on `bb-plugin-ntfy`, both by Shane Logsdon (MIT).
