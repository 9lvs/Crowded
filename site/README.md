# Crowded launch site

Static marketing site plus the pages Apple asks for in App Store Connect.

| Page | App Store Connect field |
|---|---|
| `index.html` | Marketing URL |
| `privacy.html` | Privacy Policy URL (required) |
| `support.html` | Support URL (required) |
| `terms.html` | Terms of Use, linked from the app and the App Store description |

No build step, no trackers, no external requests. Fonts are self hosted (SIL OFL 1.1, see
`fonts/OFL.txt`). The palette is black and white on purpose. To add a color later, change
`--accent` in `css/site.css`.

## Preview locally
```bash
python3 -m http.server 8790 --directory site
```
Then open http://localhost:8790.

## Deploy for free
- **GitHub Pages:** the repo must be public, or on a paid plan for private Pages. Easiest path is
  a small workflow that uploads `site/` with `actions/upload-pages-artifact` and
  `actions/deploy-pages`. Then set Settings, Pages, Source to GitHub Actions.
- **Netlify or Cloudflare Pages:** drag and drop the `site/` folder, or connect the repo with the
  publish directory set to `site`.
- Point a custom domain at it, then replace every `https://crowded.example` in `index.html`
  (canonical, Open Graph and Twitter tags).

## Before launch, change these
- [ ] Real domain in the meta tags of `index.html`.
- [ ] Real emails. Replace `support@`, `privacy@` and `partners@crowded.example`.
- [ ] Legal entity name, mailing address, effective dates and governing law in `privacy.html`
      and `terms.html`. Name the SMS and hosting providers.
- [ ] Lawyer review of `privacy.html` and `terms.html`, then remove the "Draft" banners and the
      `noindex` tags.
- [ ] Replace the "Coming soon to iPhone" button with Apple's official "Download on the App
      Store" badge, from Apple's marketing resources, linked to the real App Store URL. Never redraw
      the badge or the Apple logo. The spot is marked with a comment in `index.html`.
- [ ] Waitlist: the form is a preview and sends nothing (`js/site.js`). Connect a real waitlist
      service with a privacy notice before collecting any emails, and remove the "Preview build"
      note in the footer.
- [ ] The phone illustration uses FAKE bar names. Swap in real pilot bars only with their
      permission.
- [ ] Regenerate `og.png` if the headline changes. The source is `tools/og.html`.
