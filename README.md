# Needs You for BB

One inbox for questions, failed runs, and finished threads. Open the right
conversation, keep finished work until you dismiss it, and receive one popup
per thread. Popups stay quiet while you are reading that thread.

**Public beta · 0.2.0-beta.1.** Requires BB 0.41+ and Node 24+ on its host.
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

Review BB's installation prompt, then open **Needs You** in the sidebar.
The release includes its built files; you do not need npm to install it.

Questions and failed runs notify by default. To also receive completion alerts:

```sh
bb plugin config inbox set notifyFinished true
```

The internal plugin ID is `inbox`. Closing a popup leaves the inbox entry in
place; dismissing an inbox entry hides it until that thread has a new update.

## Optional Telegram notifications

Each person uses their own bot and their own BB installation. Guided pairing
is not included in this beta; configuration is manual.

1. Open [@BotFather](https://t.me/BotFather) in Telegram and use `/newbot`.
   Choose a bot name and username; BotFather gives you its token.
2. In BB, open **Settings → Plugins → Needs You** and enter the token in
   **Telegram bot token**, then click **Save settings**. Keep the token private;
   do not post it in a chat or issue.
3. Open your new bot in Telegram and press **Start** (or send it a message).
4. Run `bb inbox chats` on the BB machine. Find your private chat and enter
   its ID in **Telegram chat id** in the same settings, then click **Save settings**.
   Use a dedicated bot that is not connected to another application.
5. Keep Telegram notifications enabled and run:

   ```sh
   bb inbox test --telegram
   ```

Confirm the test arrives on your phone. To open BB links from a phone, enable
BB Connect on your BB installation. A localhost link only works on its host.
Telegram replies, remote approvals, and Telegram task commands are unavailable
in this beta; respond to requests inside BB.

To disconnect Telegram, unset `telegramBotToken` and `telegramChatId` in BB's
plugin settings. The inbox and in-app alerts keep working.

## Beta limits

- The inbox works at desktop and compact widths. Bottom popups currently mount
  with BB's desktop sidebar accessory; use the inbox itself on compact clients.
- Native desktop notifications require macOS on the BB server host. They are
  not browser push notifications on a remotely connected laptop.
- Quiet hours use the BB server's timezone and are checked on thread changes.
  Finished notifications have a 45-second cooldown; delivery is best effort.
- Telegram receives thread titles and the displayed request context. The bot
  token stays in BB's server-side secret settings. Dismissal and notification
  history stay in the local BB installation. No author-operated relay is used.
- Optional task CLI commands require Atlas; the inbox does not.

## Update or remove

The marketplace tracks compatible release tags in `^0.2.0-beta.1`. Run
`bb marketplace refresh notpritam` to discover new listings; refresh does not
install or update code. Run `bb plugin update inbox` when you want to update.

For a direct install pinned to this exact beta:

```sh
bb plugin install git:https://github.com/notpritam/bb-plugin-inbox.git@v0.2.0-beta.1
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

Commit matching `dist/` files for Git installation. See [CHANGELOG.md](CHANGELOG.md)
for release changes. [Report a problem](https://github.com/notpritam/bb-plugin-inbox/issues)
without including tokens or private thread content.

Attention detection draws on `bb-plugin-attention`; notification deduplication
and BB Connect links draw on `bb-plugin-ntfy`, both by Shane Logsdon (MIT).
