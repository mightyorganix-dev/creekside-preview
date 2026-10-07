# Creekside Riding Stables — Static Preview

Clean static HTML/CSS/JS preview of the Themify Agency–era site look, without WordPress plugins.

## Open locally

```bash
cd /path/to/creekside-preview
npx --yes serve -l 4173
# or: python3 -m http.server 4173
```

Then open http://localhost:4173

## Edit content

Each page is a plain `.html` file with labeled sections. Shared styles live in `css/style.css`. Shared mobile menu / form stub behavior in `js/main.js`.

## Intentionally stubbed

- No real booking calendar / Appointment Booking / BookingPress
- No payments
- Contact & schedule forms show a preview message only (or use mailto / phone)

## Not connected to live site

This folder does **not** deploy to or modify https://creeksideridingstables.com/
