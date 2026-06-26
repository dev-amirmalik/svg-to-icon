# Deploying & getting found on Google / AI engines

This app is a static client-side site, so hosting is free and anyone can use it once it's online.

## 1. Deploy to Vercel (free)

**Option A — from GitHub (recommended, auto-deploys on every push):**

1. Push this folder to a GitHub repository.
2. Go to https://vercel.com, sign in with GitHub, click **Add New → Project**, and pick the repo.
3. Vercel auto-detects Vite. Confirm: **Build Command** `npm run build`, **Output Directory** `dist`.
4. Click **Deploy**. You'll get a free URL like `https://your-app.vercel.app`.

**Option B — from your computer (no GitHub):**

```bash
npm install
npm run build         # creates dist/
npm i -g vercel
vercel --prod         # follow the prompts; uploads dist/
```

Every time you change the app, push to GitHub (Option A) or run `vercel --prod` again (Option B).

## 2. Replace the placeholder URL

Once you know your real address (e.g. `https://your-app.vercel.app`), search-and-replace
`https://example.com` with it in these files, then redeploy:

- `index.html` → `<link rel="canonical">` and the two `og:url` / canonical references
- `public/robots.txt` → the `Sitemap:` line
- `public/sitemap.xml` → the `<loc>` value

## 3. SEO — get indexed by Google

Already built in: a descriptive `<title>` and meta description, Open Graph tags, a canonical
URL, `robots.txt`, `sitemap.xml`, a favicon, and real crawlable text in `index.html`.

To speed up indexing:

1. Go to **Google Search Console** (https://search.google.com/search-console).
2. Add your property (use the URL prefix, e.g. `https://your-app.vercel.app`).
3. Verify (the easiest method on Vercel is the **HTML tag** — paste the provided
   `<meta name="google-site-verification" ...>` into `index.html`'s `<head>` and redeploy).
4. Submit your sitemap: enter `sitemap.xml` under **Sitemaps**.
5. Use **URL Inspection → Request indexing** for the homepage.

Indexing usually takes a few days to a couple of weeks.

## 3b. Bing — important for AI assistants

ChatGPT (browse), Microsoft Copilot, and DuckDuckGo rely on **Bing's** index, so submitting to
Bing materially helps AI discoverability.

1. Go to **Bing Webmaster Tools** (https://www.bing.com/webmasters).
2. Add your site — you can **import directly from Google Search Console** in one click, or verify
   with a meta tag like the Google one.
3. Submit `sitemap.xml`.
### IndexNow (near-instant indexing) — already wired up

- A verification key file is included at `public/1cf5f8f5f28064eaad12769770b520b6.txt`
  (served at `https://your-site/1cf5f8f5f28064eaad12769770b520b6.txt` after deploy).
- After each deploy, notify the engines:

  ```bash
  npm run notify:indexnow -- https://your-app.vercel.app
  ```

  A `200`/`202` response means it was accepted. (If you want your own key, generate a new
  hex string, rename the file in `public/` to `<key>.txt`, and update `KEY` in
  `scripts/indexnow.mjs`.)

### Search engine verification

`index.html` has placeholder meta tags:

```html
<meta name="google-site-verification" content="REPLACE_WITH_GOOGLE_CODE" />
<meta name="msvalidate.01" content="REPLACE_WITH_BING_CODE" />
```

Paste the code each console gives you (Google Search Console / Bing Webmaster Tools), then
redeploy. Or skip the Bing tag and just **import from Google** inside Bing Webmaster Tools.

## 4. AEO — Answer Engine Optimization (featured snippets, voice)

Built in: `FAQPage` and `HowTo` structured data plus a visible FAQ with clear question
headings. This is what gets pulled into Google's "People also ask" and answer boxes. Keep
answers short and factual. Add more real Q&A over time for more coverage.

## 5. GEO — Generative Engine Optimization (ChatGPT, Perplexity, AI Overviews)

Built in:

- `public/llms.txt` — a concise, factual summary AI crawlers can read.
- Plain, crawlable text on the page (AI engines favor real HTML text over JS-only content).
- Structured data and clear headings so models can extract accurate claims.

To improve GEO further:

- Keep claims specific and consistent (free, runs in browser, TTF/WOFF/WOFF2…).
- Earn mentions/links from other sites (blog posts, README, dev forums) — generative engines
  cite sources that are referenced elsewhere.
- Consider a short blog/guide page ("How to make an icon font from SVGs") for more surface area.

## Notes

- The app needs JavaScript to run, but the title, description, FAQ and About text are in the
  static HTML so crawlers and AI engines can read them without executing JS.
- No backend is required; there are no running server costs.
