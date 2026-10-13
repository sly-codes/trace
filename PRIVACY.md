# Trace Privacy Policy

Last updated: October 12, 2026

Trace is a Chrome extension that lets you inspect one element of a web page at a time. This policy explains exactly what the extension reads, what it stores and what it never does.

## Summary

- Trace has no server. Nothing you inspect is sent anywhere.
- Trace only works on a page after you start it yourself.
- Trace keeps a short history of your inspections on your own device. You can delete it at any time.
- Trace contains no analytics, no telemetry, no advertising and no tracking.

## When Trace reads a page

Trace does nothing on its own. It only runs on the tab you are looking at, and only after you do one of these:

- click **Start Inspecting** in the Trace popup;
- use the Trace keyboard shortcut.

Trace does not run in the background on the pages you visit, and it does not inspect pages automatically.

## What Trace reads when you select an element

When you click an element during inspection, Trace reads the following from that element:

- its tag name, its ID and its CSS class names;
- its position in the page structure (the tags, IDs and classes of its ancestors);
- its size, position, padding, borders and margins;
- a fixed list of computed style values, such as colors, fonts and display mode;
- the colors of a small number of elements inside it (40 at most).

This information is shown to you in the Trace panel on the page. It stays in the page until you close the panel or leave the page.

Trace does not read the text of the page, form values, passwords, cookies, or your browsing history. Password fields cannot be selected.

## What Trace stores on your device

Each time you select an element, Trace saves one entry in a local history, using Chrome's local extension storage (`chrome.storage.local`). An entry contains only:

- the date and time of the inspection;
- the origin of the page, for example `https://example.com`. The full address, including the path and any search terms, is not saved;
- the element's tag name, ID and class names;
- the CSS selector Trace generated for it;
- its width and height;
- eight computed style values: `display`, `position`, `color`, `background-color`, `font-family`, `font-size`, `font-weight` and `border-radius`.

The history is limited to the 20 most recent entries. Older entries are deleted automatically.

Trace does not store page content, HTML, text, form values or screenshots.

IDs, class names and selectors are chosen by the websites you inspect. In rare cases a website may put meaningful words in them. They are stored exactly as the page defines them.

## How to delete your data

- Open the Trace popup and click the cross next to an entry to remove it.
- Click **Clear all**, then confirm, to delete the whole history.
- Removing the extension from Chrome deletes everything it stored.

## What Trace never does

- It does not send any data to a server, to the developer or to any third party.
- It does not load or run code from the internet.
- It does not use analytics, telemetry, advertising or tracking of any kind.
- It does not sell or share data, because it does not collect any.
- It does not synchronize your history between devices.

## Clipboard

Trace writes to your clipboard only when you click a copy button. It never reads your clipboard.

## Permissions

| Permission  | Why Trace needs it                                           |
| ----------- | ------------------------------------------------------------ |
| `activeTab` | To access the current tab, only after you start Trace on it. |
| `scripting` | To add the inspection interface to that tab.                 |
| `storage`   | To keep the local history of your last 20 inspections.       |

Trace does not ask for permanent access to any website.

## Changes

If this policy changes, the new version will be published with the extension and the date at the top will be updated.

## Contact

Questions about this policy can be sent through the developer's website: https://issa.nocerv.com
