# Quick Start

<Steps>

## Install Maglev

```bash
git lfs install
git clone https://github.com/bmarimuthu-nv/Maglev.git maglev
cd maglev
git lfs pull
./install.sh
```

Other install options: [Installation](./installation.md)

## Start the hub

```bash
maglev auth github login
maglev hub --remote
```

The terminal prints a URL and QR code for remote access.

## Start a shell session

```bash
maglev shell
```

The session appears in the web UI and can be reopened from another device.

## Open the UI

Open the printed URL on your browser or phone, then sign in with GitHub.

</Steps>

## Next steps

- [How it Works](./how-it-works.md)
- [Installation](./installation.md)
- [Install the App](./pwa.md)
