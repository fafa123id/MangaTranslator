document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get(["mangaConfig"], (result) => {
    if (result.mangaConfig) {
      if (result.mangaConfig.tgtLang) {
        document.getElementById("tgtLang").value = result.mangaConfig.tgtLang;
      }
      if (result.mangaConfig.apikey) {
        document.getElementById("ocrKey").value = result.mangaConfig.apikey;
      }
    }
  });
});

document.getElementById("btnManual").addEventListener("click", async () => {
  await triggerAction("start_selection");
});

document.getElementById("btnAuto").addEventListener("click", async () => {
  await triggerAction("detect_images");
});
document.getElementById("tgtLang").addEventListener("change", async () => {
  await change_language();
});
document.getElementById("ocrKey").addEventListener("change", async () => {
  const apikey = document.getElementById("ocrKey").value;
  chrome.storage.sync.set({
    mangaConfig: {
      apikey: apikey,
    },
  });
});
async function change_language() {
  const tgtLang = document.getElementById("tgtLang").value;

  chrome.storage.sync.set({
    mangaConfig: {
      tgtLang: tgtLang,
    },
  });
}
async function triggerAction(actionName) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url || tab.url.startsWith("chrome://")) {
    alert("Buka website manga dulu!");
    return;
  }

  const tgtLang = document.getElementById("tgtLang").value;
  const apikey = document.getElementById("ocrKey").value;
  chrome.storage.sync.set({
    mangaConfig: {
      tgtLang: tgtLang,
      apikey: apikey,
    },
  });
  const config = {
    tgtLang: tgtLang,
    apikey: apikey,
  };

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      files: ["content.js"],
    },
    () => {
      chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["styles.css"],
      });

      chrome.tabs.sendMessage(tab.id, {
        action: actionName,
        config: config,
      });

      window.close();
    }
  );
}
