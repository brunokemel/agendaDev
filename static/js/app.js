const state = {
  notes: [],
  allNotes: [],
  notebooks: [],
  query: "",
  importance: "",
  notebookId: "",
  sectionId: "",
  editingId: null,
  recentIds: JSON.parse(localStorage.getItem("agendaDev.recentIds") || "[]"),
  pageTreeCollapsed: localStorage.getItem("agendaDev.pageTreeCollapsed") === "1",
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let err = "Erro na requisicao";
    try {
      const data = await res.json();
      err = data.error || err;
    } catch (_) {}
    throw new Error(err);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

function highlight(text, q) {
  const safe = escapeHtml(text || "");
  if (!q) return safe;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
  return safe.replace(re, (m) => `<mark>${m}</mark>`);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkify(text) {
  let html = escapeHtml(text || "");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  html = html.replace(/(^|[\s(])(www\.[^\s<]+)/g, '$1<a href="https://$2" target="_blank" rel="noopener">$2</a>');
  html = html.replace(/\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/g, '<a href="mailto:$1">$1</a>');
  return html.replace(/\n/g, "<br>");
}

function excerpt(text) {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

async function loadAll() {
  const [nb, notes, allNotes] = await Promise.all([
    api("/api/notebooks"),
    api(notesUrl()),
    api("/api/notes"),
  ]);
  state.notebooks = nb.notebooks || [];
  state.notes = notes.notes || [];
  state.allNotes = allNotes.notes || [];
  renderNotebooks();
  renderCards();
  fillEditorNotebooks();
  fillParentPages();
  renderBreadcrumbs();
}

function notesUrl() {
  const p = new URLSearchParams();
  if (state.query) p.set("q", state.query);
  if (state.importance) p.set("importance", state.importance);
  if (state.notebookId) p.set("notebook_id", state.notebookId);
  const qs = p.toString();
  return "/api/notes" + (qs ? "?" + qs : "");
}

function renderNotebooks() {
  const list = $("#notebook-list");
  const counts = {};
  state.allNotes.forEach((n) => {
    counts[n.notebook_id] = (counts[n.notebook_id] || 0) + 1;
  });
  const allActive = !state.notebookId ? "active" : "";
  let html = `<button class="all-item ${allActive}" data-nb="">Todas as paginas</button>`;
  state.notebooks.forEach((nb) => {
    const open = state.notebookId === nb.id;
    html += `<div class="nb-item">
      <button class="nb-head ${open && !state.sectionId ? "active" : ""}" data-nb="${nb.id}">
        <span class="nb-dot" style="background:${nb.color || "#7719aa"}"></span>
        <span>${escapeHtml(nb.name)}</span>
        <span class="nb-count">${counts[nb.id] || 0}</span>
      </button>`;
    (nb.sections || []).forEach((sec) => {
      html += `<button class="sec-item ${state.sectionId === sec.id ? "active" : ""}" data-nb="${nb.id}" data-sec="${sec.id}">${escapeHtml(sec.name)}</button>`;
      html += renderPageTree(state.allNotes.filter((n) => n.section_id === sec.id));
    });
    html += `<button class="add-sec" data-add-sec="${nb.id}">+ Secao</button></div>`;
  });
  renderShortcuts();
  list.innerHTML = html;
  list.querySelectorAll("[data-nb]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.notebookId = btn.dataset.nb || "";
      state.sectionId = btn.dataset.sec || "";
      refreshNotes();
    });
  });
  list.querySelectorAll("[data-add-sec]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const name = prompt("Nome da secao:");
      if (!name) return;
      await api(`/api/notebooks/${btn.dataset.addSec}/sections`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      toast("Secao criada");
      loadAll();
    });
  });
  list.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.stopPropagation();
    openEditor(btn.dataset.page);
    closeMobileSidebar();
  }));
}

function renderPageTree(notes) {
  if (state.pageTreeCollapsed) return "";
  const ids = new Set(notes.map((note) => note.id));
  const children = new Map();
  notes.forEach((note) => {
    const parent = ids.has(note.parent_id) ? note.parent_id : "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(note);
  });
  const visited = new Set();
  const branch = (parentId, depth) => (children.get(parentId) || []).map((note) => {
    if (visited.has(note.id)) return "";
    visited.add(note.id);
    return `<button class="page-item ${state.editingId === note.id ? "active" : ""}" style="--page-depth:${depth}" data-page="${note.id}" title="${escapeHtml(note.title)}">${note.favorite ? "★ " : ""}${escapeHtml(compactTitle(note.title))}</button>${branch(note.id, depth + 1)}`;
  }).join("");
  const result = branch("", 0);
  const orphans = notes.filter((note) => !visited.has(note.id)).map((note) => `<button class="page-item" style="--page-depth:0" data-page="${note.id}" title="${escapeHtml(note.title)}">${escapeHtml(compactTitle(note.title))}</button>`).join("");
  return result + orphans;
}

function compactTitle(title) {
  const words = String(title || "Sem titulo").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ") || "Sem titulo";
}

function renderShortcuts() {
  const byId = new Map(state.allNotes.map((note) => [note.id, note]));
  const recent = state.recentIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 6);
  const favorites = state.allNotes.filter((note) => note.favorite).slice(0, 8);
  const render = (target, notes, empty) => {
    target.innerHTML = notes.length ? notes.map((note) => `<button class="shortcut-item" data-shortcut-page="${note.id}" title="${escapeHtml(note.title)}">${escapeHtml(compactTitle(note.title))}</button>`).join("") : `<div class="shortcut-empty">${empty}</div>`;
    target.querySelectorAll("[data-shortcut-page]").forEach((button) => button.addEventListener("click", () => {
      openEditor(button.dataset.shortcutPage);
      closeMobileSidebar();
    }));
  };
  render($("#recent-list"), recent, "Abra uma pagina para ve-la aqui.");
  render($("#favorite-list"), favorites, "Nenhum favorito.");
}

function rememberRecent(id) {
  state.recentIds = [id, ...state.recentIds.filter((item) => item !== id)].slice(0, 12);
  localStorage.setItem("agendaDev.recentIds", JSON.stringify(state.recentIds));
  renderShortcuts();
}

function filteredNotes() {
  let notes = state.notes;
  if (state.sectionId) notes = notes.filter((n) => n.section_id === state.sectionId);
  return notes;
}

function renderCards() {
  const notes = filteredNotes();
  const cards = $("#cards");
  const empty = $("#empty-state");
  const title = $("#workspace-title");
  const meta = $("#workspace-meta");
  let heading = "Todas as paginas";
  if (state.notebookId) {
    const nb = state.notebooks.find((n) => n.id === state.notebookId);
    heading = nb ? nb.name : heading;
    if (state.sectionId && nb) {
      const sec = (nb.sections || []).find((s) => s.id === state.sectionId);
      if (sec) heading = `${nb.name} / ${sec.name}`;
    }
  }
  if (state.query) heading = `Resultados para "${state.query}"`;
  title.textContent = heading;
  meta.textContent = `${notes.length} pagina${notes.length === 1 ? "" : "s"}`;
  renderBreadcrumbs();
  if (!notes.length) {
    cards.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  cards.innerHTML = notes
    .map((n) => {
      const q = state.query;
      return `<article class="card" data-id="${n.id}">
        <div class="card-bar ${n.importance || "media"}"></div>
        <div class="card-body">
          <h3>${n.pinned ? '<span class="pin">*</span> ' : ""}${highlight(n.title, q)}</h3>
          <div class="card-excerpt">${highlight(excerpt(n.content), q)}</div>
        </div>
        <div class="card-foot">
          <span>${escapeHtml(n.notebook_name || "")} · ${escapeHtml(n.section_name || "")}</span>
          ${(n.tags || []).slice(0, 3).map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}
          <span class="imp-badge ${n.importance}">${n.importance}</span>
        </div>
      </article>`;
    })
    .join("");
  cards.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("click", () => openEditor(el.dataset.id));
  });
}

async function refreshNotes() {
  const data = await api(notesUrl());
  state.notes = data.notes || [];
  renderNotebooks();
  renderCards();
}

function renderBreadcrumbs(note = null) {
  const parts = [{ label: "Inicio", nb: "", sec: "" }];
  const nbId = note ? note.notebook_id : state.notebookId;
  const secId = note ? note.section_id : state.sectionId;
  const nb = state.notebooks.find((item) => item.id === nbId);
  if (nb) {
    parts.push({ label: nb.name, nb: nb.id, sec: "" });
    const sec = (nb.sections || []).find((item) => item.id === secId);
    if (sec) parts.push({ label: sec.name, nb: nb.id, sec: sec.id });
  }
  if (note) parts.push({ label: note.title || "Sem titulo", page: note.id });
  $("#breadcrumbs").innerHTML = parts.map((part, index) => `${index ? '<span class="separator">›</span>' : ""}<button data-crumb-nb="${part.nb || ""}" data-crumb-sec="${part.sec || ""}" ${part.page ? `data-crumb-page="${part.page}"` : ""}>${escapeHtml(part.label)}</button>`).join("");
  $("#breadcrumbs").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.crumbPage) return openEditor(button.dataset.crumbPage);
    state.notebookId = button.dataset.crumbNb || "";
    state.sectionId = button.dataset.crumbSec || "";
    refreshNotes();
  }));
}

function fillEditorNotebooks() {
  const nbSel = $("#ed-notebook");
  const current = nbSel.value;
  nbSel.innerHTML = state.notebooks
    .map((n) => `<option value="${n.id}">${escapeHtml(n.name)}</option>`)
    .join("");
  if (current) nbSel.value = current;
  fillEditorSections();
}

function fillEditorSections() {
  const nb = state.notebooks.find((n) => n.id === $("#ed-notebook").value);
  const secSel = $("#ed-section");
  const current = secSel.value;
  secSel.innerHTML = ((nb && nb.sections) || [])
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
    .join("");
  if (current) secSel.value = current;
}

function fillParentPages() {
  const select = $("#ed-parent");
  const current = select.value;
  const descendants = new Set();
  const collectDescendants = (parentId) => state.allNotes.filter((note) => note.parent_id === parentId).forEach((note) => {
    if (descendants.has(note.id)) return;
    descendants.add(note.id);
    collectDescendants(note.id);
  });
  if (state.editingId) collectDescendants(state.editingId);
  const notebookId = $("#ed-notebook").value;
  const sectionId = $("#ed-section").value;
  select.innerHTML = '<option value="">Nenhuma</option>' + state.allNotes
    .filter((note) => note.id !== state.editingId && !descendants.has(note.id) && note.notebook_id === notebookId && note.section_id === sectionId)
    .map((note) => `<option value="${note.id}">${escapeHtml(note.notebook_name || "")} / ${escapeHtml(note.section_name || "")} / ${escapeHtml(note.title)}</option>`)
    .join("");
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function openDrawer() {
  $("#editor").classList.remove("hidden");
}
function closeDrawer() {
  $("#editor").classList.add("hidden");
  state.editingId = null;
  renderBreadcrumbs();
}

function setPreview() {
  renderLinkEditor();
}

function editableLinks(content) {
  const found = [];
  const seen = new Set();
  const markdown = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let match;
  while ((match = markdown.exec(content))) {
    const raw = match[0];
    seen.add(raw);
    found.push({ raw, label: match[1], url: match[2] });
  }
  const plain = /https?:\/\/[^\s<>()\[\]]+|www\.[^\s<>()\[\]]+|\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
  while ((match = plain.exec(content))) {
    const raw = match[0];
    if (seen.has(raw) || found.some((link) => link.url === raw || link.url.replace(/^https:\/\//, "") === raw)) continue;
    const url = raw.includes("@") && !raw.includes("://") ? `mailto:${raw}` : raw.startsWith("www.") ? `https://${raw}` : raw;
    found.push({ raw, label: raw, url });
  }
  return found;
}

function renderLinkEditor() {
  const links = editableLinks($("#ed-content").value);
  const box = $("#ed-links");
  if (!links.length) {
    box.innerHTML = '<p class="links-empty">Nenhum link nesta nota.</p>';
    return;
  }
  box.innerHTML = links.map((link, index) => `
    <div class="link-row" data-index="${index}">
      <a class="link-open" href="${escapeHtml(link.url)}" target="_blank" rel="noopener" title="Abrir link">Abrir</a>
      <div class="link-fields">
        <input class="link-label" value="${escapeHtml(link.label)}" aria-label="Texto do link">
        <input class="link-url" value="${escapeHtml(link.url)}" aria-label="Endereco do link">
      </div>
      <button class="icon-btn link-remove" title="Remover link">✕</button>
    </div>`).join("");
  box.querySelectorAll(".link-row").forEach((row) => {
    const link = links[Number(row.dataset.index)];
    row.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
      const label = row.querySelector(".link-label").value.trim();
      const url = row.querySelector(".link-url").value.trim();
      if (!url) return;
      const replacement = label && label !== url ? `[${label}](${url})` : url.replace(/^mailto:/, "");
      const editor = $("#ed-content");
      editor.value = editor.value.replace(link.raw, replacement);
      setPreview();
    }));
    row.querySelector(".link-remove").addEventListener("click", () => {
      const editor = $("#ed-content");
      editor.value = editor.value.replace(link.raw, "");
      setPreview();
    });
  });
}

function openPreview() {
  $("#preview-title").textContent = $("#ed-title").value.trim() || "Sem titulo";
  $("#ed-preview").innerHTML = linkify($("#ed-content").value);
  $("#preview-modal").classList.remove("hidden");
}

async function openEditor(id) {
  fillEditorNotebooks();
  if (!id) {
    state.editingId = null;
    $("#ed-title").value = "";
    $("#ed-content").value = "";
    $("#ed-importance").value = "media";
    $("#ed-tags").value = "";
    $("#ed-due").value = "";
    $("#ed-pin").textContent = "Fixar";
    $("#ed-pin").dataset.pinned = "0";
    $("#ed-favorite").dataset.favorite = "0";
    $("#ed-favorite").textContent = "☆ Favorito";
    if (state.notebookId) $("#ed-notebook").value = state.notebookId;
    fillEditorSections();
    if (state.sectionId) $("#ed-section").value = state.sectionId;
    fillParentPages();
    $("#ed-parent").value = "";
    setPreview();
    openDrawer();
    $("#ed-title").focus();
    return;
  }
  const data = await api(`/api/notes/${id}`);
  const n = data.note;
  state.editingId = n.id;
  rememberRecent(n.id);
  $("#ed-title").value = n.title || "";
  $("#ed-content").value = n.content || "";
  $("#ed-importance").value = n.importance || "media";
  $("#ed-tags").value = (n.tags || []).join(", ");
  $("#ed-due").value = (n.due || "").slice(0, 10);
  $("#ed-pin").dataset.pinned = n.pinned ? "1" : "0";
  $("#ed-pin").textContent = n.pinned ? "Fixada" : "Fixar";
  $("#ed-favorite").dataset.favorite = n.favorite ? "1" : "0";
  $("#ed-favorite").textContent = n.favorite ? "★ Favorita" : "☆ Favorito";
  $("#ed-notebook").value = n.notebook_id || "";
  fillEditorSections();
  $("#ed-section").value = n.section_id || "";
  fillParentPages();
  $("#ed-parent").value = n.parent_id || "";
  setPreview();
  openDrawer();
  renderBreadcrumbs(n);
}

function gatherNote() {
  const nb = state.notebooks.find((n) => n.id === $("#ed-notebook").value);
  const sec = ((nb && nb.sections) || []).find((s) => s.id === $("#ed-section").value);
  return {
    id: state.editingId,
    title: $("#ed-title").value.trim() || "Sem titulo",
    content: $("#ed-content").value,
    importance: $("#ed-importance").value,
    tags: $("#ed-tags").value.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
    notebook_id: $("#ed-notebook").value,
    section_id: $("#ed-section").value,
    notebook: nb ? nb.name : "Geral",
    section: sec ? sec.name : "Notas",
    due: $("#ed-due").value || null,
    pinned: $("#ed-pin").dataset.pinned === "1",
    favorite: $("#ed-favorite").dataset.favorite === "1",
    parent_id: $("#ed-parent").value || null,
  };
}

async function saveNote() {
  const payload = gatherNote();
  if (payload.id) {
    await api(`/api/notes/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) });
    toast("Pagina salva");
  } else {
    const data = await api("/api/notes", { method: "POST", body: JSON.stringify(payload) });
    state.editingId = data.note.id;
    toast("Pagina criada");
  }
  await loadAll();
  rememberRecent(state.editingId);
}

const commandActions = [
  { id: "new", label: "Criar nova pagina", hint: "Ctrl N", run: () => openEditor(null) },
  { id: "home", label: "Ir para todas as paginas", hint: "Navegacao", run: () => { state.notebookId = ""; state.sectionId = ""; refreshNotes(); } },
  { id: "import", label: "Importar arquivo TXT", hint: "Acao", run: () => $("#import-modal").classList.remove("hidden") },
  { id: "report", label: "Abrir relatorios e backups", hint: "Acao", run: openReport },
  { id: "sidebar", label: "Alternar barra lateral", hint: "Interface", run: toggleSidebar },
];

function openCommandPalette() {
  $("#command-modal").classList.remove("hidden");
  $("#command-input").value = "";
  renderCommandResults("");
  setTimeout(() => $("#command-input").focus(), 0);
}

function closeCommandPalette() {
  $("#command-modal").classList.add("hidden");
}

function renderCommandResults(query) {
  const needle = query.trim().toLocaleLowerCase("pt-BR");
  const actions = commandActions.filter((action) => action.label.toLocaleLowerCase("pt-BR").includes(needle));
  const pages = state.allNotes.filter((note) => `${note.title} ${note.content || ""}`.toLocaleLowerCase("pt-BR").includes(needle)).slice(0, 10);
  const results = [
    ...actions.map((action) => ({ type: "action", id: action.id, label: action.label, hint: action.hint })),
    ...pages.map((note) => ({ type: "page", id: note.id, label: note.title, hint: `${note.notebook_name || ""} / ${note.section_name || ""}` })),
  ];
  $("#command-results").innerHTML = results.length ? results.map((item, index) => `<button class="command-result ${index === 0 ? "selected" : ""}" data-command-type="${item.type}" data-command-id="${item.id}"><span>${item.type === "page" ? "▤" : "→"}</span><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.hint)}</small></button>`).join("") : '<div class="shortcut-empty">Nenhum resultado.</div>';
  $("#command-results").querySelectorAll(".command-result").forEach((button) => button.addEventListener("click", () => executeCommand(button)));
}

function executeCommand(button) {
  closeCommandPalette();
  if (button.dataset.commandType === "page") return openEditor(button.dataset.commandId);
  const action = commandActions.find((item) => item.id === button.dataset.commandId);
  if (action) action.run();
}

function toggleSidebar() {
  const shell = $("#app");
  if (window.matchMedia("(max-width: 900px)").matches) {
    shell.classList.toggle("sidebar-mobile-open");
    return;
  }
  shell.classList.toggle("sidebar-collapsed");
  localStorage.setItem("agendaDev.sidebarCollapsed", shell.classList.contains("sidebar-collapsed") ? "1" : "0");
}

function closeMobileSidebar() {
  $("#app").classList.remove("sidebar-mobile-open");
}

function applySidebarPreferences() {
  const width = Math.max(220, Math.min(420, Number(localStorage.getItem("agendaDev.sidebarWidth")) || 260));
  document.documentElement.style.setProperty("--sidebar", `${width}px`);
  if (localStorage.getItem("agendaDev.sidebarCollapsed") === "1") $("#app").classList.add("sidebar-collapsed");
  updatePageTreeToggle();
}

function updatePageTreeToggle() {
  const button = $("#btn-toggle-page-tree");
  button.textContent = state.pageTreeCollapsed ? "+" : "−";
  button.title = state.pageTreeCollapsed ? "Mostrar paginas" : "Recolher paginas";
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-expanded", state.pageTreeCollapsed ? "false" : "true");
}

function togglePageTree() {
  state.pageTreeCollapsed = !state.pageTreeCollapsed;
  localStorage.setItem("agendaDev.pageTreeCollapsed", state.pageTreeCollapsed ? "1" : "0");
  updatePageTreeToggle();
  renderNotebooks();
}

function bindSidebarResize() {
  let resizing = false;
  $("#sidebar-resizer").addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    resizing = true;
    event.target.setPointerCapture(event.pointerId);
  });
  $("#sidebar-resizer").addEventListener("pointermove", (event) => {
    if (!resizing) return;
    const width = Math.max(220, Math.min(420, event.clientX - 48));
    document.documentElement.style.setProperty("--sidebar", `${width}px`);
    localStorage.setItem("agendaDev.sidebarWidth", String(width));
  });
  $("#sidebar-resizer").addEventListener("pointerup", () => { resizing = false; });
}

function bindEvents() {
  let t;
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    clearTimeout(t);
    t = setTimeout(refreshNotes, 120);
  });
  $$("#importance-filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $$("#importance-filters .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.importance = chip.dataset.imp || "";
      refreshNotes();
    });
  });
  $("#btn-refresh").addEventListener("click", async () => {
    const button = $("#btn-refresh");
    button.disabled = true;
    button.textContent = "Atualizando...";
    try {
      const data = await api("/api/import-folder", { method: "POST" });
      await loadAll();
      toast(data.imported ? `${data.imported} nota(s) carregada(s)` : "Interface atualizada");
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = "Atualizar interface";
    }
  });
  $("#btn-new-page").addEventListener("click", () => openEditor(null));
  $("#btn-new-note").addEventListener("click", () => openEditor(null));
  $("#editor-close").addEventListener("click", closeDrawer);
  $("#ed-save").addEventListener("click", saveNote);
  $("#ed-content").addEventListener("input", setPreview);
  $("#ed-notebook").addEventListener("change", () => {
    fillEditorSections();
    fillParentPages();
  });
  $("#ed-section").addEventListener("change", fillParentPages);
  $("#ed-pin").addEventListener("click", () => {
    const on = $("#ed-pin").dataset.pinned !== "1";
    $("#ed-pin").dataset.pinned = on ? "1" : "0";
    $("#ed-pin").textContent = on ? "Fixada" : "Fixar";
  });
  $("#ed-favorite").addEventListener("click", () => {
    const on = $("#ed-favorite").dataset.favorite !== "1";
    $("#ed-favorite").dataset.favorite = on ? "1" : "0";
    $("#ed-favorite").textContent = on ? "★ Favorita" : "☆ Favorito";
  });
  $("#ed-delete").addEventListener("click", async () => {
    if (!state.editingId) return closeDrawer();
    if (!confirm("Excluir esta pagina?")) return;
    await api(`/api/notes/${state.editingId}`, { method: "DELETE" });
    closeDrawer();
    toast("Pagina excluida");
    loadAll();
  });
  $("#ed-preview-btn").addEventListener("click", openPreview);
  $("#preview-close").addEventListener("click", () => $("#preview-modal").classList.add("hidden"));
  $("#ed-add-link").addEventListener("click", () => {
    const editor = $("#ed-content");
    const url = prompt("Endereco do link:");
    if (!url) return;
    const label = prompt("Texto exibido (opcional):");
    const normalized = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
    editor.value += `${editor.value && !editor.value.endsWith("\n") ? "\n" : ""}${label ? `[${label}](${normalized})` : normalized}`;
    setPreview();
  });
  $("#ed-export").addEventListener("click", () => {
    if (!state.editingId) return toast("Salve a pagina primeiro");
    $("#ed-export-options").classList.toggle("hidden");
  });
  $$("[data-export]").forEach((button) => button.addEventListener("click", async () => {
    if (!state.editingId) return toast("Salve a pagina primeiro");
    $("#ed-export-options").classList.add("hidden");
    const format = button.dataset.export;
    try {
      if (window.pywebview && window.pywebview.api) {
        const result = await window.pywebview.api.save_note_export(state.editingId, format);
        if (result.ok) toast("Arquivo exportado");
        else if (!result.cancelled) toast(result.error || "Nao foi possivel exportar");
        return;
      }
      window.location = `/api/export/${state.editingId}.${format}`;
    } catch (err) {
      toast(err.message || "Nao foi possivel exportar");
    }
  }));
  $("#btn-import").addEventListener("click", () => $("#import-modal").classList.remove("hidden"));
  $("#import-cancel").addEventListener("click", () => $("#import-modal").classList.add("hidden"));
  $("#import-go").addEventListener("click", async () => {
    const file = $("#import-file").files[0];
    const notebook = $("#import-notebook").value || "Importados";
    try {
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("notebook", notebook);
        const res = await fetch("/api/import-txt", { method: "POST", body: fd });
        const data = await res.json();
        toast(`${data.imported} nota(s) importada(s)`);
      } else {
        const text = $("#import-text").value;
        if (!text.trim()) return toast("Cole um texto ou escolha um arquivo");
        const data = await api("/api/import-txt", {
          method: "POST",
          body: JSON.stringify({ text, notebook, filename: "colar.txt" }),
        });
        toast(`${data.imported} nota(s) importada(s)`);
      }
      $("#import-modal").classList.add("hidden");
      $("#import-text").value = "";
      $("#import-file").value = "";
      await loadAll();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#btn-new-notebook").addEventListener("click", () => $("#notebook-modal").classList.remove("hidden"));
  $("#btn-toggle-sidebar").addEventListener("click", toggleSidebar);
  $("#btn-collapse-sidebar").addEventListener("click", toggleSidebar);
  $("#btn-command").addEventListener("click", openCommandPalette);
  $("#btn-toggle-page-tree").addEventListener("click", togglePageTree);
  $("#command-input").addEventListener("input", (event) => renderCommandResults(event.target.value));
  $("#command-input").addEventListener("keydown", (event) => {
    const buttons = $$("#command-results .command-result");
    if (!buttons.length) return;
    let index = Math.max(0, buttons.findIndex((button) => button.classList.contains("selected")));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      buttons[index].classList.remove("selected");
      index = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index].classList.add("selected");
      buttons[index].scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter") {
      event.preventDefault();
      executeCommand(buttons[index]);
    }
  });
  $("#nb-cancel").addEventListener("click", () => $("#notebook-modal").classList.add("hidden"));
  $("#nb-go").addEventListener("click", async () => {
    const name = $("#nb-name").value.trim();
    if (!name) return toast("Informe o nome");
    await api("/api/notebooks", {
      method: "POST",
      body: JSON.stringify({ name, color: $("#nb-color").value }),
    });
    $("#notebook-modal").classList.add("hidden");
    $("#nb-name").value = "";
    toast("Caderno criado");
    loadAll();
  });
  $$(".rail-btn[data-view]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      $$(".rail-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (btn.dataset.view === "search") $("#search").focus();
      if (btn.dataset.view === "report") openReport();
      if (btn.dataset.view === "home") {
        state.notebookId = "";
        state.sectionId = "";
        refreshNotes();
      }
    });
  });
  $("#report-close").addEventListener("click", () => $("#report-modal").classList.add("hidden"));
  $("#backup-folder").addEventListener("click", async () => {
    if (!(window.pywebview && window.pywebview.api)) return toast("O backup em pasta esta disponivel no aplicativo instalado");
    const button = $("#backup-folder");
    button.disabled = true;
    try {
      const result = await window.pywebview.api.export_agenda_backup();
      if (result.ok) toast("Backup completo exportado");
      else if (!result.cancelled) toast(result.error || "Nao foi possivel criar o backup");
    } catch (err) {
      toast(err.message || "Nao foi possivel criar o backup");
    } finally {
      button.disabled = false;
    }
  });
  $("#restore-folder").addEventListener("click", async () => {
    if (!(window.pywebview && window.pywebview.api)) return toast("A restauracao em pasta esta disponivel no aplicativo instalado");
    if (!confirm("Restaurar este backup vai substituir a agenda atual. Uma copia de seguranca sera criada automaticamente. Continuar?")) return;
    const button = $("#restore-folder");
    button.disabled = true;
    try {
      const result = await window.pywebview.api.restore_agenda_backup();
      if (result.ok) {
        await loadAll();
        $("#report-modal").classList.add("hidden");
        toast(`Backup restaurado: ${result.notes} nota(s)`);
      } else if (!result.cancelled) {
        toast(result.error || "Nao foi possivel restaurar o backup");
      }
    } catch (err) {
      toast(err.message || "Nao foi possivel restaurar o backup");
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCommandPalette();
      closeDrawer();
      $("#import-modal").classList.add("hidden");
      $("#notebook-modal").classList.add("hidden");
      $("#report-modal").classList.add("hidden");
      $("#preview-modal").classList.add("hidden");
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCommandPalette();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !$("#editor").classList.contains("hidden")) {
      e.preventDefault();
      saveNote();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openEditor(null);
    }
  });
}

async function openReport() {
  const s = await api("/api/stats");
  $("#report-stats").innerHTML = `
    <div class="stat-box"><b>${s.total}</b><span>Notas</span></div>
    <div class="stat-box"><b>${s.pinned}</b><span>Fixadas</span></div>
    <div class="stat-box"><b>${s.links}</b><span>Links</span></div>
    <div class="stat-box"><b>${s.by_importance.urgente}</b><span>Urgente</span></div>
    <div class="stat-box"><b>${s.by_importance.alta}</b><span>Alta</span></div>
    <div class="stat-box"><b>${s.by_importance.media}</b><span>Media</span></div>
    <div class="stat-box"><b>${s.by_importance.baixa}</b><span>Baixa</span></div>
  `;
  $("#report-modal").classList.remove("hidden");
}

applySidebarPreferences();
bindEvents();
bindSidebarResize();
loadAll().catch((err) => toast(err.message));
