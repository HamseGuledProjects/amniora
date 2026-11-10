import type { WebLabPublicData, WebTemplate, WebVulnerabilityModule } from "../schema";
import { canonicalJson } from "../canonical-json";

export const helpdeskV1: WebTemplate = {
  id: "helpdesk", version: "1.0.0",
  capabilities: ["reflectable-input-html-v1", "persistent-content-html-v1"],
  routes: ["/", "/articles", "/requests", "/requests/detail", "/search", "/not-found"],
  bindings: {
    reflected: { capability: "reflectable-input-html-v1", route: "/search", input: "q", sink: "search-summary", renderingContext: "HTML search-summary element", extensionPoint: "reflected-output" },
    stored: { capability: "persistent-content-html-v1", route: "/requests/detail", input: "comment", sink: "ticket-comment-body", renderingContext: "HTML ticket comment body", extensionPoint: "stored-output", action: "add-comment", targetObjectType: "ticket", storageLocation: "ticket-comments", retrievalRoute: "/requests/detail" },
  },
  taskCopy: {
    reflected: {
      objective: "Investigate how the helpdesk search handles a search term. Demonstrate, using a harmless local signal, whether the term can execute in the rendered result summary.",
      expectedObservations: ["A normal search shows a result summary and relevant articles.", "The search term is reflected into that summary.", "A harmless script-execution signal can be observed at the summary."],
    },
    stored: {
      objective: "Add a harmless test comment to your support request. Verify it remains after leaving and returning, then determine whether that stored comment can produce a harmless script-execution signal when the request is viewed again.",
      expectedObservations: ["A submitted comment is retained in this lab instance after navigation or reload.", "The saved comment appears again when the same request is opened.", "A harmless script-execution signal can be observed when stored content is rendered."],
    },
  },
  render: renderHelpdeskV1,
};

const safeSearchBinding = `
  function renderReflectedContent(node, value) {
    node.textContent = 'Results for ';
    const emphasis = document.createElement('strong');
    emphasis.textContent = value;
    node.append(emphasis);
  }
`;
const safeCommentBinding = `
  function renderStoredContent(node, entry) { node.textContent = entry.body; }
`;

function safeJson(data: WebLabPublicData) {
  return canonicalJson(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Output must only be mounted as srcdoc in an iframe sandboxed with allow-scripts alone. */
export function renderHelpdeskV1(data: WebLabPublicData, module?: WebVulnerabilityModule) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>Support desk</title><style>
  :root{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#19293a;background:#f2f5f8}*{box-sizing:border-box}
  body{margin:0}button,input{font:inherit}button{cursor:pointer}a{color:#1261a0}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #0b76c5;outline-offset:2px}
  header{background:#13283d;color:#fff}.top{max-width:1080px;margin:auto;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .brand{font-weight:750;font-size:1.2rem}.identity{font-size:.88rem;color:#cbd6e0}nav{background:#1b354e}nav .links{max-width:1080px;margin:auto;display:flex;gap:24px;padding:10px 24px;flex-wrap:wrap}nav a{color:#e8f1fa;text-decoration:none}nav a:hover{text-decoration:underline}
  main{max-width:1080px;margin:38px auto;padding:0 24px 70px}.hero{background:#fff;border:1px solid #dbe3ea;border-radius:10px;padding:30px;margin-bottom:24px}.hero h1{font-size:2rem;line-height:1.2;margin:0 0 8px}.hero p{color:#526274;margin:0 0 22px}
  .search{display:flex;gap:10px;max-width:650px}.search input{min-width:0;flex:1;padding:12px;border:1px solid #a6b7c7;border-radius:5px}.search button,.reset{border:0;border-radius:5px;background:#125d96;color:white;padding:12px 18px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.card{background:#fff;border:1px solid #dbe3ea;border-radius:8px;padding:20px}.card h2{font-size:1.05rem;margin:0 0 8px}.card p{color:#526274;margin:0}.meta{font-size:.85rem;color:#65798a;margin-bottom:8px}.empty{padding:22px;background:#fff;border:1px solid #dbe3ea;border-radius:8px}.detail{grid-column:1/-1}.comments{margin-top:22px}.comment{border-top:1px solid #dbe3ea;padding:13px 0;overflow-wrap:anywhere}.comment p{margin:4px 0}.reply{display:grid;gap:9px;margin-top:22px}.reply textarea{width:100%;min-height:100px;padding:10px;border:1px solid #a6b7c7;border-radius:5px;font:inherit}.reply button{justify-self:start;border:0;border-radius:5px;background:#125d96;color:white;padding:10px 16px}.saved-note{color:#14674e}
  #search-summary{margin:0 0 20px;font-size:1.05rem}footer{border-top:1px solid #d5dee6;color:#667889;padding:18px 24px;text-align:center;font-size:.85rem}
  @media(max-width:540px){.hero{padding:22px}.search{flex-direction:column}.search button{width:100%}main{margin-top:22px}}
</style></head><body>
<header><div class="top"><div class="brand" id="brand"></div><div class="identity" id="identity"></div></div><nav aria-label="Main navigation"><div class="links"><a href="#/">Home</a><a href="#/articles">Articles</a><a href="#/requests">My requests</a></div></nav></header>
<main><section class="hero"><h1 id="heading"></h1><p id="intro"></p><form id="search-form" class="search"><label for="search-input" class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Search support</label><input id="search-input" name="q" type="search" placeholder="Search articles and requests" autocomplete="off"><button type="submit">Search</button></form></section>
<section aria-live="polite"><p id="search-summary" data-web-lab-sink="search-summary"></p><div id="content" class="grid"></div></section>
<p style="margin-top:30px"><button id="reset" type="button" class="reset">Start over</button></p></main><footer id="footer"></footer>
<script id="web-lab-data" type="application/json">${safeJson(data)}</script>
<script>
  'use strict';
  const data = JSON.parse(document.getElementById('web-lab-data').textContent);
  const byId = id => document.getElementById(id);
  const displayUser = data.users.find(user => user.id === data.session.displayUserId);
  byId('brand').textContent = data.application.name;
  byId('identity').textContent = displayUser.name + ' · ' + data.application.company;
  byId('footer').textContent = data.application.company + ' support';
  const content = byId('content');
  const summary = byId('search-summary');
  const storageKey = 'web-lab-instance:' + data.labId;
  function canonicalState() {
    return { schemaVersion: 1, labId: data.labId, contentByObject: Object.fromEntries(data.tickets.map(ticket => [ticket.id, ticket.comments.map(comment => ({ ...comment, submittedByLearner: false }))])), nextContentNumber: 1 };
  }
  function readState() {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const candidate = JSON.parse(saved);
        if (candidate.schemaVersion === 1 && candidate.labId === data.labId && Number.isSafeInteger(candidate.nextContentNumber) && candidate.nextContentNumber > 0 &&
          data.tickets.every(ticket => Array.isArray(candidate.contentByObject?.[ticket.id]) && candidate.contentByObject[ticket.id].every(comment => typeof comment.body === 'string' && typeof comment.id === 'string' && typeof comment.authorId === 'string' && typeof comment.submittedByLearner === 'boolean'))) return candidate;
      }
    } catch { /* Opaque-origin frames may not have session storage; future runner supplies instance storage. */ }
    return canonicalState();
  }
  let runtimeState = readState();
  function saveState() {
    try { sessionStorage.setItem(storageKey, JSON.stringify(runtimeState)); } catch { /* In-memory until an isolated runtime provides storage. */ }
  }
  function card(title, body, meta) {
    const element = document.createElement('article'); element.className = 'card';
    const heading = document.createElement('h2'); heading.textContent = title; element.append(heading);
    if (meta) { const label = document.createElement('div'); label.className = 'meta'; label.textContent = meta; element.append(label); }
    const paragraph = document.createElement('p'); paragraph.textContent = body; element.append(paragraph);
    return element;
  }
  function showList(items, emptyText) {
    if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = emptyText; content.append(empty); }
    else items.forEach(item => content.append(item));
  }
  ${module?.extensionPoint === "reflected-output" ? module.runtimeBinding : safeSearchBinding}
  ${module?.extensionPoint === "stored-output" ? module.runtimeBinding : safeCommentBinding}
  function renderTicketDetail(ticket) {
    const panel = document.createElement('section'); panel.className = 'card detail';
    const status = document.createElement('p'); status.className = 'meta'; status.textContent = 'Request ' + ticket.id + ' · ' + ticket.status; panel.append(status);
    const commentsHeading = document.createElement('h2'); commentsHeading.textContent = 'Updates'; panel.append(commentsHeading);
    const list = document.createElement('div'); list.className = 'comments';
    runtimeState.contentByObject[ticket.id].forEach(comment => {
      const entry = document.createElement('article'); entry.className = 'comment';
      const author = document.createElement('strong'); author.textContent = data.users.find(user => user.id === comment.authorId)?.name || 'Support'; entry.append(author);
      const body = document.createElement('p'); body.dataset.ticketCommentBody = ''; renderStoredContent(body, comment, ticket.replyEnabled); entry.append(body); list.append(entry);
    });
    panel.append(list);
    if (ticket.replyEnabled) {
      const form = document.createElement('form'); form.className = 'reply';
      const label = document.createElement('label'); label.textContent = 'Add a comment'; label.htmlFor = 'ticket-comment';
      const field = document.createElement('textarea'); field.id = 'ticket-comment'; field.name = 'comment'; field.maxLength = 500; field.required = true;
      const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Post comment';
      const note = document.createElement('p'); note.className = 'saved-note'; note.setAttribute('aria-live', 'polite');
      form.append(label, field, button, note);
      form.addEventListener('submit', event => {
        event.preventDefault();
        const body = field.value.trim();
        if (!body || body.length > 500 || ticket.ownerId !== displayUser.id) return;
        runtimeState.contentByObject[ticket.id].push({ id: 'learner-' + runtimeState.nextContentNumber++, authorId: displayUser.id, body, submittedByLearner: true });
        saveState(); field.value = ''; note.textContent = 'Comment saved. Reopen this request to see the latest updates.';
      });
      panel.append(form);
    }
    content.append(panel);
  }
  function render() {
    const raw = location.hash.slice(1) || '/';
    const question = raw.indexOf('?');
    const path = question === -1 ? raw : raw.slice(0, question);
    const params = new URLSearchParams(question === -1 ? '' : raw.slice(question + 1));
    const page = data.routes.some(route => route.path === path) ? path : '/not-found';
    content.replaceChildren(); summary.replaceChildren(); byId('search-input').value = '';
    if (page === '/') {
      byId('heading').textContent = 'How can we help?'; byId('intro').textContent = data.application.tagline;
      showList(data.articles.slice(0, 3).map(item => card(item.title, item.body, 'Popular article')), 'No articles available.');
    } else if (page === '/articles') {
      byId('heading').textContent = 'Support articles'; byId('intro').textContent = 'Browse answers from the support team.';
      showList(data.articles.map(item => card(item.title, item.body, 'Article')), 'No articles available.');
    } else if (page === '/requests') {
      byId('heading').textContent = 'My requests'; byId('intro').textContent = 'Follow the status of your support requests.';
      showList(data.tickets.filter(item => item.ownerId === displayUser.id).map(item => {
        const element = card(item.subject, item.status, item.id);
        const link = document.createElement('a'); link.href = '#/requests/detail?id=' + encodeURIComponent(item.id); link.textContent = 'View request'; element.append(link);
        return element;
      }), 'No requests found.');
    } else if (page === '/requests/detail') {
      const ticket = data.tickets.find(item => item.id === params.get('id') && item.ownerId === displayUser.id);
      if (ticket) {
        byId('heading').textContent = ticket.subject; byId('intro').textContent = 'Request history and updates.';
        renderTicketDetail(ticket);
      } else {
        byId('heading').textContent = 'Request not found'; byId('intro').textContent = 'That request is not available.';
        showList([], 'Return to My requests to see your available tickets.');
      }
    } else if (page === '/search') {
      byId('heading').textContent = 'Search results'; byId('intro').textContent = 'Find support articles by keyword.';
      const term = params.get('q') || ''; byId('search-input').value = term;
      if (term) renderReflectedContent(summary, term);
      const matches = data.articles.filter(item => (item.title + ' ' + item.body).toLowerCase().includes(term.toLowerCase()));
      showList(matches.map(item => card(item.title, item.body, 'Article')), 'No matching articles. Try another search.');
    } else {
      byId('heading').textContent = 'Page not found'; byId('intro').textContent = 'That page is not available.';
      showList([], 'Use the navigation to return to support.');
    }
  }
  byId('search-form').addEventListener('submit', event => {
    event.preventDefault(); location.hash = '/search?q=' + encodeURIComponent(byId('search-input').value);
  });
  byId('reset').addEventListener('click', () => {
    try { sessionStorage.removeItem(storageKey); } catch { /* Opaque-origin fallback has no durable store. */ }
    runtimeState = canonicalState();
    location.hash = '/';
    location.reload();
  });
  addEventListener('hashchange', render);
  if (!location.hash) location.hash = '/';
  render();
</script></body></html>`;
}
