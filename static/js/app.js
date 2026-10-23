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
  collapsedNotebooks: JSON.parse(localStorage.getItem("agendaDev.collapsedNotebooks") || "[]"),
  blockEditor: null,
  editorDirty: false,
  autosaveTimer: null,
  saveInFlight: null,
  editorVersion: 0,
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
  const isForm = opts.body instanceof FormData;
  const res = await fetch(path, {
    headers: isForm ? { ...(opts.headers || {}) } : { "Content-Type": "application/json", ...(opts.headers || {}) },
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

function openExternalLink(url) {
  if (window.pywebview?.api?.open_external) {
    window.pywebview.api.open_external(url).then((result) => {
      if (!result?.ok) toast(result?.error || "Nao foi possivel abrir o link");
    }).catch(() => toast("Nao foi possivel abrir o link"));
    return;
  }
  window.open(url, "_blank", "noopener");
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
    const collapsed = state.collapsedNotebooks.includes(nb.id);
    html += `<div class="nb-item">
      <div class="nb-row">
        <button class="nb-head ${open && !state.sectionId ? "active" : ""}" data-nb="${nb.id}">
          <span class="nb-dot" style="background:${nb.color || "#7719aa"}"></span>
          <span>${escapeHtml(nb.name)}</span>
          <span class="nb-count">${counts[nb.id] || 0}</span>
        </button>
        <button class="nb-toggle" data-toggle-nb="${nb.id}" title="${collapsed ? "Expandir" : "Recolher"} ${escapeHtml(nb.name)}" aria-label="${collapsed ? "Expandir" : "Recolher"} ${escapeHtml(nb.name)}" aria-expanded="${collapsed ? "false" : "true"}">${collapsed ? "+" : "−"}</button>
      </div>`;
    if (!collapsed) {
      (nb.sections || []).forEach((sec) => {
        html += `<button class="sec-item ${state.sectionId === sec.id ? "active" : ""}" data-nb="${nb.id}" data-sec="${sec.id}">${escapeHtml(sec.name)}</button>`;
        html += renderPageTree(state.allNotes.filter((n) => n.section_id === sec.id));
      });
      html += `<button class="add-sec" data-add-sec="${nb.id}">+ Secao</button>`;
    }
    html += `</div>`;
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
  list.querySelectorAll("[data-toggle-nb]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const id = button.dataset.toggleNb;
    state.collapsedNotebooks = state.collapsedNotebooks.includes(id)
      ? state.collapsedNotebooks.filter((item) => item !== id)
      : [...state.collapsedNotebooks, id];
    localStorage.setItem("agendaDev.collapsedNotebooks", JSON.stringify(state.collapsedNotebooks));
    renderNotebooks();
  }));
  list.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.stopPropagation();
    openEditor(btn.dataset.page);
    closeMobileSidebar();
  }));
}

function renderPageTree(notes) {
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
async function closeDrawer() {
  try {
    await flushAutosave();
  } catch (_) {
    toast("Nao foi possivel salvar. O editor continuara aberto.");
    return;
  }
  $("#editor").classList.add("hidden");
  state.editingId = null;
  renderBreadcrumbs();
}

function setPreview() {
  if (state.blockEditor) $("#ed-content").value = state.blockEditor.plainText();
  renderLinkEditor();
}

function renderBlockPreview(blocks) {
  return (blocks || []).map((block) => {
    const text = linkify(block.text || "");
    if (block.type === "heading_1") return `<h1>${text}</h1>`;
    if (block.type === "heading_2") return `<h2>${text}</h2>`;
    if (block.type === "heading_3") return `<h3>${text}</h3>`;
    if (block.type === "bulleted_list") return `<div>• ${text}</div>`;
    if (block.type === "numbered_list") return `<div>${text}</div>`;
    if (block.type === "checklist") return `<div>${block.checked ? "☑" : "☐"} ${text}</div>`;
    if (block.type === "quote") return `<blockquote>${text}</blockquote>`;
    if (block.type === "divider") return "<hr>";
    if (block.type === "image" && block.asset && block.asset.id) {
      const width = Math.min(100, Math.max(20, Number(block.width) || 100));
      const align = ["left", "center", "right"].includes(block.align) ? block.align : "center";
      const crop = block.crop || {};
      const ratios = { square: "1 / 1", landscape: "16 / 9", classic: "4 / 3", portrait: "3 / 4" };
      const ratio = ratios[crop.ratio];
      const margin = align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0 auto 0 0";
      const zoom = Math.min(250, Math.max(100, Number.isFinite(Number(crop.zoom)) ? Number(crop.zoom) : 100));
      const x = Math.min(100, Math.max(0, Number.isFinite(Number(crop.x)) ? Number(crop.x) : 50));
      const y = Math.min(100, Math.max(0, Number.isFinite(Number(crop.y)) ? Number(crop.y) : 50));
      const frameStyle = ratio ? `aspect-ratio:${ratio};overflow:hidden;position:relative` : "";
      const imageStyle = ratio ? `width:100%;height:100%;object-fit:cover;object-position:${x}% ${y}%;transform:scale(${zoom / 100})` : "max-width:100%;max-height:520px";
      return `<figure style="width:${width}%;${margin}"><div style="${frameStyle}"><img src="/api/assets/${encodeURIComponent(block.asset.id)}" alt="${escapeHtml(block.text || block.asset.filename || "Imagem")}" style="display:block;${imageStyle}"></div><figcaption>${text}</figcaption></figure>`;
    }
    return `<p>${text || "<br>"}</p>`;
  }).join("");
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
        <input class="link-label" value="${escapeHtml(link.label)}" placeholder="Nome exibido (máscara)" title="Nome exibido (máscara)" aria-label="Nome exibido ou máscara do link">
        <input class="link-url" value="${escapeHtml(link.url)}" placeholder="Endereço do link" title="Endereço real do link" aria-label="Endereco do link">
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
      state.blockEditor.replaceText(link.raw, replacement);
    }));
    row.querySelector(".link-remove").addEventListener("click", () => {
      state.blockEditor.replaceText(link.raw, "");
    });
  });
}

function updateLinkMaskPreview() {
  const label = $("#link-label").value.trim();
  const url = $("#link-url").value.trim();
  $("#link-mask-preview").innerHTML = label
    ? `Aparecerá como: <strong>${escapeHtml(label)}</strong>`
    : url
      ? `Aparecerá como: <strong>${escapeHtml(url)}</strong>`
      : "O link aparecerá com o endereço completo.";
}

function openLinkModal() {
  $("#link-url").value = "";
  $("#link-label").value = "";
  updateLinkMaskPreview();
  $("#link-modal").classList.remove("hidden");
  setTimeout(() => $("#link-url").focus(), 0);
}

function closeLinkModal() {
  $("#link-modal").classList.add("hidden");
}

function addMaskedLink() {
  const rawUrl = $("#link-url").value.trim();
  const label = $("#link-label").value.trim().replace(/[\[\]]/g, "");
  if (!rawUrl) return toast("Informe o endereco do link");
  const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (_) {
    return toast("Endereco de link invalido");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return toast("Use um link HTTP ou HTTPS");
  const link = label ? `[${label}](${parsed.href})` : parsed.href;
  state.blockEditor.appendText(link);
  closeLinkModal();
  toast(label ? `Link exibido como “${label}”` : "Link adicionado");
}

function openPreview() {
  $("#preview-title").textContent = $("#ed-title").value.trim() || "Sem titulo";
  $("#ed-preview").innerHTML = renderBlockPreview(state.blockEditor.getBlocks());
  $("#preview-modal").classList.remove("hidden");
}

async function openEditor(id) {
  fillEditorNotebooks();
  if (!id) {
    state.editingId = null;
    $("#ed-title").value = "";
    $("#ed-content").value = "";
    state.blockEditor.setBlocks([]);
    state.blockEditor.setLayout("flow", false);
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
    setSaveStatus("Salvo");
    state.editorDirty = false;
    state.editorVersion = 0;
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
  state.blockEditor.setBlocks(n.blocks || [{ type: "paragraph", text: n.content || "" }]);
  state.blockEditor.setLayout(n.layout || "flow", false);
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
  setSaveStatus("Salvo");
  state.editorDirty = false;
  state.editorVersion = 0;
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
    content: state.blockEditor.plainText(),
    blocks: state.blockEditor.getBlocks(),
    layout: state.blockEditor.getLayout(),
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

function setSaveStatus(text, kind = "") {
  const status = $("#save-status");
  status.textContent = text;
  status.className = `save-status ${kind}`.trim();
}

function markEditorDirty() {
  if ($("#editor").classList.contains("hidden")) return;
  state.editorDirty = true;
  state.editorVersion += 1;
  setSaveStatus("Nao salvo");
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => saveNote({ silent: true }).catch(() => {}), 900);
}

async function flushAutosave() {
  clearTimeout(state.autosaveTimer);
  if (state.editorDirty) await saveNote({ silent: true });
}

async function saveNote({ silent = false } = {}) {
  if (state.saveInFlight) await state.saveInFlight;
  const payload = gatherNote();
  const savingVersion = state.editorVersion;
  const meaningful = payload.title !== "Sem titulo" || payload.blocks.some((block) => block.text.trim() || block.type === "divider" || block.type === "image");
  if (!payload.id && !meaningful) return;
  setSaveStatus("Salvando...", "saving");
  state.saveInFlight = (async () => {
    try {
      if (payload.id) {
        await api(`/api/notes/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) });
        if (!silent) toast("Pagina salva");
      } else {
        const data = await api("/api/notes", { method: "POST", body: JSON.stringify(payload) });
        state.editingId = data.note.id;
        if (!silent) toast("Pagina criada");
      }
      if (state.editorVersion === savingVersion) {
        state.editorDirty = false;
        setSaveStatus("Salvo");
      } else {
        state.editorDirty = true;
        setSaveStatus("Nao salvo");
        clearTimeout(state.autosaveTimer);
        state.autosaveTimer = setTimeout(() => saveNote({ silent: true }).catch(() => {}), 350);
      }
      await loadAll();
      rememberRecent(state.editingId);
    } catch (error) {
      state.editorDirty = true;
      setSaveStatus("Erro ao salvar", "error");
      if (!silent) toast(error.message);
      throw error;
    } finally {
      state.saveInFlight = null;
    }
  })();
  return state.saveInFlight;
}

function initBlockEditor() {
  state.blockEditor = new window.AgendaBlockEditor($("#block-editor"), $("#slash-menu"), {
    onChange: () => {
      setPreview();
      markEditorDirty();
    },
    onImageFiles: uploadImages,
    onOpenLink: openExternalLink,
  });
  state.blockEditor.setBlocks([]);
  state.blockEditor.setLayout("flow", false);
  $("#block-layout").addEventListener("click", () => {
    state.blockEditor.setLayout(state.blockEditor.getLayout() === "free" ? "flow" : "free");
  });
}

async function uploadImages(files) {
  const images = [...files].filter((file) => file.type.startsWith("image/"));
  if (!images.length) return toast("Escolha uma imagem PNG, JPEG, WebP ou GIF");
  setSaveStatus("Enviando imagem...", "saving");
  for (const file of images) {
    const form = new FormData();
    form.append("file", file, file.name || "imagem");
    try {
      const data = await api("/api/assets", { method: "POST", body: form });
      state.blockEditor.insertImage(data.asset);
    } catch (error) {
      setSaveStatus("Erro na imagem", "error");
      toast(error.message);
      return;
    }
  }
  toast(`${images.length} imagem${images.length === 1 ? " inserida" : "s inseridas"}`);
}

function applyTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem("agendaDev.theme", selected);
  const button = $("#btn-theme");
  button.innerHTML = selected === "dark" ? '<span aria-hidden="true">☀</span> <span class="theme-label">Modo claro</span>' : '<span aria-hidden="true">☾</span> <span class="theme-label">Modo escuro</span>';
  button.title = selected === "dark" ? "Usar modo claro" : "Usar modo escuro";
  button.setAttribute("aria-label", button.title);
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
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
  $("#ed-notebook").addEventListener("change", () => {
    fillEditorSections();
    fillParentPages();
    markEditorDirty();
  });
  $("#ed-section").addEventListener("change", () => {
    fillParentPages();
    markEditorDirty();
  });
  ["#ed-title", "#ed-tags", "#ed-due"].forEach((selector) => $(selector).addEventListener("input", markEditorDirty));
  ["#ed-importance", "#ed-parent"].forEach((selector) => $(selector).addEventListener("change", markEditorDirty));
  $("#block-undo").addEventListener("click", () => state.blockEditor.undo());
  $("#block-redo").addEventListener("click", () => state.blockEditor.redo());
  $("#block-image").addEventListener("click", () => $("#block-image-file").click());
  $("#block-image-file").addEventListener("change", (event) => {
    uploadImages(event.target.files);
    event.target.value = "";
  });
  $("#btn-theme").addEventListener("click", toggleTheme);
  $("#ed-pin").addEventListener("click", () => {
    const on = $("#ed-pin").dataset.pinned !== "1";
    $("#ed-pin").dataset.pinned = on ? "1" : "0";
    $("#ed-pin").textContent = on ? "Fixada" : "Fixar";
    markEditorDirty();
  });
  $("#ed-favorite").addEventListener("click", () => {
    const on = $("#ed-favorite").dataset.favorite !== "1";
    $("#ed-favorite").dataset.favorite = on ? "1" : "0";
    $("#ed-favorite").textContent = on ? "★ Favorita" : "☆ Favorito";
    markEditorDirty();
  });
  $("#ed-delete").addEventListener("click", async () => {
    if (!state.editingId) return closeDrawer();
    if (!confirm("Excluir esta pagina?")) return;
    clearTimeout(state.autosaveTimer);
    state.editorDirty = false;
    await api(`/api/notes/${state.editingId}`, { method: "DELETE" });
    closeDrawer();
    toast("Pagina excluida");
    loadAll();
  });
  $("#ed-preview-btn").addEventListener("click", openPreview);
  $("#preview-close").addEventListener("click", () => $("#preview-modal").classList.add("hidden"));
  $("#ed-add-link").addEventListener("click", openLinkModal);
  $("#link-cancel").addEventListener("click", closeLinkModal);
  $("#link-add").addEventListener("click", addMaskedLink);
  $("#link-label").addEventListener("input", updateLinkMaskPreview);
  $("#link-url").addEventListener("input", updateLinkMaskPreview);
  $("#link-modal").addEventListener("click", (event) => { if (event.target.id === "link-modal") closeLinkModal(); });
  $("#link-modal").addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLinkModal();
    if (event.key === "Enter") addMaskedLink();
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

initBlockEditor();
applyTheme(document.documentElement.dataset.theme);
applySidebarPreferences();
bindEvents();
bindSidebarResize();
loadAll().catch((err) => toast(err.message));
