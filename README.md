# Creekside Riding Stables — Static Preview

Clean static HTML/CSS/JS preview of the Themify Agency–era site look, without WordPress plugins.
Page text now loads **live from the existing WordPress site** (read-only), so Kris keeps editing in
her WordPress dashboard and the preview shows what she writes.

## Open locally

```bash
cd /path/to/creekside-preview
npx --yes serve -l 4173
# or: python3 -m http.server 4173
```

Then open http://localhost:4173

## How the live WordPress content works

1. Kris edits a page in the WordPress dashboard (creeksideridingstables.com/wp-admin) as usual and clicks **Update**.
2. Each preview page has a content container like
   `<div class="wp-content" data-wp-page="lessons" data-wp-id="15">…static fallback…</div>`.
3. `js/wp.js` makes one anonymous `GET` request to the public WordPress REST API:
   `https://creeksideridingstables.com/wp-json/wp/v2/pages/<id>?_fields=id,slug,title,content,modified,link`
   (falls back to `?slug=<slug>` if the id ever stops working).
4. The returned `content.rendered` HTML is sanitized and then replaces the static content, styled by the
   preview's own CSS. The WordPress page title becomes the page's `<h1>`, with a small "Last updated" note.
5. The next time someone loads the preview page (after the short cache expires) they see her changes.

Responses are cached in `sessionStorage` for **5 minutes** per browser tab, so navigating around is fast.
To see an edit immediately, open the page in a new tab/private window.

### Page mapping (WordPress slug → preview page)

| Preview page | WordPress page (title) | Slug | ID |
|---|---|---|---|
| `index.html` | Home (front page) | `home` | 4 |
| `lessons.html` | Lessons | `lessons` | 15 |
| `riding.html` | Trail Ride Lessons | `riding` | 13 |
| `prices-offerings.html` | Prices & Offerings | `prices-offerings` | 6672 |
| `schedule-your-ride.html` | Schedule a Ride Time | `schedule-your-ride` | 275 |
| `summer-camps.html` | Summer Riding Camp Description | `summer-camps` | 17 |
| `parties.html` | Parties | `parties` | 225 |
| `boarding-at-cheval.html` | Boarding at Cheval | `boarding-at-cheval` | 5435 |
| `announcements.html` | Announcements | `announcements` | 8 |
| `contact.html` | Contact | `contact` | 6 |

What stays static on purpose: header/nav, sidebar, footer, the home page's feature blocks and buttons,
the preview ride-request form on Schedule a Ride, and the "Ask about camp enrollment" button.

### Posts / announcements

`announcements.html` also asks for the latest WordPress **posts** (`/wp/v2/posts?per_page=10&_embed`).
If any exist they are listed (title, date, excerpt, link) above the Announcements page content.
There are currently no posts, so nothing extra shows.

### Fallback behavior

The original static content stays in the HTML. If WordPress is slow (more than **6 seconds**), unreachable,
returns an error, or returns an empty page, the static content simply stays — the page never goes blank.
The container gets `data-wp-state="live"` or `"fallback"` so you can tell which one you're seeing.

### Sanitizing

Before display, the WordPress HTML is cleaned in the browser:

- removes `<script>`, `<style>`, `<link>`, forms and form fields (the old booking calendar and the camp
  registration form — a short note is shown instead), `on*` attributes, ids, `data-*` attributes;
- keeps `<iframe>` only for YouTube and Google Maps embeds (made responsive), drops WordPress post-embed iframes;
- drops inline styles (keeps center/right alignment; red emphasis is kept as a muted brick color);
- removes plugin/page-builder shortcode leftovers (`[bookingpress…]`, `[themify…]`, `[wpforms…]`, …),
  empty Themify builder markers, empty paragraphs/headings, and the hidden white "s"/"ss" spacer text;
- collapses long runs of `&nbsp;` used for column alignment so text wraps on phones;
- rewrites links to `creeksideridingstables.com/<slug>/` (and `?page_id=<id>`) to the matching preview page;
  other links stay absolute and open in a new tab;
- images load from the WordPress media library with `loading="lazy"`.

### Read-only

The preview only ever sends anonymous `GET` requests (no cookies, no login, no API keys).
Nothing writes to WordPress. This folder does **not** deploy to or modify https://creeksideridingstables.com/

## Intentionally stubbed

- No real booking calendar / Appointment Booking / BookingPress
- No payments
- Contact & schedule forms show a preview message only (or use mailto / phone)
