// Notify IndexNow (Bing, and engines that consume it) that your URL changed.
// Run after deploying:  node scripts/indexnow.mjs https://your-app.vercel.app
//
// IndexNow lets you push updates for near-instant indexing instead of waiting for a crawl.
// The key below must match the file in public/<key>.txt served at your site root.

const KEY = "1cf5f8f5f28064eaad12769770b520b6";

const site = (process.argv[2] || process.env.SITE_URL || "").replace(/\/+$/, "");
if (!site || !/^https?:\/\//.test(site)) {
  console.error("Usage: node scripts/indexnow.mjs https://your-app.vercel.app");
  process.exit(1);
}

// List the URLs you want (re)indexed. For a single-page app, the homepage is enough.
const urlList = [`${site}/`];

const body = {
  host: new URL(site).host,
  key: KEY,
  keyLocation: `${site}/${KEY}.txt`,
  urlList,
};

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

// IndexNow returns 200 or 202 on success.
console.log(`IndexNow responded: ${res.status} ${res.statusText}`);
if (res.status === 200 || res.status === 202) {
  console.log("Submitted:", urlList.join(", "));
} else {
  console.log("If this failed, confirm the key file is live at:", body.keyLocation);
  process.exitCode = 1;
}
