(function () {
  const TYPES = {
    paragraph: { label: "Texto", placeholder: "Digite algo ou use / para comandos" },
    heading_1: { label: "Titulo 1", placeholder: "Titulo principal" },
    heading_2: { label: "Titulo 2", placeholder: "Subtitulo" },
    heading_3: { label: "Titulo 3", placeholder: "Titulo menor" },
    bulleted_list: { label: "Lista", placeholder: "Item da lista" },
    numbered_list: { label: "Lista numerada", placeholder: "Item numerado" },
    checklist: { label: "Checklist", placeholder: "Tarefa" },
    quote: { label: "Citacao", placeholder: "Citacao" },
    divider: { label: "Divisor", placeholder: "" },
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const blockId = () => `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  class AgendaBlockEditor {
    constructor(root, menu, options = {}) {
      this.root = root;
      this.menu = menu;
      this.onChange = options.onChange || (() => {});
      this.blocks = [];
      this.history = [];
      this.historyIndex = -1;
      this.draggedId = null;
      this.dropPosition = "before";
      this.menuBlockId = null;
      this.silent = false;
      this.bind();
    }

    normalize(blocks) {
      const seen = new Set();
      const normalized = (Array.isArray(blocks) ? blocks : []).filter((block) => block && typeof block === "object").map((block) => {
        let id = String(block.id || blockId());
        if (seen.has(id)) id = blockId();
        seen.add(id);
        const type = TYPES[block.type] ? block.type : "paragraph";
        return { id, type, text: String(block.text || ""), ...(type === "checklist" ? { checked: Boolean(block.checked) } : {}) };
      });
      return normalized.length ? normalized : [{ id: blockId(), type: "paragraph", text: "" }];
    }

    setBlocks(blocks) {
      this.blocks = this.normalize(blocks);
      this.history = [clone(this.blocks)];
      this.historyIndex = 0;
      this.render();
    }

    getBlocks() {
      this.syncFromDom();
      return clone(this.blocks);
    }

    plainText() {
      return this.getBlocks().map((block, index) => {
        if (block.type === "divider") return "---";
        if (block.type === "checklist") return `[${block.checked ? "x" : " "}] ${block.text}`;
        if (block.type === "bulleted_list") return `- ${block.text}`;
        if (block.type === "numbered_list") return `${index + 1}. ${block.text}`;
        return block.text;
      }).join("\n");
    }

    appendText(text) {
      const last = this.blocks[this.blocks.length - 1];
      if (last && last.type === "paragraph" && !last.text) last.text = text;
      else this.blocks.push({ id: blockId(), type: "paragraph", text });
      this.commit();
      this.focusBlock(this.blocks[this.blocks.length - 1].id, true);
    }

    replaceText(search, replacement) {
      const block = this.blocks.find((item) => item.text.includes(search));
      if (!block) return false;
      block.text = block.text.replace(search, replacement);
      this.commit();
      return true;
    }

    bind() {
      this.root.addEventListener("input", (event) => {
        const row = event.target.closest(".block-row");
        if (!row) return;
        this.syncFromDom();
        if (event.target.classList.contains("block-input") && event.target.textContent.startsWith("/")) this.openMenu(row.dataset.id, event.target.textContent.slice(1));
        else this.closeMenu();
        this.record();
      });
      this.root.addEventListener("change", (event) => {
        if (!event.target.matches(".block-check")) return;
        this.syncFromDom();
        this.record();
      });
      this.root.addEventListener("click", (event) => {
        const action = event.target.closest("[data-block-action]");
        if (!action) return;
        const row = action.closest(".block-row");
        if (action.dataset.blockAction === "delete") this.removeBlock(row.dataset.id);
        if (action.dataset.blockAction === "up") this.moveBlock(row.dataset.id, -1);
        if (action.dataset.blockAction === "down") this.moveBlock(row.dataset.id, 1);
      });
      this.root.addEventListener("keydown", (event) => this.onKeydown(event));
      this.root.addEventListener("dragstart", (event) => {
        const row = event.target.closest(".block-row");
        if (!row) return;
        this.draggedId = row.dataset.id;
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", this.draggedId);
      });
      this.root.addEventListener("dragover", (event) => {
        event.preventDefault();
        const row = event.target.closest(".block-row");
        this.root.querySelectorAll(".drop-before, .drop-after").forEach((item) => item.classList.remove("drop-before", "drop-after"));
        if (!row || row.dataset.id === this.draggedId) return;
        const rect = row.getBoundingClientRect();
        this.dropPosition = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        row.classList.add(this.dropPosition === "before" ? "drop-before" : "drop-after");
      });
      this.root.addEventListener("drop", (event) => {
        event.preventDefault();
        const target = event.target.closest(".block-row");
        if (!target || !this.draggedId || target.dataset.id === this.draggedId) return;
        const from = this.blocks.findIndex((block) => block.id === this.draggedId);
        let to = this.blocks.findIndex((block) => block.id === target.dataset.id);
        const [block] = this.blocks.splice(from, 1);
        if (from < to) to -= 1;
        if (this.dropPosition === "after") to += 1;
        this.blocks.splice(to, 0, block);
        this.commit();
        this.focusBlock(block.id);
      });
      this.root.addEventListener("dragend", () => {
        this.draggedId = null;
        this.root.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((row) => row.classList.remove("dragging", "drop-before", "drop-after"));
      });
      this.menu.addEventListener("click", (event) => {
        const option = event.target.closest("[data-block-type]");
        if (option) this.changeType(this.menuBlockId, option.dataset.blockType);
      });
      document.addEventListener("click", (event) => {
        if (!this.menu.contains(event.target) && !this.root.contains(event.target)) this.closeMenu();
      });
    }

    onKeydown(event) {
      if (!this.menu.classList.contains("hidden")) {
        const options = [...this.menu.querySelectorAll("button")];
        let selected = Math.max(0, options.findIndex((option) => option.classList.contains("selected")));
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          options[selected]?.classList.remove("selected");
          selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
          options[selected]?.classList.add("selected");
          options[selected]?.scrollIntoView({ block: "nearest" });
          return;
        }
        if (event.key === "Enter" && options.length) {
          event.preventDefault();
          this.changeType(this.menuBlockId, options[selected].dataset.blockType);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.closeMenu();
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        return event.shiftKey ? this.redo() : this.undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        return this.redo();
      }
      const input = event.target.closest(".block-input");
      const row = event.target.closest(".block-row");
      if (!input || !row) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.syncFromDom();
        const index = this.blocks.findIndex((block) => block.id === row.dataset.id);
        const next = { id: blockId(), type: this.blocks[index].type === "divider" ? "paragraph" : this.blocks[index].type, text: "" };
        if (next.type === "checklist") next.checked = false;
        this.blocks.splice(index + 1, 0, next);
        this.commit();
        this.focusBlock(next.id);
      } else if (event.key === "Backspace" && !input.textContent && this.blocks.length > 1) {
        event.preventDefault();
        const index = this.blocks.findIndex((block) => block.id === row.dataset.id);
        const previous = this.blocks[Math.max(0, index - 1)];
        this.blocks.splice(index, 1);
        this.commit();
        this.focusBlock(previous.id, true);
      } else if (event.key === "/" && !input.textContent) {
        setTimeout(() => this.openMenu(row.dataset.id, ""), 0);
      }
    }

    syncFromDom() {
      this.root.querySelectorAll(".block-row").forEach((row) => {
        const block = this.blocks.find((item) => item.id === row.dataset.id);
        if (!block) return;
        const input = row.querySelector(".block-input");
        if (input) block.text = input.textContent.replace(/\u00a0/g, " ");
        const check = row.querySelector(".block-check");
        if (check) block.checked = check.checked;
      });
    }

    record() {
      if (this.silent) return;
      const snapshot = clone(this.blocks);
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(snapshot);
      if (this.history.length > 100) this.history.shift();
      this.historyIndex = this.history.length - 1;
      this.onChange(snapshot);
    }

    commit() {
      this.render();
      this.record();
    }

    undo() {
      if (this.historyIndex <= 0) return;
      this.historyIndex -= 1;
      this.blocks = clone(this.history[this.historyIndex]);
      this.render();
      this.onChange(clone(this.blocks));
    }

    redo() {
      if (this.historyIndex >= this.history.length - 1) return;
      this.historyIndex += 1;
      this.blocks = clone(this.history[this.historyIndex]);
      this.render();
      this.onChange(clone(this.blocks));
    }

    removeBlock(id) {
      if (this.blocks.length === 1) this.blocks[0] = { id: blockId(), type: "paragraph", text: "" };
      else this.blocks = this.blocks.filter((block) => block.id !== id);
      this.commit();
    }

    moveBlock(id, offset) {
      const index = this.blocks.findIndex((block) => block.id === id);
      const next = index + offset;
      if (index < 0 || next < 0 || next >= this.blocks.length) return;
      [this.blocks[index], this.blocks[next]] = [this.blocks[next], this.blocks[index]];
      this.commit();
      this.focusBlock(id);
    }

    changeType(id, type) {
      const block = this.blocks.find((item) => item.id === id);
      if (!block || !TYPES[type]) return;
      block.type = type;
      block.text = block.text.replace(/^\/\S*\s*/, "");
      if (type === "checklist") block.checked = Boolean(block.checked);
      else delete block.checked;
      this.closeMenu();
      this.commit();
      this.focusBlock(id, true);
    }

    openMenu(id, filter) {
      this.menuBlockId = id;
      const needle = String(filter || "").toLocaleLowerCase("pt-BR");
      const options = Object.entries(TYPES).filter(([, config]) => config.label.toLocaleLowerCase("pt-BR").includes(needle));
      this.menu.innerHTML = options.map(([type, config], index) => `<button class="${index === 0 ? "selected" : ""}" data-block-type="${type}"><b>${config.label}</b><span>${TYPES[type].placeholder}</span></button>`).join("");
      const row = this.root.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (row) {
        this.menu.style.top = `${row.offsetTop + row.offsetHeight}px`;
        this.menu.style.left = "44px";
      }
      this.menu.classList.toggle("hidden", !options.length);
    }

    closeMenu() {
      this.menu.classList.add("hidden");
      this.menuBlockId = null;
    }

    focusBlock(id, end = false) {
      requestAnimationFrame(() => {
        const input = this.root.querySelector(`[data-id="${CSS.escape(id)}"] .block-input`);
        if (!input) return;
        input.focus();
        if (end) {
          const range = document.createRange();
          range.selectNodeContents(input);
          range.collapse(false);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      });
    }

    render() {
      this.silent = true;
      let numbered = 0;
      this.root.innerHTML = this.blocks.map((block) => {
        const config = TYPES[block.type];
        numbered = block.type === "numbered_list" ? numbered + 1 : 0;
        const marker = block.type === "bulleted_list" ? '<span class="block-marker">•</span>' : block.type === "numbered_list" ? `<span class="block-marker">${numbered}.</span>` : block.type === "checklist" ? `<input class="block-check" type="checkbox" ${block.checked ? "checked" : ""}>` : "";
        const body = block.type === "divider" ? '<div class="block-divider" contenteditable="false"><hr></div>' : `${marker}<div class="block-input" contenteditable="true" role="textbox" data-placeholder="${config.placeholder}">${this.escape(block.text)}</div>`;
        return `<div class="block-row type-${block.type}" data-id="${block.id}"><div class="block-controls"><button type="button" class="block-grip" draggable="true" title="Arraste para mover esta frase" aria-label="Arraste para mover esta frase">⠿</button><button type="button" data-block-action="delete" title="Excluir bloco">×</button></div><div class="block-content">${body}</div></div>`;
      }).join("");
      this.silent = false;
    }

    escape(value) {
      return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
  }

  window.AgendaBlockEditor = AgendaBlockEditor;
})();
