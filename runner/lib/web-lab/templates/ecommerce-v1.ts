import type { WebLabPublicData, WebTemplate, WebVulnerabilityModule } from "../schema";
import { canonicalJson } from "../canonical-json";

export const ecommerceV1: WebTemplate = {
  id: "ecommerce", version: "1.0.0",
  capabilities: ["reflectable-input-html-v1", "persistent-content-html-v1"],
  routes: ["/", "/catalog", "/products/detail", "/not-found"],
  bindings: {
    reflected: { capability: "reflectable-input-html-v1", route: "/catalog", input: "query", sink: "catalog-summary", renderingContext: "HTML catalogue result summary", extensionPoint: "reflected-output" },
    stored: { capability: "persistent-content-html-v1", route: "/products/detail", input: "review", sink: "product-review-body", renderingContext: "HTML product review body", extensionPoint: "stored-output", action: "add-review", targetObjectType: "product", storageLocation: "product-reviews", retrievalRoute: "/products/detail" },
  },
  taskCopy: {
    reflected: {
      objective: "Investigate how the product catalogue presents a search query. Use a harmless local signal to determine whether the query can execute in the displayed results summary.",
      expectedObservations: ["A normal catalogue search displays matching products.", "The submitted query appears in the results summary.", "A harmless script-execution signal can be observed at the summary."],
    },
    stored: {
      objective: "Add a harmless test review to the product page. Verify it remains after leaving and returning, then determine whether that saved review can produce a harmless script-execution signal when the product is viewed again.",
      expectedObservations: ["A submitted review is retained in this lab instance after navigation or reload.", "The saved review appears again when the same product is opened.", "A harmless script-execution signal can be observed when stored content is rendered."],
    },
  },
  render: renderEcommerceV1,
};

const safeReflectedBinding = `
  function renderReflectedContent(node, value) {
    node.textContent = 'Results for ';
    const emphasis = document.createElement('strong'); emphasis.textContent = value; node.append(emphasis);
  }
`;
const safeStoredBinding = `
  function renderStoredContent(node, entry) { node.textContent = entry.body; }
`;

function safeJson(data: WebLabPublicData) {
  return canonicalJson(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Self-contained offline storefront. Only a reviewed module may replace one safe renderer. */
export function renderEcommerceV1(data: WebLabPublicData, module?: WebVulnerabilityModule) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>Shop</title><style>
  :root{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#263238;background:#f7f7f4}*{box-sizing:border-box}
  body{margin:0}button,input,textarea{font:inherit}button{cursor:pointer}a{color:#146661}a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #087e76;outline-offset:2px}
  header{background:#123e3a;color:#fff}.top{max-width:1100px;margin:auto;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}.brand{font-weight:750;font-size:1.35rem}.identity{font-size:.86rem;color:#d0e3dd}
  nav{background:#19524d}nav .links{max-width:1100px;margin:auto;padding:11px 24px;display:flex;gap:24px;flex-wrap:wrap}nav a{color:#f3fbf8;text-decoration:none}nav a:hover{text-decoration:underline}
  main{max-width:1100px;margin:38px auto;padding:0 24px 65px}.hero{border-radius:12px;background:#e9f2ec;border:1px solid #cddfd4;padding:32px;margin-bottom:26px}.hero h1{font-size:2.1rem;margin:0 0 8px;line-height:1.2}.hero p{color:#50645e;margin:0 0 22px}
  .search{display:flex;gap:10px;max-width:660px}.search input{min-width:0;flex:1;border:1px solid #9cb8ab;border-radius:6px;padding:11px}.search button,.reset,.review-form button{background:#146661;color:#fff;border:0;border-radius:6px;padding:11px 18px}
  .category-links{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 24px}.category-links a{background:#fff;border:1px solid #c9d8cf;border-radius:20px;padding:6px 12px;text-decoration:none}.category-links a:hover{background:#e9f2ec}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}.card{background:#fff;border:1px solid #d9e2dc;border-radius:9px;padding:20px}.card h2{font-size:1.1rem;margin:0 0 8px}.card p{color:#52655d}.meta{font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:#567369}.price{font-weight:700;color:#123e3a}.detail{grid-column:1/-1}.reviews{margin-top:24px}.review{border-top:1px solid #d9e2dc;padding:13px 0;overflow-wrap:anywhere}.review p{margin:4px 0}.review-form{display:grid;gap:9px;margin-top:22px}.review-form textarea{min-height:100px;width:100%;padding:10px;border:1px solid #9cb8ab;border-radius:6px}.review-form button{justify-self:start}.saved-note{color:#146661}.empty{background:#fff;border:1px solid #d9e2dc;padding:22px;border-radius:8px}#catalog-summary{margin:0 0 20px}footer{text-align:center;color:#687b71;border-top:1px solid #d9e2dc;padding:20px}
  @media(max-width:540px){main{margin-top:22px}.hero{padding:22px}.search{flex-direction:column}.search button{width:100%}}
</style></head><body>
<header><div class="top"><div class="brand" id="brand"></div><div class="identity" id="identity"></div></div><nav aria-label="Store navigation"><div class="links"><a href="#/">Home</a><a href="#/catalog">Shop all</a></div></nav></header>
<main><section class="hero"><h1 id="heading"></h1><p id="intro"></p><form id="catalog-search-form" class="search"><label for="catalog-search-input" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Search products</label><input id="catalog-search-input" name="query" type="search" placeholder="Search the collection" autocomplete="off"><button type="submit">Search products</button></form></section>
<div id="categories" class="category-links" aria-label="Categories"></div><p id="catalog-summary"></p><div id="content" class="grid"></div>
<p style="margin-top:30px"><button id="reset" class="reset" type="button">Start over</button></p></main><footer id="footer"></footer>
<script id="web-lab-data" type="application/json">${safeJson(data)}</script><script>
  'use strict';
  const data = JSON.parse(document.getElementById('web-lab-data').textContent);
  const byId = id => document.getElementById(id);
  const displayUser = data.users.find(user => user.id === data.session.displayUserId);
  const content = byId('content'), summary = byId('catalog-summary'), categories = byId('categories');
  byId('brand').textContent = data.application.name;
  byId('identity').textContent = displayUser.name + ' · ' + data.application.company;
  byId('footer').textContent = data.application.company + ' · Fictional training storefront';
  const storageKey = 'web-lab-instance:' + data.labId;
  function canonicalState() {
    return { schemaVersion: 1, labId: data.labId, contentByObject: Object.fromEntries(data.products.map(product => [product.id, product.reviews.map(review => ({ ...review, submittedByLearner: false }))])), nextContentNumber: 1 };
  }
  function readState() {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const candidate = JSON.parse(saved);
        if (candidate.schemaVersion === 1 && candidate.labId === data.labId && Number.isSafeInteger(candidate.nextContentNumber) && candidate.nextContentNumber > 0 &&
          data.products.every(product => Array.isArray(candidate.contentByObject?.[product.id]) && candidate.contentByObject[product.id].every(review => typeof review.body === 'string' && typeof review.id === 'string' && typeof review.authorId === 'string' && typeof review.submittedByLearner === 'boolean'))) return candidate;
      }
    } catch { /* An opaque sandbox may lack session storage; future runner supplies per-instance storage. */ }
    return canonicalState();
  }
  let runtimeState = readState();
  function saveState() { try { sessionStorage.setItem(storageKey, JSON.stringify(runtimeState)); } catch { /* Offline in-memory fallback. */ } }
  function productCard(product) {
    const card = document.createElement('article'); card.className = 'card';
    const category = data.categories.find(item => item.id === product.categoryId);
    const label = document.createElement('div'); label.className = 'meta'; label.textContent = category.name; card.append(label);
    const title = document.createElement('h2'); title.textContent = product.name; card.append(title);
    const description = document.createElement('p'); description.textContent = product.description; card.append(description);
    const price = document.createElement('p'); price.className = 'price'; price.textContent = product.priceDisplay; card.append(price);
    const link = document.createElement('a'); link.href = '#/products/detail?id=' + encodeURIComponent(product.id); link.textContent = 'View product'; card.append(link);
    return card;
  }
  function showProducts(products) {
    if (products.length) products.forEach(product => content.append(productCard(product)));
    else { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No products matched. Try a different search or category.'; content.append(empty); }
  }
  ${module?.extensionPoint === "reflected-output" ? module.runtimeBinding : safeReflectedBinding}
  ${module?.extensionPoint === "stored-output" ? module.runtimeBinding : safeStoredBinding}
  function renderProductDetail(product) {
    const panel = document.createElement('section'); panel.className = 'card detail';
    const description = document.createElement('p'); description.textContent = product.description; panel.append(description);
    const price = document.createElement('p'); price.className = 'price'; price.textContent = product.priceDisplay; panel.append(price);
    const reviewHeading = document.createElement('h2'); reviewHeading.textContent = 'Customer reviews'; panel.append(reviewHeading);
    const reviews = document.createElement('div'); reviews.className = 'reviews';
    runtimeState.contentByObject[product.id].forEach(review => {
      const entry = document.createElement('article'); entry.className = 'review';
      const author = document.createElement('strong'); author.textContent = data.users.find(user => user.id === review.authorId)?.name || 'Customer'; entry.append(author);
      const body = document.createElement('p'); body.dataset.reviewBody = ''; renderStoredContent(body, review, product.reviewEnabled); entry.append(body); reviews.append(entry);
    });
    panel.append(reviews);
    if (product.reviewEnabled) {
      const form = document.createElement('form'); form.className = 'review-form';
      const label = document.createElement('label'); label.htmlFor = 'product-review'; label.textContent = 'Write a review';
      const field = document.createElement('textarea'); field.id = 'product-review'; field.name = 'review'; field.maxLength = 500; field.required = true;
      const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Post review';
      const note = document.createElement('p'); note.className = 'saved-note'; note.setAttribute('aria-live', 'polite');
      form.append(label, field, button, note);
      form.addEventListener('submit', event => {
        event.preventDefault(); const body = field.value.trim(); if (!body || body.length > 500) return;
        runtimeState.contentByObject[product.id].push({ id: 'learner-' + runtimeState.nextContentNumber++, authorId: displayUser.id, body, submittedByLearner: true });
        saveState(); field.value = ''; note.textContent = 'Review saved. Reopen this product to see the latest reviews.';
      });
      panel.append(form);
    }
    content.append(panel);
  }
  function render() {
    const raw = location.hash.slice(1) || '/', question = raw.indexOf('?');
    const path = question === -1 ? raw : raw.slice(0, question);
    const params = new URLSearchParams(question === -1 ? '' : raw.slice(question + 1));
    const page = data.routes.some(route => route.path === path) ? path : '/not-found';
    content.replaceChildren(); summary.replaceChildren(); categories.replaceChildren(); byId('catalog-search-input').value = '';
    if (page === '/' || page === '/catalog') {
      byId('heading').textContent = page === '/' ? 'Everyday goods, thoughtfully chosen.' : 'Shop the collection';
      byId('intro').textContent = page === '/' ? data.application.tagline : 'Browse useful pieces for work and home.';
      data.categories.forEach(category => { const link = document.createElement('a'); link.href = '#/catalog?category=' + encodeURIComponent(category.id); link.textContent = category.name; categories.append(link); });
      const query = params.get('query') || '', categoryId = params.get('category') || '';
      byId('catalog-search-input').value = query;
      if (query) renderReflectedContent(summary, query);
      if (categoryId) {
        const selected = data.categories.find(item => item.id === categoryId);
        const note = document.createElement('span'); note.textContent = selected ? 'Category: ' + selected.name : 'Category not found'; summary.append(note);
      }
      showProducts(data.products.filter(product => (!categoryId || product.categoryId === categoryId) && (!query || (product.name + ' ' + product.description).toLowerCase().includes(query.toLowerCase()))));
    } else if (page === '/products/detail') {
      const product = data.products.find(item => item.id === params.get('id'));
      if (product) { byId('heading').textContent = product.name; byId('intro').textContent = data.categories.find(item => item.id === product.categoryId).name; renderProductDetail(product); }
      else { byId('heading').textContent = 'Product not found'; byId('intro').textContent = 'That product is not available.'; showProducts([]); }
    } else { byId('heading').textContent = 'Page not found'; byId('intro').textContent = 'Use the store navigation to continue.'; showProducts([]); }
  }
  byId('catalog-search-form').addEventListener('submit', event => { event.preventDefault(); location.hash = '/catalog?query=' + encodeURIComponent(byId('catalog-search-input').value); });
  byId('reset').addEventListener('click', () => {
    try { sessionStorage.removeItem(storageKey); } catch { /* In-memory fallback has no durable store. */ }
    runtimeState = canonicalState(); location.hash = '/'; location.reload();
  });
  addEventListener('hashchange', render);
  if (!location.hash) location.hash = '/';
  render();
</script></body></html>`;
}
