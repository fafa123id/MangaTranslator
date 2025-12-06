if (!window.mangaTranslatorActive) {
  window.mangaTranslatorActive = true;
  let currentConfig = { tgtLang: "idn" };

  let autoDetectObserver = null;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.config) {
      currentConfig = request.config;
    }
    if (request.action === "detect_images") {
      detectAndSmartTranslate();
    }
    if (request.action === "start_selection") {
      startManualSelection();
    }
  });

  let isSelecting = false;
  let startX, startY, selectionBox, overlayContainer;

  function clearAllBubbles() {
    if (autoDetectObserver) {
      autoDetectObserver.disconnect();
      autoDetectObserver = null;
    }

    document
      .querySelectorAll(".manga-bubble-result")
      .forEach((el) => el.remove());

    document
      .querySelectorAll('img[data-manga-processed="true"]')
      .forEach((img) => {
        delete img.dataset.mangaProcessed;
      });

    const clearBtn = document.getElementById("manga-clear-all-btn");
    if (clearBtn) clearBtn.style.display = "none";
  }

  function showClearAllButton() {
    let btn = document.getElementById("manga-clear-all-btn");

    if (!btn) {
      btn = document.createElement("button");
      btn.id = "manga-clear-all-btn";
      btn.className = "manga-clear-btn";
      btn.innerHTML = "🧹 Bersihkan";

      btn.onclick = () => {
        clearAllBubbles();
      };

      document.body.appendChild(btn);
    }

    btn.style.display = "block";
  }

  function startManualSelection() {
    clearAllBubbles();

    document.body.style.cursor = "crosshair";
    isSelecting = true;

    const oldOverlay = document.getElementById("manga-overlay-manual");
    if (oldOverlay) oldOverlay.remove();

    overlayContainer = document.createElement("div");
    overlayContainer.id = "manga-overlay-manual";
    overlayContainer.style.cssText =
      "position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:2147483647; cursor:crosshair; background:rgba(0,0,0,0.05);";

    document.body.appendChild(overlayContainer);
    overlayContainer.addEventListener("mousedown", onMouseDown);
    overlayContainer.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      cancelManualSelection();
    });
  }
  function cancelManualSelection() {
    if (selectionBox) selectionBox.remove();
    if (overlayContainer) overlayContainer.remove();
    
    document.body.style.cursor = "default";
    isSelecting = false;
    selectionBox = null;
    overlayContainer = null;
  }

  function onMouseDown(e) {
    if (!isSelecting) return;
    
    if (e.button !== 0) return;

    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;

    selectionBox = document.createElement('div');
    selectionBox.className = "manga-selection-box";
    selectionBox.style.cssText = "position:fixed; border:2px dashed #00c6ff; background:rgba(0, 198, 255, 0.1); z-index:2147483647; pointer-events:none;";
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    
    document.body.appendChild(selectionBox);
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!selectionBox) return;
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selectionBox.style.width = w + 'px';
    selectionBox.style.height = h + 'px';
    selectionBox.style.left = Math.min(e.clientX, startX) + 'px';
    selectionBox.style.top = Math.min(e.clientY, startY) + 'px';
  }

  function onMouseUp(e) {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    if (!selectionBox) return;

    const rect = selectionBox.getBoundingClientRect();
    
    selectionBox.remove();
    selectionBox = null;

    if (overlayContainer) overlayContainer.remove();
    overlayContainer = null;
    
    document.body.style.cursor = "default";
    isSelecting = false;

    if (rect.width < 10 || rect.height < 10) {
      return; 
    }

    processManualCrop(rect);
  }

  function processManualCrop(rect) {
    const loader = showLoaderAt(
      rect.left + window.scrollX,
      rect.top + window.scrollY
    );

    chrome.runtime.sendMessage({ action: "capture_tab" }, (response) => {
      if (response && response.success && response.dataUrl) {
        cropAndSend(response.dataUrl, rect, loader);
      } else {
        loader.remove();
        alert(
          "Gagal Screenshot: " + (response ? response.error : "Unknown error")
        );
      }
    });
  }

  function cropAndSend(dataUrl, rect, loader) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");

      ctx.drawImage(
        img,
        rect.left * dpr,
        rect.top * dpr,
        rect.width * dpr,
        rect.height * dpr,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const base64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];

      chrome.runtime.sendMessage(
        { action: "process_image", imageData: base64, config: currentConfig },
        (res) => {
          loader.remove();
          handleTranslateResponse(
            res,
            rect.left + window.scrollX,
            rect.top + window.scrollY
          );
        }
      );
    };
    img.src = dataUrl;
  }

  function detectAndSmartTranslate() {
    clearAllBubbles();

    const images = document.querySelectorAll("img");
    let validTargets = [];

    images.forEach((img) => {
      if (img.naturalWidth > 300 && img.naturalHeight > 300 && isVisible(img)) {
        validTargets.push(img);
      }
    });

    if (validTargets.length === 0) {
      alert("Tidak ditemukan gambar manga yang terlihat di layar.");
      return;
    }

    showToast(
      `Smart Auto: Scroll untuk menerjemahkan (${validTargets.length} gambar).`
    );

    autoDetectObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = entry.target;

            if (!img.dataset.mangaProcessed) {
              img.dataset.mangaProcessed = "true";
              processSingleImage(img);
              observer.unobserve(img);
            }
          }
        });
      },
      {
        root: null,
        rootMargin: "300px",
        threshold: 0.1,
      }
    );

    validTargets.forEach((img) => {
      autoDetectObserver.observe(img);
    });
  }

  function processSingleImage(img) {
    const loader = showLoaderAtImage(img);

    chrome.runtime.sendMessage(
      { action: "process_image_url", imageUrl: img.src, config: currentConfig },
      (res) => {
        loader.remove();
        const rect = img.getBoundingClientRect();
        handleTranslateResponse(
          res,
          rect.left + window.scrollX,
          rect.top + window.scrollY,
          img
        );
      }
    );
  }

  function handleTranslateResponse(res, baseX, baseY, imgRef = null) {
    if (res && res.success && res.blocks) {
      res.blocks.forEach((block, index) => {
        const absX = baseX + block.box.x;
        const absY = baseY + block.box.y;
        createStaggeredBubble(
          block.translatedText,
          absX,
          absY,
          block.box.w,
          block.box.h,
          index
        );
      });

      showClearAllButton();
    } else {
      if (imgRef) showErrorMarker(imgRef);

      const errorMsg = res ? res.error : "Unknown Error";
      if (errorMsg.includes("429")) {
        console.warn("Server sibuk (429)");
      } else if (
        errorMsg.includes("403") ||
        errorMsg.includes("Gagal mengambil")
      ) {
        console.warn("Gagal Auto-Detect gambar ini (CORS)");
      } else {
        console.error("Error Translate: " + errorMsg);
      }
    }
  }

  function isVisible(elem) {
    if (!(elem instanceof Element)) return false;
    const style = getComputedStyle(elem);
    if (style.display === "none") return false;
    if (style.visibility !== "visible") return false;
    if (style.opacity < 0.1) return false;
    return true;
  }

  function showLoaderAt(x, y) {
    const div = document.createElement("div");
    div.className = "manga-image-loader";
    div.innerHTML = "⏳ Membaca...";
    div.style.cssText = `position:absolute; left:${x}px; top:${y}px; z-index:999999; background:rgba(0,0,0,0.8); color:white; padding:5px 10px; border-radius:10px; font-size:12px; pointer-events:none;`;
    document.body.appendChild(div);
    return div;
  }

  function showLoaderAtImage(img) {
    const rect = img.getBoundingClientRect();
    const centerX = window.scrollX + rect.left + rect.width / 2 - 20;
    const centerY = window.scrollY + rect.top + rect.height / 2 - 15;
    return showLoaderAt(centerX, centerY);
  }

  function showErrorMarker(img) {
    const rect = img.getBoundingClientRect();
    const div = document.createElement("div");
    div.innerText = "❌";
    div.style.cssText = `position:absolute; left:${
      window.scrollX + rect.left
    }px; top:${window.scrollY + rect.top}px; z-index:999999; font-size:20px;`;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 5000);
  }

  function showToast(msg) {
    if (document.querySelector(".manga-toast-msg")) return;
    const t = document.createElement("div");
    t.className = "manga-toast-msg";
    t.style.cssText =
      "position:fixed; bottom:20px; right:20px; background:#222; color:white; padding:10px; border-radius:5px; z-index:9999999; font-family:sans-serif; font-size:12px;";
    t.innerText = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function createStaggeredBubble(text, x, y, w, h, index) {
    const div = document.createElement("div");
    div.className = "manga-bubble-result";

    const xOffset = index % 2 === 0 ? -3 : 3;
    const yOffset = index * 2;

    div.style.position = "absolute";
    div.style.left = x + xOffset + "px";
    div.style.top = y + yOffset + "px";
    div.style.width = w + 10 + "px";
    div.style.minHeight = h + 5 + "px";

    div.style.backgroundColor = "rgba(255, 255, 255, 0.95)";
    div.style.color = "#000";
    div.style.border = "2px solid #333";
    div.style.borderRadius = "8px";
    div.style.padding = "4px";

    div.style.fontFamily = "'Comic Sans MS', sans-serif";
    div.style.fontSize = "13px";
    div.style.fontWeight = "600";
    div.style.textAlign = "center";
    div.style.lineHeight = "1.2";
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "center";
    div.style.zIndex = 10000 + index;
    div.style.boxShadow = "2px 2px 0px rgba(0,0,0,0.2)";
    div.innerText = text;

    const closeBtn = document.createElement("span");
    closeBtn.innerHTML = "&times;";
    closeBtn.style.cssText =
      "position:absolute; top:-8px; right:-8px; background:#ff4444; color:white; border-radius:50%; width:18px; height:18px; font-size:14px; line-height:16px; text-align:center; cursor:pointer; display:none; border:2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);";

    div.onmouseenter = () => {
      closeBtn.style.display = "block";
      div.style.zIndex = "9999999";
      div.style.backgroundColor = "#fff";
      div.style.transform = "scale(1.02)";
      div.style.transition = "transform 0.1s";
    };
    div.onmouseleave = () => {
      closeBtn.style.display = "none";
      div.style.zIndex = 10000 + index;
      div.style.backgroundColor = "rgba(255, 255, 255, 0.95)";
      div.style.transform = "scale(1)";
    };

    closeBtn.onclick = (e) => {
      e.stopPropagation();
      div.remove();
    };
    div.appendChild(closeBtn);
    document.body.appendChild(div);
  }
}
