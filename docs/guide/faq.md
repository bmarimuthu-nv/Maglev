# FAQ

## General

### What is Maglev?

Maglev is a local-first platform for running shell sessions on your machine and controlling them remotely through the web app, PWA, or Telegram Mini App.

### What does Maglev stand for?

Maglev (哈皮) is a Chinese transliteration of "Happy".

### Is Maglev free?

Yes. Maglev is open source under the AGPL-3.0-only license.

## Setup

### Do I need a hub?

Yes. Run `maglev hub` locally or `maglev hub --remote` if you want remote access.

### How do I access Maglev from my phone?

For local network access:

```text
http://<your-computer-ip>:3006
```

For remote access, use:

```bash
maglev server
maglev auth github login
maglev hub --remote
```

### What is the access token for?

`MAGLEV_API_TOKEN` authenticates CLI-to-hub access. In local browser flows it can also be used for manual sign-in. In broker-based remote mode, browser access goes through broker/GitHub auth instead.

### Can I use Maglev without Telegram?

Yes. Telegram is optional.

## Usage

### How do I approve permissions remotely?

Open the active session in the web app or Telegram Mini App and approve or deny the pending request.

### Can I start sessions remotely?

Yes. Start the runner:

```bash
maglev runner start
```

Then use the machine list in the web app to spawn a new shell.

### How do I see changed files?

Open the session and use the Files and Review views.

### Can I access a terminal remotely?

Yes. Every session is a shell session, and the web app can attach to it remotely.

## Security

### Is my data safe?

Maglev is local-first:

- data stays on your machine
- the database lives under `~/.maglev/`
- you control how remote access is exposed

### Can others access my Maglev instance?

Only if they can satisfy your configured browser auth path. For public access, use HTTPS and prefer the broker-based remote flow.

## Troubleshooting

### Connection refused

- ensure the hub is running: `maglev hub`
- verify port `3006`
- verify `MAGLEV_API_URL`

### My phone cannot connect on the LAN

Set the bind host to `0.0.0.0` and restart the hub:

```json
{
  "listenHost": "0.0.0.0"
}
```

or

```bash
export MAGLEV_LISTEN_HOST=0.0.0.0
```

### Invalid token

- run `maglev auth login`
- verify `~/.maglev/settings.json`

### Runner will not start

```bash
maglev runner status
rm ~/.maglev/runner.state.json.lock
maglev runner logs
```

### How do I run diagnostics?

```bash
maglev doctor
```

## Comparison

### Maglev vs Happy

| Aspect | Happy | Maglev |
|--------|-------|------|
| Design | Cloud-first | Local-first |
| Data | Encrypted on server | Stored on your machine |
| Deployment | Multiple services | Single-user self-hosted hub |

See [Why Maglev](./why-maglev.md) for the detailed comparison.
