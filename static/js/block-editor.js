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
    image: { label: "Imagem", placeholder: "Adicione uma legenda" },
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const blockId = () => `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
  const IMAGE_RATIOS = { original: "", square: "1 / 1", landscape: "16 / 9", classic: "4 / 3", portrait: "3 / 4" };

  class AgendaBlockEditor {
    constructor(root, menu, options = {}) {
      this.root = root;
      this.menu = menu;
      this.onChange = options.onChange || (() => {});
      this.onImageFiles = options.onImageFiles || (() => {});
      this.blocks = [];
      this.history = [];
      this.historyIndex = -1;
      this.layout = "flow";
      this.draggedId = null;
      this.dragOffset = { x: 0, y: 0 };
      this.pointerDrag = null;
      this.dropPosition = "before";
      this.menuBlockId = null;
      this.activeBlockId = null;
      this.silent = false;
      this.bind();
    }

    normalize(blocks) {
      const seen = new Set();
      const normalized = (Array.isArray(blocks) ? blocks : []).filter((block) => block && typeof block === "object").map((block, index) => {
        let id = String(block.id || blockId());
        if (seen.has(id)) id = blockId();
        seen.add(id);
        const type = TYPES[block.type] ? block.type : "paragraph";
        const normalizedBlock = { id, type, text: String(block.text || ""), ...(type === "checklist" ? { checked: Boolean(block.checked) } : {}) };
        const position = block.position && typeof block.position === "object" ? block.position : {};
        normalizedBlock.position = {
          x: clamp(position.x, 0, 4000, 24 + (index % 2) * 360),
          y: clamp(position.y, 0, 6000, 24 + Math.floor(index / 2) * 170),
          w: clamp(position.w, 180, 900, type === "image" ? 460 : 320),
        };
        if (type === "image" && block.asset && typeof block.asset === "object") {
          normalizedBlock.asset = {
            id: String(block.asset.id || ""),
            mime: String(block.asset.mime || ""),
            filename: String(block.asset.filename || "imagem"),
            size: Number(block.asset.size || 0),
          };
          normalizedBlock.width = clamp(block.width, 20, 100, 100);
          normalizedBlock.align = ["left", "center", "right"].includes(block.align) ? block.align : "center";
          const crop = block.crop && typeof block.crop === "object" ? block.crop : {};
          normalizedBlock.crop = {
            ratio: Object.prototype.hasOwnProperty.call(IMAGE_RATIOS, crop.ratio) ? crop.ratio : "original",
            zoom: clamp(crop.zoom, 100, 250, 100),
            x: clamp(crop.x, 0, 100, 50),
            y: clamp(crop.y, 0, 100, 50),
            open: Boolean(crop.open),
          };
        }
        return normalizedBlock;
      });
      return normalized.length ? normalized : [{ id: blockId(), type: "paragraph", text: "", position: { x: 24, y: 24, w: 320 } }];
    }

    setBlocks(blocks) {
      this.blocks = this.normalize(blocks);
      this.activeBlockId = this.blocks[0]?.id || null;
      this.history = [clone(this.blocks)];
      this.historyIndex = 0;
      this.render();
    }

    setLayout(layout, notify = true) {
      this.syncFromDom();
      this.layout = layout === "free" ? "free" : "flow";
      this.render();
      const button = document.querySelector("#block-layout");
      if (button) {
        const free = this.layout === "free";
        button.classList.toggle("active", free);
        button.textContent = free ? "☷ Organizar" : "✥ Modo livre";
        button.title = free ? "Voltar ao layout organizado" : "Arrastar textos e imagens livremente";
      }
      if (notify) this.onChange(clone(this.blocks));
    }

    getLayout() {
      return this.layout;
    }

    getBlocks() {
      this.syncFromDom();
      return clone(this.blocks);
    }

    plainText() {
      return this.getBlocks().map((block, index) => {
        if (block.type === "divider") return "---";
        if (block.type === "image") return `[Imagem: ${(block.asset && block.asset.filename) || "imagem"}]${block.text ? ` ${block.text}` : ""}`;
        if (block.type === "checklist") return `[${block.checked ? "x" : " "}] ${block.text}`;
        if (block.type === "bulleted_list") return `- ${block.text}`;
        if (block.type === "numbered_list") return `${index + 1}. ${block.text}`;
        return block.text;
      }).join("\n");
    }

    appendText(text) {
      const last = this.blocks[this.blocks.length - 1];
      if (last && last.type === "paragraph" && !last.text) last.text = text;
      else this.blocks.push({ id: blockId(), type: "paragraph", text, position: this.nextFreePosition() });
      this.commit();
      this.focusBlock(this.blocks[this.blocks.length - 1].id, true);
    }

    insertImage(asset) {
      if (!asset || !asset.id) return;
      const image = {
        id: blockId(),
        type: "image",
        text: "",
        asset: {
          id: String(asset.id),
          mime: String(asset.mime || ""),
          filename: String(asset.filename || "imagem"),
          size: Number(asset.size || 0),
        },
        width: 100,
        align: "center",
        crop: { ratio: "original", zoom: 100, x: 50, y: 50, open: false },
        position: this.nextFreePosition(460),
      };
      const activeIndex = this.activeBlockId ? this.blocks.findIndex((block) => block.id === this.activeBlockId) : -1;
      const index = activeIndex >= 0 ? activeIndex + 1 : this.blocks.length;
      this.blocks.splice(Math.max(0, index), 0, image);
      this.commit();
      this.focusBlock(image.id);
    }

    nextFreePosition(width = 320) {
      const index = this.blocks.length;
      return { x: 24 + (index % 2) * 360, y: 24 + Math.floor(index / 2) * 170, w: width };
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
        if (event.target.matches("[data-image-field]")) {
          this.updateImageField(row.dataset.id, event.target.dataset.imageField, event.target.value, false);
          this.applyImageLayout(row);
          return;
        }
        this.syncFromDom();
        if (event.target.classList.contains("block-input") && event.target.textContent.startsWith("/")) this.openMenu(row.dataset.id, event.target.textContent.slice(1));
        else this.closeMenu();
        this.record();
      });
      this.root.addEventListener("change", (event) => {
        const row = event.target.closest(".block-row");
        if (row && event.target.matches("[data-image-field]")) {
          this.updateImageField(row.dataset.id, event.target.dataset.imageField, event.target.value, true);
          return;
        }
        if (!event.target.matches(".block-check")) return;
        this.syncFromDom();
        this.record();
      });
      this.root.addEventListener("paste", (event) => {
        let files = [...(event.clipboardData?.files || [])];
        if (!files.length) files = [...(event.clipboardData?.items || [])].filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter(Boolean);
        files = files.filter((file) => file.type.startsWith("image/"));
        if (!files.length) return;
        event.preventDefault();
        this.onImageFiles(files);
      });
      this.root.addEventListener("focusin", (event) => {
        const row = event.target.closest(".block-row");
        if (row) this.activeBlockId = row.dataset.id;
      });
      this.root.addEventListener("click", (event) => {
        const imageAction = event.target.closest("[data-image-action]");
        if (imageAction) {
          const row = imageAction.closest(".block-row");
          this.handleImageAction(row.dataset.id, imageAction.dataset.imageAction);
          return;
        }
        const action = event.target.closest("[data-block-action]");
        if (!action) return;
        const row = action.closest(".block-row");
        if (action.dataset.blockAction === "delete") this.removeBlock(row.dataset.id);
        if (action.dataset.blockAction === "up") this.moveBlock(row.dataset.id, -1);
        if (action.dataset.blockAction === "down") this.moveBlock(row.dataset.id, 1);
      });
      this.root.addEventListener("pointerdown", (event) => this.startPointerDrag(event));
      this.root.addEventListener("pointermove", (event) => this.movePointerDrag(event));
      this.root.addEventListener("pointerup", (event) => this.endPointerDrag(event));
      this.root.addEventListener("pointercancel", (event) => this.endPointerDrag(event));
      this.root.addEventListener("keydown", (event) => this.onKeydown(event));
      this.root.addEventListener("dragstart", (event) => {
        const row = event.target.closest(".block-row");
        if (!row) return;
        this.draggedId = row.dataset.id;
        const rowRect = row.getBoundingClientRect();
        this.dragOffset = { x: event.clientX - rowRect.left, y: event.clientY - rowRect.top };
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", this.draggedId);
      });
      this.root.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer?.files?.length) {
          this.root.classList.add("block-image-drop");
          return;
        }
        if (this.layout === "free") {
          event.dataTransfer.dropEffect = "move";
          return;
        }
        const row = event.target.closest(".block-row");
        this.root.querySelectorAll(".drop-before, .drop-after").forEach((item) => item.classList.remove("drop-before", "drop-after"));
        if (!row || row.dataset.id === this.draggedId) return;
        const rect = row.getBoundingClientRect();
        this.dropPosition = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        row.classList.add(this.dropPosition === "before" ? "drop-before" : "drop-after");
      });
      this.root.addEventListener("drop", (event) => {
        event.preventDefault();
        this.root.classList.remove("block-image-drop");
        const imageFiles = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
        if (imageFiles.length) {
          const target = event.target.closest(".block-row");
          if (target) this.activeBlockId = target.dataset.id;
          this.onImageFiles(imageFiles);
          return;
        }
        if (this.layout === "free" && this.draggedId) {
          const block = this.blocks.find((item) => item.id === this.draggedId);
          const bounds = this.root.getBoundingClientRect();
          if (!block) return;
          block.position = block.position || this.nextFreePosition();
          block.position.x = clamp(event.clientX - bounds.left + this.root.scrollLeft - this.dragOffset.x, 0, 4000, 0);
          block.position.y = clamp(event.clientY - bounds.top + this.root.scrollTop - this.dragOffset.y, 0, 6000, 0);
          this.commit();
          return;
        }
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
      this.root.addEventListener("dragleave", (event) => {
        if (!this.root.contains(event.relatedTarget)) this.root.classList.remove("block-image-drop");
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
        const next = { id: blockId(), type: this.blocks[index].type === "divider" ? "paragraph" : this.blocks[index].type, text: "", position: this.nextFreePosition() };
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

    startPointerDrag(event) {
      if (this.layout !== "free" || event.button !== 0) return;
      const row = event.target.closest(".block-row");
      const imageHandle = event.target.closest(".image-frame");
      if (!row || (!imageHandle && event.target.closest("button, input, select, a, .image-tools, .image-crop-panel"))) return;
      const handle = imageHandle || row;
      if (imageHandle) event.preventDefault();
      this.syncFromDom();
      const rect = row.getBoundingClientRect();
      this.pointerDrag = {
        id: row.dataset.id,
        pointerId: event.pointerId,
        handle,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      handle.setPointerCapture(event.pointerId);
    }

    movePointerDrag(event) {
      const drag = this.pointerDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const block = this.blocks.find((item) => item.id === drag.id);
      const row = this.root.querySelector(`[data-id="${CSS.escape(drag.id)}"]`);
      if (!block || !row) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        row.classList.add("pointer-dragging");
        window.getSelection()?.removeAllRanges();
      }
      const bounds = this.root.getBoundingClientRect();
      const x = clamp(event.clientX - bounds.left - drag.offsetX, 0, 4000, 0);
      const y = clamp(event.clientY - bounds.top - drag.offsetY, 0, 6000, 0);
      block.position.x = x;
      block.position.y = y;
      row.style.left = `${x}px`;
      row.style.top = `${y}px`;
      this.expandFreeCanvas();
    }

    endPointerDrag(event) {
      const drag = this.pointerDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const row = this.root.querySelector(`[data-id="${CSS.escape(drag.id)}"]`);
      row?.classList.remove("pointer-dragging");
      if (drag.handle.hasPointerCapture?.(event.pointerId)) drag.handle.releasePointerCapture(event.pointerId);
      this.pointerDrag = null;
      if (drag.moved) this.record();
    }

    expandFreeCanvas() {
      const bottom = this.blocks.reduce((max, block) => Math.max(max, (block.position?.y || 0) + (block.type === "image" ? 560 : 180)), 700);
      const right = this.blocks.reduce((max, block) => Math.max(max, (block.position?.x || 0) + (block.position?.w || 320) + 40), 760);
      this.root.style.minHeight = `${bottom}px`;
      this.root.style.minWidth = `${right}px`;
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
      const index = this.blocks.findIndex((block) => block.id === id);
      if (this.blocks.length === 1) this.blocks[0] = { id: blockId(), type: "paragraph", text: "", position: this.nextFreePosition() };
      else this.blocks = this.blocks.filter((block) => block.id !== id);
      this.activeBlockId = this.blocks[Math.max(0, index - 1)]?.id || this.blocks[0]?.id || null;
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

    updateImageField(id, field, value, shouldRecord) {
      const block = this.blocks.find((item) => item.id === id && item.type === "image");
      if (!block) return;
      block.crop = block.crop || { ratio: "original", zoom: 100, x: 50, y: 50, open: true };
      if (field === "ratio") block.crop.ratio = Object.prototype.hasOwnProperty.call(IMAGE_RATIOS, value) ? value : "original";
      if (field === "zoom") block.crop.zoom = clamp(value, 100, 250, 100);
      if (field === "x" || field === "y") block.crop[field] = clamp(value, 0, 100, 50);
      if (shouldRecord) this.record();
    }

    applyImageLayout(row) {
      const block = this.blocks.find((item) => item.id === row?.dataset.id);
      const figure = row?.querySelector(".block-image-figure");
      const frame = row?.querySelector(".image-frame");
      const image = frame?.querySelector("img");
      if (!block || !figure || !frame || !image) return;
      const crop = block.crop || {};
      figure.style.width = `${clamp(block.width, 20, 100, 100)}%`;
      const ratio = IMAGE_RATIOS[crop.ratio] || "";
      frame.style.aspectRatio = ratio;
      frame.classList.toggle("is-cropped", Boolean(ratio));
      image.style.objectPosition = `${clamp(crop.x, 0, 100, 50)}% ${clamp(crop.y, 0, 100, 50)}%`;
      image.style.transform = ratio ? `scale(${clamp(crop.zoom, 100, 250, 100) / 100})` : "none";
    }

    handleImageAction(id, action) {
      const block = this.blocks.find((item) => item.id === id && item.type === "image");
      if (!block) return;
      if (action === "smaller" && this.layout === "free") block.position.w = clamp(block.position.w - 40, 180, 900, 460);
      else if (action === "larger" && this.layout === "free") block.position.w = clamp(block.position.w + 40, 180, 900, 460);
      else if (action === "smaller") block.width = clamp((block.width || 100) - 10, 20, 100, 100);
      else if (action === "larger") block.width = clamp((block.width || 100) + 10, 20, 100, 100);
      if (action.startsWith("align-")) block.align = action.replace("align-", "");
      if (action === "crop") block.crop.open = !block.crop.open;
      if (action === "reset-crop") block.crop = { ratio: "original", zoom: 100, x: 50, y: 50, open: true };
      this.commit();
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
      const options = Object.entries(TYPES).filter(([type, config]) => type !== "image" && config.label.toLocaleLowerCase("pt-BR").includes(needle));
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
        this.activeBlockId = id;
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
      this.root.classList.toggle("free-layout", this.layout === "free");
      let numbered = 0;
      this.root.innerHTML = this.blocks.map((block) => {
        const config = TYPES[block.type];
        numbered = block.type === "numbered_list" ? numbered + 1 : 0;
        const marker = block.type === "bulleted_list" ? '<span class="block-marker">•</span>' : block.type === "numbered_list" ? `<span class="block-marker">${numbered}.</span>` : block.type === "checklist" ? `<input class="block-check" type="checkbox" ${block.checked ? "checked" : ""}>` : "";
        let body;
        if (block.type === "divider") {
          body = '<div class="block-divider" contenteditable="false"><hr></div>';
        } else if (block.type === "image" && block.asset && block.asset.id) {
          const crop = block.crop || { ratio: "original", zoom: 100, x: 50, y: 50, open: false };
          const ratio = IMAGE_RATIOS[crop.ratio] || "";
          const imageStyle = ratio ? `object-position:${crop.x}% ${crop.y}%;transform:scale(${crop.zoom / 100})` : "";
          body = `<figure class="block-image-figure align-${block.align}" style="width:${block.width}%">
            <div class="image-tools" contenteditable="false" aria-label="Controles da imagem">
              <button type="button" data-image-action="smaller" title="Diminuir imagem" aria-label="Diminuir imagem">−</button><span class="image-size-label">${this.layout === "free" ? `${block.position.w}px` : `${block.width}%`}</span><button type="button" data-image-action="larger" title="Aumentar imagem" aria-label="Aumentar imagem">+</button>
              <span class="image-tools-separator flow-only"></span>
              <button type="button" data-image-action="align-left" class="flow-only ${block.align === "left" ? "active" : ""}" title="Alinhar a esquerda">←</button><button type="button" data-image-action="align-center" class="flow-only ${block.align === "center" ? "active" : ""}" title="Centralizar">↔</button><button type="button" data-image-action="align-right" class="flow-only ${block.align === "right" ? "active" : ""}" title="Alinhar a direita">→</button>
              <span class="image-tools-separator"></span><button type="button" data-image-action="crop" class="${crop.open ? "active" : ""}">Cortar</button>
            </div>
            <div class="image-crop-panel ${crop.open ? "" : "hidden"}" contenteditable="false">
              <label>Proporcao</label><select data-image-field="ratio"><option value="original" ${crop.ratio === "original" ? "selected" : ""}>Original</option><option value="square" ${crop.ratio === "square" ? "selected" : ""}>Quadrado 1:1</option><option value="landscape" ${crop.ratio === "landscape" ? "selected" : ""}>Paisagem 16:9</option><option value="classic" ${crop.ratio === "classic" ? "selected" : ""}>Classico 4:3</option><option value="portrait" ${crop.ratio === "portrait" ? "selected" : ""}>Retrato 3:4</option></select>
              <label>Zoom</label><input type="range" min="100" max="250" step="5" value="${crop.zoom}" data-image-field="zoom">
              <label>Horizontal</label><input type="range" min="0" max="100" value="${crop.x}" data-image-field="x">
              <label>Vertical</label><input type="range" min="0" max="100" value="${crop.y}" data-image-field="y">
              <span></span><button type="button" data-image-action="reset-crop">Restaurar recorte</button>
            </div>
            <div class="image-frame ${ratio ? "is-cropped" : ""}" title="${this.layout === "free" ? "Segure e arraste a imagem" : ""}" style="${ratio ? `aspect-ratio:${ratio}` : ""}"><img src="/api/assets/${this.escape(block.asset.id)}" alt="${this.escape(block.text || block.asset.filename)}" loading="lazy" draggable="false" style="${imageStyle}"></div>
            <figcaption class="block-input" contenteditable="true" role="textbox" data-placeholder="${config.placeholder}">${this.escape(block.text)}</figcaption></figure>`;
        } else {
          body = `${marker}<div class="block-input" contenteditable="true" role="textbox" data-placeholder="${config.placeholder}">${this.escape(block.text)}</div>`;
        }
        const position = block.position || this.nextFreePosition(block.type === "image" ? 460 : 320);
        const freeStyle = this.layout === "free" ? `style="left:${position.x}px;top:${position.y}px;width:${position.w}px"` : "";
        const dragTitle = this.layout === "free" ? "Segure e arraste para qualquer lugar" : "Arraste para reorganizar";
        return `<div class="block-row type-${block.type}" data-id="${block.id}" ${freeStyle}><div class="block-controls"><button type="button" class="block-grip" draggable="${this.layout === "flow"}" title="${dragTitle}" aria-label="${dragTitle}">⠿</button><button type="button" data-block-action="delete" title="Excluir bloco">×</button></div><div class="block-content">${body}</div></div>`;
      }).join("");
      if (this.layout === "free") {
        this.expandFreeCanvas();
      } else {
        this.root.style.minHeight = "430px";
        this.root.style.minWidth = "";
      }
      this.silent = false;
    }

    escape(value) {
      return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
  }

  window.AgendaBlockEditor = AgendaBlockEditor;
})();
