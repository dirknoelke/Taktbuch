# Changelog

## 1.9.0

- **The app is now called Taktbuch** (formerly Zeitwerk). Your data stays: nothing about storage changed, just update in place as usual and keep the file name and location. Save a JSON backup before updating, as always. The repository moved to `taktbuch`, old links keep working.
- New button **Report a problem / send a request** under Settings, Data. It opens your mail program with prefilled text (version, browser, language, active switches). Nothing is sent automatically and no data from the app is included. (GitHub issue #9)

## 1.8.2

- Update check: runs on start and whenever you return to the tab, at most once an hour (before: once a day, and only at start). New releases show up much sooner and in tabs that stay open for days.

## 1.8.1

- Split work location days can start with home office: choose "office first" or "home office first" plus the switch time.
- Fix: after "Add" in activities, Category, Type and System are no longer carried over from the previous entry. This also restores the automatic fill of these fields from an earlier entry with the same Topic.

## 1.8.0

- **Work location** (GitHub issue #6): per day Office, Home office or split (office before a time, home office after). Default location and fixed home office weekdays in Settings, a period tool in the Month view, and a yearly table in Reports (days and hours per month, business trips separate). A plain count, no tax calculation. Off by default.
- **Overtime payout** (GitHub issue #5): field "Overtime payout (h)" on the day, reduces the time account and is summed per year in Reports. Off by default.

## 1.7.0

- New **Job change** wizard in Settings. Asks for the first day in the new job, vacation days per year, vacation days until year end, starting time account, starting long-term account and target hours. The old job counts pro rata in half months (1st to 15th = half a month), rounded up to half days. On the change date remaining vacation, time account and long-term account are reset to the entered values; everything before stays unchanged. Expiry, cap and 24.12./31.12. are copied from the previous rules and editable in the new entry. Dated rule changes from 1.6.0 stay for changes within the same job.

## 1.6.0

- Settings (GitHub issue #4): **Vacation days per year, 24.12./31.12., expiry date, days into the long-term account, and cap (date and balance after cap) now apply from a date.** Add a "rule change" with a "Valid from" date; earlier periods keep their old rules. The cap can be switched off per rule. "Expiry applies from year" is replaced by this: existing settings are converted automatically.
- Payday dropdown reordered: start of month, end of month, middle of month, 4th last working day. The old "Mon to Fri" variant only shows if it was already selected.
- Activity column names are laid out in one row.

## 1.5.0

- New day type **Business trip** (Dienstreise), next to Vacation and Time off in lieu (GitHub issue #3). It is only a marker in the calendar, vacation planner and day view: the day is calculated exactly like a normal working day, so hours, target and balance are unaffected. Its own colour in the calendars.

## 1.4.6

- Fix (quarter-hour mode): typing into the time text fields no longer inserts a leading `0` or `:00` while typing (GitHub issue #2). The value is normalised when you leave the field.

## 1.4.5

- Quarter-hour mode: the same text-field-with-dropdown applies to Break, Absence and Interruption: text field with a dropdown (00:00 to 08:00 in 15-minute steps). For these, `30` means 30 minutes.

## 1.4.4

- Quarter-hour mode: Arrive, Leave, From and To are now text fields with a dropdown listing the whole day in 15-minute steps (the browser's own time picker cannot be limited to quarter hours). Typing works too: `9`, `930`, `09:30` all become 09:30, rounded to the nearest quarter hour.

## 1.4.3

- The **Install** button now verifies the written file and restores the previous version if the result is incomplete (a 0 KB file after installing was reported).

## 1.4.2

- Fix (quarter-hour mode): typing an hour no longer resets the minutes to 00. Times are rounded when you leave the field, not while typing.

## 1.4.1

- Quarter-hour mode: the time fields (arrive, leave, from, to) now show a list of all quarter hours as a dropdown. Before, only the browser’s own minute picker appeared.

## 1.4.0

- Activity columns (Category, Type, System, Project number, Topic) have their own names and the first four can be shown or hidden under Settings. Hidden columns keep their values. Applies to the activity tables, filters, reports and CSV export.
- New optional column **Project number** (hidden by default), with filter and a grouping in Reports.
- Excel import now recognises the activity columns by their headers instead of by position, imports the project number, adopts custom headers as column names and tells you which columns were filled. If a column contains almost only one value, the import report suggests hiding it.
- Header: the tab row wraps below the title on screens up to 1360 px so that no tab is cut off.

## 1.3.1

- Fix: the **Install** button in the update banner failed with “Failed to fetch” (GitHub release downloads are not readable from the browser). The installer now loads the build from the `dist` branch and asks for the target file first.

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
