# Changelog

## 1.1.1

`main.js` SHA-256: `bcb03e33eda9517050eb08568b8d7d164c287530942abc16a8a6d7a87c4fafb8`

- `Location` is written as a YAML list of quoted strings (`"lat"`, `"lon"`), which list/text properties and Bases accept. Map Link and City still update. Address is never written. Older numeric locations still count as coordinates when read back.
- Auto-pick no longer compares street words. A hit is saved without the picker only when Geoapify `rank.confidence` is 1.00, the hit is inside a configured home-base county (`Orange` and `Orange County` still match), and it is the only result in that home region. An empty home-county list still always asks. A missing confidence never auto-picks.
- Bulk geocode: choosing a result saves that note (Location, City, Map Link). Closing the picker still skips it. The summary counts follow what was written.
- Templater: `extras/templater-metabind/geocodeNewRv.js` prompts for Address when the new note does not have one, then runs **Geocode current note**. Meta Bind is not required. The plugin still does not write Address.

## 1.1.0

- Geoapify geocode for return-visit notes, Nearby Bases views, and visit logging. Address is never overwritten.
