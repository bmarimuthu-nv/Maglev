# Why maglev?

[Happy](https://github.com/slopus/happy) is an excellent project. Maglev takes a different path.

The short version: Happy is built around a centralized service. Maglev is built around your own machine and your own infrastructure.

## TL;DR

| Aspect | Happy | Maglev |
|--------|-------|--------|
| **Architecture** | Centralized cloud service | Local-first, self-hosted |
| **Data location** | Stored on the service, encrypted | Stored on your machine |
| **Remote access** | Through the hosted service | Through your hub directly, or through your self-hosted broker |
| **Deployment** | Multi-service stack | Single workspace / self-hosted components |
| **Main complexity** | E2EE, key handling, service ops | Running your own hub and optional broker |

Choose Maglev if you want local ownership, self-hosting, and a simple mental model.

## Happy: Centralized

Happy solves the "my server is not trusted" problem by designing around a shared hosted backend.

That implies:

- the service stores encrypted user data
- clients handle more encryption and key-management work
- the backend has to support many users on shared infrastructure

This is a strong fit for a managed cloud product.

## Maglev: Local-First

Maglev takes the opposite approach:

- your hub runs on your machine
- your session state and database stay on your machine
- the web app talks to your hub, not to a shared Maglev service

For remote access, Maglev supports two practical shapes:

1. Direct self-hosting
   - expose the hub yourself with HTTPS, a reverse proxy, Tailscale, Cloudflare Tunnel, or similar
2. Broker-based remote access
   - run `maglev server` on a stable machine you control
   - run `maglev hub --remote` on the machine that hosts the sessions
   - the hub opens an outbound broker connection
   - the broker routes browser HTTP, SSE, and WebSocket traffic back to that hub

The key point is that the broker is also yours. There is no managed Maglev relay service in the architecture.

## Maglev Remote Architecture

```text
┌──────────────┐    HTTPS / WS     ┌────────────────┐    persistent WS    ┌──────────────┐
│ Browser/PWA  │ ◄────────────────►│ Self-hosted    │◄───────────────────►│ Hub          │
│ or Phone     │                   │ Broker         │                     │ + Sessions   │
└──────────────┘                   └────────────────┘                     └──────────────┘
                                                                                 │
                                                                                 ▼
                                                                        local SQLite + files
```

What the broker does:

- gives you a stable public URL
- keeps track of live hubs
- forwards browser traffic to the right hub

What the broker does not do:

- store your session data
- own your long-term application state
- replace the hub as the source of truth

## Security Model

Maglev does not try to solve the same problem Happy does.

Happy assumes the service itself is untrusted for plaintext data, so it needs application-layer E2EE.

Maglev assumes you control the infrastructure:

- local-only mode: browser talks to your hub directly
- self-hosted public mode: you secure the hub with your own HTTPS/reverse proxy setup
- broker mode: you secure the browser-to-broker path, and the broker forwards traffic to your hub over the hub's outbound session

For internet-facing broker mode, browser sign-in is handled through GitHub-backed broker auth, then the hub issues its own JWT for app access.

## Why The Architectures Diverge

Happy is optimizing for a shared hosted service.

Maglev is optimizing for:

- data staying on the machine that runs the sessions
- simple deployment on personal or team-owned infrastructure
- remote access without depending on a Maglev-operated cloud

That leads to different tradeoffs:

| Dimension | Happy | Maglev |
|-----------|-------|--------|
| **Server role** | Primary shared backend | Your own hub and optional broker |
| **State storage** | Hosted service | Local hub |
| **Scaling model** | Shared multi-tenant infra | Per-user or per-team self-hosting |
| **Trust boundary** | Hosted backend must not see plaintext | You control the machines and network path |

## Conclusion

Happy is a cloud-style architecture with strong protections against an untrusted hosted backend.

Maglev is a local-first architecture that avoids that hosted-backend problem entirely by keeping the hub and state under your control. Remote access still exists, but it is built around infrastructure you run yourself.
