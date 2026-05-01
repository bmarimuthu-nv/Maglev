# File Surface Redesign Plan

This document turns the high-level redesign direction for Maglev's file viewer, file review mode, and diff review surfaces into a concrete implementation plan.

## Goal

Move Maglev from a document-style file preview into a code-viewer-first workspace:

- one shared file canvas
- one shared review language
- one consistent thread/comment model
- fewer nested cards and duplicated headers
- tighter, more precise, more modern code-reading density

Target reference:

- GitHub pull request diff viewer
- `difit`'s viewer/reviewer continuity
- Maglev shell branding around a denser code canvas

## Product Principles

### 1. One Canonical File Surface

The file area should not become a different product when switching between `Code`, `Review`, and `Edit`.

Keep:

- one file header
- one utility row
- one code canvas

Change only the overlays and tools:

- `Code`: read-focused
- `Review`: annotation-focused
- `Edit`: editing-focused

### 2. Code Viewer First

The primary artifact is the code canvas, not the panel chrome.

The surface should feel:

- tighter
- flatter
- more exact
- more line-structured
- less card-like

### 3. Review As Annotation, Not Mode Swap

Review should layer onto the same code canvas with:

- gutter comment actions
- inline thread blocks
- inline composer rows
- thread counts and status in the header

It should not introduce:

- a second file header
- a second code container
- a detached review-card product

## Current Gaps

### File Preview

Current issues:

- file preview header is good, but the body still has a document-card feel
- markdown/source and code/review are not one visual system
- review mode swaps in a separate `SourceReviewFileCard` surface

Files:

- `web/src/components/FilePreviewPanel.tsx`
- `web/src/components/SessionFiles/CodeLinesView.tsx`
- `web/src/components/review/SourceReviewFileCard.tsx`

### File Review

Current issues:

- nested review header inside the preview panel
- thread area feels like utility widgets attached below code
- review copy still explains storage details too prominently

Files:

- `web/src/components/review/SourceReviewFileCard.tsx`
- `web/src/components/review/ReviewThreadCard.tsx`

### Diff Review

Current issues:

- diff review has a stronger code-review structure than file review
- thread/composer styling is not shared closely enough with source review
- file review and diff review do not feel like the same review product

Files:

- `web/src/routes/sessions/review.tsx`
- `web/src/components/review/ReviewThreadCard.tsx`

## Target UX Model

### File Header

Own file identity once, at the outermost layer.

Header content:

- file icon
- filename
- path or breadcrumb
- optional status chips
- compact mode switch
- refresh / close / utilities

Mode switch:

- `Code`
- `Review`
- `Edit`

Markdown-only secondary switch inside `Code`:

- `Rendered`
- `Source`

### Utility Row

Keep a compact utility row just above the canvas.

Contains:

- in-file search
- search match count and navigation
- scroll helpers
- optional wrap toggle only if needed later

### Code Canvas

The code canvas becomes the shared primitive for read and review.

Structure:

- left gutter: line numbers, hover controls, comment affordances
- main body: code lines
- optional inline attachment area below a line for composer and threads

Visual rules:

- tighter vertical rhythm
- lighter framing
- fewer giant rounded cards
- code occupies more of the visual field than controls

### Review Layer

Review mode turns on:

- gutter comment buttons
- thread markers
- inline composer insertion
- thread blocks attached to specific lines or ranges

The code canvas remains the same.

## Visual System

### Shell vs Code Surface

Keep Maglev's warm branded shell at the application frame level:

- app background
- workspace cards
- navigation rail
- buttons and selected states

Introduce a dedicated code-surface token set for the inner viewer:

- `--code-bg`
- `--code-gutter-bg`
- `--code-border`
- `--code-line-hover`
- `--code-line-selected`
- `--code-line-annotated`
- `--review-accent`
- `--review-accent-bg`
- `--review-thread-bg`
- `--review-thread-border`

The shell can remain soft and branded.
The code surface should feel sharper and more infrastructural.

### Typography

Shell:

- existing Maglev sans system

Code canvas:

- monospaced
- slightly denser line-height than today
- stronger alignment and gutter rhythm

### Surface Rules

Shell:

- rounded
- elevated
- warm

Code canvas:

- flatter
- more rectangular
- lower decoration
- more table/grid feeling

## Component Responsibilities

### `web/src/components/FilePreviewPanel.tsx`

Responsibilities after redesign:

- only file header owner
- only mode switch owner
- only utility-row owner
- chooses whether body is `Code`, `Review`, or `Edit`
- should stop nesting another file-header component for review

Planned changes:

- remove embedded file card framing from review mode
- keep one stable header across all modes
- pass shared display state into a unified code canvas

### `web/src/components/SessionFiles/CodeLinesView.tsx`

This becomes the core file surface primitive.

Responsibilities:

- line-number gutter
- code display
- search
- line highlighting
- scroll helpers
- optional review affordances via props

New API direction:

- `mode?: 'code' | 'review'`
- `commentable?: boolean`
- `threadsByLine?: Map<number, ...>`
- `composerLine?: number | null`
- `onAddCommentAtLine?: (...) => void`
- `onReplyToThread?: (...) => void`
- `onResolveThread?: (...) => void`

Goal:

- `CodeLinesView` should host both read and review experiences

### `web/src/components/review/SourceReviewFileCard.tsx`

This should be removed or reduced heavily.

Current role:

- creates a second review-specific file surface

Target role:

- either deleted entirely
- or converted into a thin adapter that prepares review state for `CodeLinesView`

Preferred end state:

- no separate visual card
- only a state adapter layer if still useful

### `web/src/components/review/ReviewThreadCard.tsx`

Responsibilities:

- thread body rendering
- reply/edit/delete/resolve controls

Needs redesign:

- stronger author/message hierarchy
- less equal-weight button chrome
- more editorial conversation styling
- more obvious attachment to a specific line context

Target structure:

- top row: line ref + status chip + compact actions
- root message
- reply stack
- compact reply composer

### `web/src/routes/sessions/review.tsx`

Responsibilities:

- diff-review page shell
- changed-files navigation
- expanded/collapsed file state
- page-level diff loading

Needs alignment with file review:

- adopt the same thread card styling
- adopt the same composer styling
- adopt the same review chips and status language
- keep diff-specific mechanics, but share review visuals

## Interaction Model

### File Code Mode

- search and navigation enabled
- no large thread blocks unless intentionally shown
- line interactions subtle

### File Review Mode

- hover/focus reveals comment affordance in gutter
- clicking a line action opens composer inline
- existing threads render below their line/range
- unresolved threads remain visible and prominent
- resolved threads collapse by default

### File Edit Mode

- same outer shell
- same header and utility row
- body switches into editable source canvas
- avoid giant visual jump to a generic textarea shell

## Comment Thread Design

### Visual Direction

Aim closer to GitHub / difit:

- integrated with code review
- subtle but structured
- line-anchored
- compact controls
- conversation-first hierarchy

### Thread States

Open:

- slightly warmer emphasis
- visible and easy to scan

Resolved:

- visually quieter
- collapsed by default
- reopen available as a secondary control

### Action Model

Primary actions:

- reply
- resolve / reopen

Secondary actions:

- edit own message
- delete own message
- copy/share reference if needed

Avoid:

- multiple equal-weight bordered buttons in the header row

## Content and Copy

Demote infrastructure copy:

- storage location
- git metadata mechanics
- workspace review folder mechanics

Promote user-facing copy:

- unresolved thread count
- line reference
- review status
- comment prompt

Replace wording like:

- `Source review with shared comment threads`

With:

- `Review annotations`
- `3 unresolved threads`
- `Comment on lines to capture review feedback`

## Responsive Behavior

### Desktop

- full file header
- utility row
- full-width code canvas
- inline thread blocks below lines

### Narrow Width / Side Preview

- preserve same canvas model
- compress header chips
- keep thread cards narrower but still inline
- avoid introducing a totally different mini-review widget style

## Suggested Refactor Sequence

### Phase 1: Shared Surface Foundation

1. Refactor `FilePreviewPanel` so it is the only file header owner.
2. Move all review-specific header/content framing out of `SourceReviewFileCard`.
3. Extend `CodeLinesView` to support review overlays and thread insertion.

### Phase 2: Review Unification

4. Rebuild file review mode on top of `CodeLinesView`.
5. Make `SourceReviewFileCard` a thin state adapter or remove it.
6. Redesign `ReviewThreadCard` to the new shared annotation style.

### Phase 3: Diff Review Alignment

7. Reuse the redesigned thread/composer styles in `review.tsx`.
8. Align diff review chips, spacing, and line attachment rules with file review.

### Phase 4: Token Cleanup

9. Add code-surface semantic tokens to `web/src/index.css`.
10. Reduce over-rounded card framing inside code surfaces.
11. Tune spacing/typography for denser code readability.

## Acceptance Criteria

- `Code`, `Review`, and `Edit` feel like states of one file surface
- no nested duplicate file header in review mode
- review does not look like a separate utility app
- code canvas feels more precise and tool-like than today
- thread cards feel attached to code, not detached utility widgets
- file review and diff review share the same annotation language
- review/storage implementation details are visually demoted

## Open Decisions

### 1. Naming

Decide whether the mode label should remain:

- `Review`

or change to:

- `Comment`
- `Discuss`
- `Annotate`

`Review` is fine if the rest of the UI becomes more cohesive.

### 2. Edit Surface

Decide whether edit mode stays a simple textarea/body swap first, or whether it later grows into a more editor-like inline code editor.

Recommended first step:

- keep editing simple
- unify the shell first

### 3. Thread Attachment Depth

Decide how much GitHub-like line anchoring to introduce in file review:

- line-local thread blocks only
- optional range attachment later

Recommended first step:

- start with line-local attachment

## Reference Mapping

Reference inspiration:

- GitHub pull request diff viewer
- `difit` file/diff review continuity

Key takeaways from `difit`:

- one diff canvas
- one review language
- comments layered in-place
- file list and file viewer are part of the same review system

Maglev should adapt those structural ideas while keeping its own branded shell.
