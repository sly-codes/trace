# Chrome Web Store listing

Working notes for the submission. This file is not needed inside the extension package.

Trace is not published. It has to be submitted and reviewed by Google first.

## Name

Trace

## Short description (132 characters maximum)

Inspect the web, one element at a time. See any element's tag, classes, size, styles and colors without opening DevTools.

## Detailed description

Trace is a lightweight visual inspector for web pages.

Click Start Inspecting, hover the page and click any element. Trace shows what it is made of in a compact panel, without opening Chrome DevTools.

WHAT YOU SEE
• Tag, ID and CSS classes
• A ready to copy CSS selector, with a note telling you whether it is unique on the page
• Parent element and hierarchy, with one click to move up to an ancestor
• Box model: size, viewport position, padding, borders and margins
• Computed styles: display, position, colors, fonts, line height, border radius, opacity and z-index
• Color swatches with HEX values, including translucent and transparent colors

COPY IN ONE CLICK
• The selector
• The class list
• The tag name
• A summary of the computed styles
• Everything as JSON

BUILT TO STAY OUT OF THE WAY
• Trace only runs when you start it, on the tab you are looking at
• While you pick an element, your clicks never reach the page: no link opens, no button fires
• Press Esc to close it. Nothing is left behind in the page

PRIVATE BY DESIGN
• No account, no server, no analytics, no tracking
• Nothing you inspect is sent anywhere
• Your last 20 inspections are kept on your device only, and you can delete them at any time
• Trace never reads page text, form values or passwords

Trace shows computed styles, which are the final values calculated by the browser. It does not show the original CSS rules and it is not a replacement for DevTools.

Made for frontend developers, designers, students and anyone curious about how a page is built.

## Category

Developer Tools

## Language

English

## Single purpose

Trace lets the user inspect one element of the current web page at a time and see its structure, dimensions and computed styles.

## Permission justifications

| Permission  | Justification to enter in the dashboard                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab` | Trace needs temporary access to the current tab, only after the user clicks the extension or its shortcut, to inspect an element the user selects. |
| `scripting` | Used to inject the inspection interface into the active tab when the user starts inspecting.                                                       |
| `storage`   | Used to keep a local history of the user's 20 most recent inspections.                                                                             |

Remote code: No, the extension does not use remote code.

## Data usage answers

- The extension stores a small inspection history locally (page origin, element tag, ID, classes, selector and a few computed style values). This is "website content" in Google's categories, handled on the device only.
- It is not sold, not transferred to third parties, and not used for purposes unrelated to the single purpose.
- Privacy policy URL: host `PRIVACY.md` on a public page (for example the GitHub repository) and paste that link.

## Assets still to prepare

| Asset                | Requirement                     | Status                     |
| -------------------- | ------------------------------- | -------------------------- |
| Extension icon       | 128 × 128 PNG                   | Done (`icons/icon128.png`) |
| Screenshots          | 1 to 5, 1280 × 800 or 640 × 400 | To capture                 |
| Small promo tile     | 440 × 280 PNG or JPEG           | To design                  |
| Marquee promo tile   | 1400 × 560, optional            | Optional                   |
| Privacy policy URL   | Public link                     | To publish                 |
| Support URL or email | Public contact                  | To provide                 |
| Developer account    | One time registration fee       | To set up                  |

## Suggested screenshots

1. Hovering a card on a clean website, with the lime highlight and the label showing the tag and size.
2. The panel open on a selected element: identity, selector and hierarchy visible.
3. The box model and computed styles sections, on an element with visible padding and borders.
4. The color swatches, on an element with several colors, including a translucent one.
5. The popup, with a few entries in the history.

Use a 1280 × 800 browser window and a simple, well known page so the content is readable at small size.

## Before submitting

- Load the unpacked extension and go through the manual checks listed in the README.
- Bump `version` in `manifest.json` for every new upload.
- Zip the folder content with `manifest.json` at the root of the archive.
