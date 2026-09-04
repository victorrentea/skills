---
name: tooltips
description: "Add, restyle, or review a tooltip/hover hint — a native `title=` attribute, `el.title = ...`, or a CSS `::after` speech bubble. Triggers: \"add a tooltip\", \"show a hint on hover\", \"what does this button do\"."
---

# Tooltips

A tooltip is the cheapest UI element to add badly. It has no layout of its own, no
review surface, and every framework offers a free one — so teams end up with three
of them and notice years later.

## The rule

**One tooltip component per app. One declarative attribute. Never a native `title`.**

If the app has a tooltip component, use it. If it doesn't, build it once, then
migrate everything in the same change — a component that coexists with the old
ways is not a component, it's a fourth system.

## Never use `title=`

The native tooltip cannot be styled, cannot be resized, and appears after roughly
500ms — slow enough that users read the icon, give up, and move on before it shows.

Both of these are the same mistake:

```html
<button title="Copy link">      <!-- attribute -->
```
```js
btn.title = 'Copy link';        // dynamic property — easy to miss when auditing
```

The second form is the one that survives cleanups, because people grep for
`title="` and never for `.title =`. Grep for both.

## The component

Declarative attribute, listeners delegated on `document`:

```html
<button data-tip="Download everything as .zip">…</button>
```

Delegation on `document` matters more than it looks. Binding listeners to a
container scopes the component to that container, and the attribute then silently
does nothing everywhere else — which is how a perfectly good tooltip ends up with
two usages in an app that needs forty. It also means markup rendered later, from
template strings or a framework, needs no registration step.

Ship the CSS from inside the component (inject a `<style>` on load) rather than as
a separate file. A page then cannot pick up the behaviour without the look, and
adoption is one line.

## Visual tokens

These are the values worth copying. The specific palette can change per app; the
proportions and timings are the part that makes it feel right.

| Token | Value |
|---|---|
| background | `rgba(20, 20, 22, 0.96)` — dark in both light and dark themes |
| color | `#fff` |
| font-size | `1.25rem` — roughly 2x a native tooltip |
| font-weight | `600` |
| line-height | `1.25` |
| padding | `0.6rem 0.9rem` |
| border-radius | `0.6rem` |
| max-width | `22rem`, wrapping — never `white-space: nowrap` |
| box-shadow | `0 10px 30px rgba(0, 0, 0, 0.35)` |
| hover delay | `150ms` |
| transition | `120ms ease` on opacity and transform |

Tooltips are conventionally dark in both themes. Theming them to the surface color
buys nothing and costs you a variable to keep in sync.

`nowrap` looks tidy until someone writes a sentence, at which point the bubble runs
off the screen. Wrap with a max-width.

## The peek-in

This is the detail that separates a tooltip that feels responsive from one that
merely appears:

```css
.tooltip            { opacity: 0; transform: translateY(4px);
                      transition: opacity 120ms ease, transform 120ms ease; }
.tooltip.visible    { opacity: 1; transform: translateY(0); }
```

Sliding up 4px while fading in reads as the tooltip *arriving*. A pure opacity fade
reads as a rendering artifact. It is four pixels and it is the whole effect.

## Positioning

One `<div>` appended to `<body>`, `position: fixed`, `pointer-events: none`, high
`z-index`. Position it per show:

- centred above the trigger, with a ~10px gap
- flipped below when there isn't room above
- clamped to ~8px from the viewport edges

CSS-only tooltips (`::after` on the trigger) cannot do the flip or the clamp, which
is why they get cut off at the edges of the screen. That limitation is the reason
to write the few lines of JS.

## Don't forget

- **Keyboard**: show on `focus`, hide on `blur` and `Escape`. Use `focusin`/`focusout`
  when delegating — `focus`/`blur` don't bubble.
- **Accessibility**: set `aria-label` from the tip text *only* when the element has
  no accessible name already. Overwriting a button that already reads correctly makes
  it worse, not better.
- **Scroll**: hide on scroll. A fixed-position bubble positioned once will float away
  from its trigger.
- **Touch**: hide on `touchstart`, or a tap leaves the tooltip stuck open.
- **Empty tips**: `data-tip=""` should show nothing. Conditional call sites render
  empty strings all the time.

## Enforce it

Add a test that fails on any `title="` attribute or `.title =` assignment in the
frontend source, naming the file, the line, and the fix.

Without enforcement this is a convention, and conventions erode quietly — the drift
is usually additive (someone adds one native tooltip in a hurry), so nothing ever
looks broken enough to trigger a cleanup.

When such a guard is first added, expect it to fail. Read every hit rather than
bulk-rewriting: a regex that turns `x.title = y` into `x.dataset.tip = y` will
happily corrupt plain data objects that merely have a `title` field.

## Not tooltips

Guided-tour popovers, onboarding bubbles and coach marks share the word but not the
behaviour — they have their own lifecycle, dismissal and persistence. Don't fold
them into the tooltip component; they will drag state into something that should
stay stateless.
