chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "capture_tab") {
    chrome.tabs.captureVisibleTab(
      null,
      { format: "jpeg", quality: 90 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
        } else {
          sendResponse({ success: true, dataUrl: dataUrl });
        }
      }
    );
    return true;
  }

  const config = request.config || { tgtLang: "idn" };

  if (request.action === "process_image") {
    processMangaImage(request.imageData, config)
      .then((blocks) => sendResponse({ success: true, blocks: blocks }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "process_image_url") {
    fetchImageAsBase64(request.imageUrl)
      .then((base64) => processMangaImage(base64, config))
      .then((blocks) => sendResponse({ success: true, blocks: blocks }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url);
    if (response.status === 403)
      throw new Error("Akses Ditolak (403). Gunakan 'Scan Manual'.");
    if (!response.ok) throw new Error("Gagal download: " + response.status);
    const blob = await response.blob();
    return await convertBlobToBase64(blob);
  } catch (e) {
    console.error("Fetch Error:", e);
    throw new Error(e.message || "Gagal mengambil gambar.");
  }
}

function convertBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.readAsDataURL(blob);
  });
}

async function processMangaImage(base64Image, config) {
  const ocrResult = await callOCRSpace(base64Image, config);

  const groupedBlocks = performSuperSmartClustering(ocrResult);

  if (groupedBlocks.length === 0) throw new Error("Tidak ada teks terdeteksi.");

  const translatedBlocks = await translateBatchGoogle(groupedBlocks, config);
  return translatedBlocks;
}

async function callOCRSpace(base64Image, config) {
  if (typeof config.apikey === 'undefined' || !config.apikey || config.apikey.includes("Null")) {
    throw new Error("API Key OCR belum diisi dengan benar.");
  }

  const formData = new FormData();
  formData.append("base64Image", "data:image/jpeg;base64," + base64Image);
  formData.append("language", "auto");
  formData.append("isOverlayRequired", "true");
  formData.append("apikey", config.apikey);
  formData.append("OCREngine", "2");

  try {
    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: formData
    });
    
    if (response.status === 403) {
      throw new Error("OCR 403: API Key salah atau limit habis/diblokir.");
    }
    
    if (!response.ok) {
      throw new Error(`OCR Error: HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (data.IsErroredOnProcessing) {
      throw new Error(data.ErrorMessage || "OCR Gagal Memproses Gambar");
    }
    
    return data;

  } catch (e) {
    console.error("OCR Fetch Error:", e);
    throw new Error(e.message || "Gagal menghubungi server OCR.");
  }
}

async function translateBatchGoogle(blocks, config) {
  if (blocks.length === 0) return [];
  const separator = "\n\n";
  const combinedText = blocks.map((b) => b.originalText).join(separator);

  try {
    const translatedCombined = await googleTranslatePost(combinedText, config);
    const translatedArray = translatedCombined.split(separator);

    return blocks.map((block, index) => {
      let trans = translatedArray[index]
        ? translatedArray[index].trim()
        : block.originalText;
      return { ...block, translatedText: trans };
    });
  } catch (e) {
    console.error("Batch Error:", e);
    if (e.message.includes("429"))
      throw new Error("Server Sibuk (Limit 429). Tunggu 10 menit.");
    return await translateSequentialFallback(blocks, config);
  }
}

async function googleTranslatePost(text, config) {
  const cleanText = text.trim();
  if (!cleanText) return "";

  let tl = "id";

  if (config.tgtLang === "eng") tl = "en";
  if (config.tgtLang === "idn") tl = "id";

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t`;
  const body = new URLSearchParams();
  body.append("q", cleanText);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body,
  });

  if (response.status === 429) throw new Error("429 Too Many Requests");
  if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
  const data = await response.json();

  if (data && data[0]) return data[0].map((segment) => segment[0]).join("");
  return text;
}

async function translateSequentialFallback(blocks, config) {
  const results = [];
  for (const block of blocks) {
    try {
      const trans = await googleTranslatePost(block.originalText, config);
      results.push({ ...block, translatedText: trans });
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
    } catch (e) {
      if (e.message.includes("429")) {
        results.push({ ...block, translatedText: "⛔ Limit" });
        break;
      }
      results.push({ ...block, translatedText: block.originalText });
    }
  }
  return results;
}

function performSuperSmartClustering(ocrResult) {
  const rawLines = ocrResult.ParsedResults?.[0]?.TextOverlay?.Lines || [];
  if (rawLines.length === 0) return [];

  let rects = rawLines.map((line, index) => {
    const words = line.Words || [];
    let l, t, w, h;
    if (words.length > 0) {
      l = Math.min(...words.map((w) => w.Left));
      t = Math.min(...words.map((w) => w.Top));
      const r = Math.max(...words.map((w) => w.Left + w.Width));
      const b = Math.max(...words.map((w) => w.Top + w.Height));
      w = r - l;
      h = b - t;
    } else {
      l = line.MinTop;
      t = line.MinTop;
      w = 100;
      h = line.MaxHeight;
    }
    return {
      id: index,
      text: line.LineText,
      l,
      t,
      r: l + w,
      b: t + h,
      w,
      h,
      centerX: l + w / 2,
      centerY: t + h / 2,
      visited: false,
    };
  });

  const clusters = [];

  for (let i = 0; i < rects.length; i++) {
    if (rects[i].visited) continue;
    const currentCluster = [];
    const queue = [rects[i]];
    rects[i].visited = true;

    while (queue.length > 0) {
      const current = queue.shift();
      currentCluster.push(current);
      for (let j = 0; j < rects.length; j++) {
        if (!rects[j].visited) {
          if (areVisualNeighbors(current, rects[j])) {
            rects[j].visited = true;
            queue.push(rects[j]);
          }
        }
      }
    }
    clusters.push(finalizeCluster(currentCluster));
  }
  return clusters;
}

function areVisualNeighbors(r1, r2) {
  const xGap = Math.max(0, r1.l - r2.r, r2.l - r1.r);
  const yGap = Math.max(0, r1.t - r2.b, r2.t - r1.b);
  const refWidth = Math.min(r1.w, r2.w);
  const refHeight = Math.min(r1.h, r2.h);

  const isCloseVertically = yGap < refHeight * 1.5;
  const isCloseHorizontally = xGap < refWidth * 2.0;

  const xOverlap = Math.min(r1.r, r2.r) - Math.max(r1.l, r2.l);
  const yOverlap = Math.min(r1.b, r2.b) - Math.max(r1.t, r2.t);

  const isAlignedVertically = xOverlap > -(refWidth * 0.8);
  const isAlignedHorizontally = yOverlap > -(refHeight * 0.8);

  if (isCloseVertically && isAlignedVertically) return true;
  if (isCloseHorizontally && isAlignedHorizontally) return true;

  return false;
}

function finalizeCluster(cluster) {
  if (cluster.length === 1) {
    return {
      originalText: cluster[0].text,
      box: {
        x: cluster[0].l,
        y: cluster[0].t,
        w: cluster[0].w,
        h: cluster[0].h,
      },
    };
  }

  cluster.sort((a, b) => {
    if (Math.abs(a.t - b.t) < 15) return a.l - b.l;
    return a.t - b.t;
  });

  const combinedText = cluster.map((c) => c.text).join(" ");
  const l = Math.min(...cluster.map((c) => c.l));
  const t = Math.min(...cluster.map((c) => c.t));
  const r = Math.max(...cluster.map((c) => c.r));
  const b = Math.max(...cluster.map((c) => c.b));

  return {
    originalText: combinedText,
    box: { x: l, y: t, w: r - l, h: b - t },
  };
}
