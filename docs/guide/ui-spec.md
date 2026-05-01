# UI Spec

Product UI spec for aligning the public website and authenticated hub app under one Maglev visual system.

Focus:

- fix brand discontinuity between `website/` and `web/`
- redesign login so it feels like product entry, not server plumbing
- keep code-heavy views calm and functional

## Goals

1. Public landing and authenticated app should feel like the same product.
2. Login should establish trust, orientation, and a clear primary action within 3 seconds.
3. Brand should live in framing surfaces and calls to action, not overwhelm terminal and code views.
4. The hub should feel premium and intentional, not generic Telegram chrome.

## Product Tone

Desired feel:

- local-first
- capable
- calm
- tactile
- quietly distinctive

Avoid:

- generic dashboard grayness
- playful marketing jokes inside critical product flows
- loud gradients behind code and terminal surfaces
- infra-first language as primary UI copy

## Surface Strategy

Maglev has two UI modes:

1. **Expressive brand mode**
   Used by:
   - public landing page
   - marketing screenshots
   - hero sections
   - empty states
   - auth surfaces

2. **Operational product mode**
   Used by:
   - hub shell
   - session list
   - terminal
   - files
   - review
   - settings

Rule:

- `website/` can be more expressive than `web/`
- `web/` must still inherit the same type, color, shape, and accent system

## Shared Brand Foundation

Current source of strongest identity:

- [website/src/index.css](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/website/src/index.css:46)

Current product shell tokens to replace/refine:

- [web/src/index.css](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/web/src/index.css:4)

### Typography

Primary recommendation:

- `Nunito` for UI text
- `Space Mono` for code, paths, server identity, command snippets

Usage rules:

- page titles: `Nunito`, 700-800
- section labels: `Nunito`, 600
- body: `Nunito`, 400-600
- code/host/path/token snippets: `Space Mono`

App-wide hierarchy:

- Display 1: `48/52`, weight `800`
- Display 2: `36/42`, weight `800`
- Title 1: `28/34`, weight `700`
- Title 2: `22/28`, weight `700`
- Body 1: `16/24`, weight `500`
- Body 2: `14/20`, weight `500`
- Meta: `12/16`, weight `600`
- Label: `11/14`, weight `700`, uppercase only when needed

### Shape Language

Shared shape rules:

- primary cards: `20px` radius
- secondary cards / panels: `16px`
- inputs / pills / segmented controls: `999px` or `12px`, not mixed randomly
- borders visible but soft
- shadows reserved for elevated surfaces, not every card

Product shell should feel:

- layered
- touch-friendly
- slightly tactile

Not:

- flat enterprise table UI
- heavy neo-brutalist everywhere

### Color Tokens

Introduce shared semantic tokens used by both `website` and `web`.

Core tokens:

```txt
--mg-bg
--mg-surface
--mg-surface-raised
--mg-surface-muted
--mg-text
--mg-text-muted
--mg-text-soft
--mg-border
--mg-border-strong
--mg-accent
--mg-accent-hover
--mg-accent-contrast
--mg-success
--mg-warning
--mg-danger
--mg-focus
```

Light direction:

- background: warm off-white
- surface: clean white
- raised surface: slightly warmer than white
- text: soft charcoal
- accent: restrained coral from `website`
- secondary accent: mint only for supportive highlights, not primary CTA

Dark direction:

- background: deep ink, not pure black
- surface: blue-charcoal
- text: warm near-white
- accent: slightly softened bright coral or electric green, but only one dominant accent per theme

Token behavior:

- accent used for primary actions, selection, focus, key badges
- success/warning/danger remain semantic, not brand-defining
- terminal/code surfaces stay neutral

### Theme Ownership

Telegram theme values can tint the app, but they should not define Maglev.

Rule:

- Telegram colors are inputs
- Maglev tokens are the system of record

Implementation direction:

- map Telegram theme values into Maglev semantic tokens where useful
- keep Maglev fallback palette stable and recognizable when Telegram values are absent or low quality

## Hub Shell Spec

Current shell:

- [web/src/router.tsx](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/web/src/router.tsx:281)

### Shell Principles

- top-level shell should feel branded but restrained
- navigation should be obvious without opening a mystery menu
- session list should feel like the product home

### Shell Visual Rules

- app background uses `--mg-bg`
- sidebars and top bars use `--mg-surface`
- selected rows and active pills use low-intensity accent fill
- primary CTA uses solid accent
- chrome icons use muted text by default, full text on hover/active

### Shell Layout Rules

- hub label should sit inside a branded identity row with mark + name + environment label
- new session is primary action, not just a small icon
- settings remains secondary
- mobile top bar should expose product identity and one primary action

## Login Spec

Current screen:

- [web/src/components/LoginPrompt.tsx](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/web/src/components/LoginPrompt.tsx:249)

### Login Objectives

The login screen must answer three questions immediately:

1. What product is this?
2. What am I signing into?
3. What is the easiest correct action?

### Login Information Hierarchy

Top to bottom:

1. Brand block
2. Primary sign-in action
3. Secondary auth option
4. Hub identity
5. Help and recovery

### Login Layout

Desktop:

- centered auth card, `440px` to `520px` wide
- optional ambient background treatment using subtle gradient/noise
- clear whitespace above and below the main action

Mobile:

- full-height vertical stack
- auth card can become a padded sheet without feeling modal
- keep all critical actions above the fold on modern phones

### Login Anatomy

#### 1. Brand Block

Contents:

- Maglev mark
- title: `Continue to Maglev`
- subtitle: `Access your local-first coding hub`

Visual:

- no Host/Port table in the hero area
- logo and title aligned to a warm, premium product tone

#### 2. Primary Sign-In

When GitHub device auth is available:

- primary button: `Continue with GitHub`
- full width
- dominant accent style

Supporting copy:

- `Recommended for remote hubs`

When access token is the main route:

- primary title still brand-first
- token input placed directly under subtitle
- submit button remains dominant

#### 3. Secondary Auth

Manual token auth should be secondary when GitHub auth exists.

Use:

- expandable row: `Use access token instead`

Expanded state contains:

- token input
- small explanation
- submit button

Do not present:

- two equal primary buttons competing at first glance

#### 4. Hub Identity

Replace the current Host/Port card with a compact identity chip:

- label: `Connected to`
- value: hostname
- optional mode badge: `Local`, `Remote`, `Custom`
- action: `Change`

If user opens change dialog:

- dialog title: `Change hub`
- single URL field
- helper copy beneath input
- destructive-ish secondary action only if custom URL already exists

#### 5. Help / Recovery

Bottom area should contain:

- docs/help link
- trust message
- precise error messages tied to auth method

Trust copy examples:

- `Your sessions stay on your machines`
- `Maglev connects you to your own hub`

Avoid:

- decorative footer copy as the main bottom content
- heart/cute flourish in the login flow

### Login States

#### Default

- strongest emphasis on primary auth action
- server identity visible but quiet

#### Loading

- spinner inside active button
- title and surrounding layout remain stable
- avoid replacing whole screen with generic loading if possible

#### Error

- inline error below the specific auth control
- use plain language
- add recovery path when known

Examples:

- `This token was rejected by the hub. Check that you copied the full value.`
- `GitHub sign-in expired. Start again.`
- `This hub only allows browser sign-in through GitHub.`

#### Binding Mode

If Telegram bind flow is active:

- reuse same card structure
- change title to `Bind Telegram to Maglev`
- explain why binding is needed
- keep brand consistent with standard login

## Login Wireframe

```txt
+--------------------------------------------------+
| Maglev mark                                      |
| Continue to Maglev                               |
| Access your local-first coding hub               |
|                                                  |
| [ Continue with GitHub ]                         |
| Recommended for remote hubs                      |
|                                                  |
| Use access token instead                         |
|   [ token input.............................. ]  |
|   [ Sign in ]                                    |
|                                                  |
| Connected to  hub.example.com   [Remote] Change  |
|                                                  |
| Error message, if any                            |
|                                                  |
| Docs                    Your sessions stay local |
+--------------------------------------------------+
```

## Component Rules

### Buttons

- one dominant CTA per screen
- secondary actions outlined or tonal
- tertiary actions text-only

### Inputs

- `44px` min height
- clear focus ring
- helper text below, not inside placeholders alone

### Pills / Chips

- use for mode/state, not for every action
- selected pill should use accent tint + stronger border

### Cards

- large auth card should not exceed two nested panel layers
- avoid card-inside-card-inside-card feeling

### Icons

- icons support scanability
- icons should not replace labels on critical actions

## Public Landing Adjustments

Current files:

- [website/src/pages/Home.tsx](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/website/src/pages/Home.tsx:26)
- [website/src/components/Layout.tsx](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/website/src/components/Layout.tsx:14)

Keep:

- typography direction
- warm light theme
- tactile card system
- expressive hero pacing

Adjust:

- remove or soften joke elements that reduce trust in the hero
- make navigation more product-oriented
- add a direct route from landing to app/server entry where appropriate
- ensure hero copy sells capability before lifestyle

Recommended landing tone:

- confident
- memorable
- credible enough for serious engineering workflows

## Implementation Plan

### Phase 1: Shared Tokens

Files:

- `website/src/index.css`
- `web/src/index.css`
- optional shared theme file later

Work:

- define common Maglev semantic tokens
- map website palette into those tokens
- migrate web app to semantic tokens

### Phase 2: Hub Shell Restyle

Files:

- `web/src/index.css`
- `web/src/router.tsx`
- `web/src/components/SessionList.tsx`

Work:

- add shared typography
- add branded shell identity row
- improve primary/secondary action distinction
- bring selected/active states under new accent system

### Phase 3: Login Redesign

Files:

- `web/src/components/LoginPrompt.tsx`
- `web/src/App.tsx`

Work:

- rebuild layout hierarchy
- promote primary auth
- demote server details
- improve error placement and trust copy

### Phase 4: Follow-through

Files:

- `web/src/routes/settings/index.tsx`
- `web/src/components/NewSession/index.tsx`
- `web/src/routes/sessions/terminal.tsx`

Work:

- apply the same hierarchy rules to settings and creation flows
- group terminal actions into clearer priority buckets

## Acceptance Criteria

The redesign is successful when:

1. A first-time user can identify the app as Maglev before reading infrastructure details.
2. The login screen has one obvious primary action.
3. The public site and the hub feel visually related without making the hub noisy.
4. Terminal/files/review remain calm and legible.
5. The product keeps its personality while feeling more trustworthy and mature.

## File Ownership

Primary implementation files:

- [website/src/index.css](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/website/src/index.css:46)
- [website/src/pages/Home.tsx](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/website/src/pages/Home.tsx:26)
- [website/src/components/Layout.tsx](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/website/src/components/Layout.tsx:14)
- [web/src/index.css](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/web/src/index.css:4)
- [web/src/components/LoginPrompt.tsx](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/web/src/components/LoginPrompt.tsx:249)
- [web/src/router.tsx](/lustre/fs1/portfolios/coreai/projects/coreai_comparch_autodeploy/users/bmarimuthu/common/maglev/web/src/router.tsx:281)

