# Changelog

## 1.3.0

- New setting **Federal state** (Settings → Public holidays): holidays for all 16 German states or nationwide holidays only. Default stays North Rhine-Westphalia. Affects calendar, target hours, payday and vacation planning.

## 1.2.0

- The **Data** tab is now **Settings**, with *Data* (import, backup, version, reset) as a sub-section.
- New setting **Record times**: to the minute or every quarter hour. In quarter-hour mode time fields step by 15 minutes and typed times, “Arrive/Leave now” and the activity timer are rounded to the nearest quarter hour.
- Activity columns (Category, Type, System, Topic) can be renamed under Settings. Names apply to the activity tables, filters, reports and CSV export.

## 1.1.1

- The browser tab title is just “Zeitwerk”, the version is shown only under **Data**.
- New **Install** button in the update banner (Chrome/Edge): pick your existing zeitwerk.html and the new version is written over it, no stray copy in Downloads. Falls back to a normal download.
- If the update check fails (offline, blocked, no release yet), it retries after one hour instead of one day.

## 1.1.0

- The app is now available in English and German. Switch with DE / EN in the top right. The browser language is preselected on first start.
- README and changelog are in English, the German README is in `README.de.md`.

## 1.0.1

- The version number moved from the header to **Data**, section “Version”.
- Fields in the input rows (Today) are aligned and have the same height.

## 1.0.0

First version under the name Zeitwerk (formerly “Stundenkonto”, internally up to v14).

- One shared file for everyone. On first start you choose a template: with or without vacation expiry and cap. Existing data from earlier versions is detected.
- Update check: at most once a day the app asks GitHub for a new version and shows a banner with a download button.
- Time tracking, activities, reports, salary and vacation planning, all local in the browser.
- Excel import (hours Excel file with the sheets “ab 2020” or “Zeiterfassung”, “Tätigkeiten”, “Gehalt”).
- Selectable payday: 4th last working day, 15th, first or last working day of the month.
- Flexible salary raise: month, percent or amount in euro.
- MIR column (staff canteen) can be hidden.
- Dec 24 and Dec 31 as half vacation days (configurable).
