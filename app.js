const DB_NAME = "MyLifeMemoDB";
const DB_VERSION = 1;
const STORE_NAME = "memos";

let db = null;
let currentFolder = "메모";
let searchQuery = "";
let pendingImages = [];
let cachedMemos = [];

const feedArea = document.getElementById("feedArea");
const tabButtons = document.querySelectorAll(".tab-btn");
const folderSelect = document.getElementById("folderSelect");
const titleInput = document.getElementById("titleInput");
const bodyInput = document.getElementById("bodyInput");
const searchInput = document.getElementById("searchInput");
const btnClearSearch = document.getElementById("btnClearSearch");
const searchStatus = document.getElementById("searchStatus");
const btnSave = document.getElementById("btnSave");
const photoFileInput = document.getElementById("photoFileInput");
const btnAttachPhoto = document.getElementById("btnAttachPhoto");
const btnAttachLink = document.getElementById("btnAttachLink");
const pendingImagesEl = document.getElementById("pendingImages");
const linkInputWrap = document.getElementById("linkInputWrap");
const linkInput = document.getElementById("linkInput");
const btnCloseLink = document.getElementById("btnCloseLink");
const dataModal = document.getElementById("dataModal");
const dataStats = document.getElementById("dataStats");
const btnCloseDataModal = document.getElementById("btnCloseDataModal");
const btnBackupDownload = document.getElementById("btnBackupDownload");
const btnRestoreTrigger = document.getElementById("btnRestoreTrigger");
const restoreFileInput = document.getElementById("restoreFileInput");
const btnCopyFolderText = document.getElementById("btnCopyFolderText");
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");
const toastEl = document.getElementById("toast");

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 2400);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("folder", "folder", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllMemos() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function addMemo(memo) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(memo);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteMemo(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function formatDateLabel(ts) {
  const d = new Date(ts);
  const days = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}`;
}

function formatTimeLabel(ts) {
  const d = new Date(ts);
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const period = hours < 12 ? "오전" : "오후";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${period} ${displayHour}:${minutes}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function highlightText(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const escapedQ = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQ})`, "gi");
  return safe.replace(regex, '<mark class="highlight">$1</mark>');
}

function normalizeUrl(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return "";
}

function extractUrlFromText(text) {
  const match = (text || "").match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : "";
}

function compressImageFile(file, maxDim = 1400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 450 * 1024) {
          resolve(reader.result);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(reader.result);
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl, filename) {
  const [meta, b64] = dataUrl.split(",");
  const mimeMatch = meta.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mime });
}

function renderPendingImages() {
  if (pendingImages.length === 0) {
    pendingImagesEl.classList.add("hidden");
    pendingImagesEl.innerHTML = "";
    return;
  }
  pendingImagesEl.classList.remove("hidden");
  pendingImagesEl.innerHTML = pendingImages
    .map(
      (src, idx) => `
      <div class="pending-thumb-wrap">
        <img src="${src}" alt="첨부 이미지 ${idx + 1}" class="pending-thumb" />
        <button type="button" class="pending-remove" data-idx="${idx}" aria-label="첨부 제거">✕</button>
      </div>`
    )
    .join("");
}

async function renderFeed() {
  cachedMemos = await getAllMemos();
  const q = searchQuery.trim();
  const qLower = q.toLowerCase();

  btnClearSearch.classList.toggle("hidden", !q);

  const filtered = cachedMemos
    .filter((item) => {
      const folderMatch = q ? true : item.folder === currentFolder;
      if (!folderMatch) return false;
      if (!q) return true;
      return (
        (item.title || "").toLowerCase().includes(qLower) ||
        (item.body || "").toLowerCase().includes(qLower) ||
        (item.url || "").toLowerCase().includes(qLower) ||
        (item.folder || "").toLowerCase().includes(qLower)
      );
    })
    .sort((a, b) => a.createdAt - b.createdAt);

  if (q) {
    searchStatus.classList.remove("hidden");
    searchStatus.textContent = `전체 폴더 검색 결과: ${filtered.length}건`;
  } else {
    searchStatus.classList.add("hidden");
    searchStatus.textContent = "";
  }

  feedArea.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <p class="empty-title">${q ? "검색 결과가 없어요" : `'${escapeHtml(currentFolder)}' 폴더가 비어 있어요`}</p>
      <p class="empty-desc">아래 입력창에 제목·본문·사진·웹주소를 담아보세요.</p>
    `;
    feedArea.appendChild(empty);
    return;
  }

  let lastDate = "";
  for (const item of filtered) {
    const dateStr = formatDateLabel(item.createdAt);
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      const divider = document.createElement("div");
      divider.className = "date-divider";
      divider.textContent = dateStr;
      feedArea.appendChild(divider);
    }

    const row = document.createElement("div");
    row.className = "memo-row";

    const timeEl = document.createElement("span");
    timeEl.className = "memo-time";
    timeEl.textContent = formatTimeLabel(item.createdAt);

    const bubble = document.createElement("article");
    bubble.className = "memo-bubble";

    const imagesHtml =
      Array.isArray(item.images) && item.images.length > 0
        ? `<div class="memo-gallery">${item.images
            .map((src) => `<img src="${src}" class="memo-img" alt="첨부 사진" />`)
            .join("")}</div>`
        : "";

    const linkHtml = item.url
      ? `<div class="link-card">
           <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="link-url">${highlightText(item.url, q)}</a>
           <button type="button" class="link-copy-btn" data-url="${escapeHtml(item.url)}">복사</button>
         </div>`
      : "";

    bubble.innerHTML = `
      <div class="memo-header">
        <span class="folder-badge" data-folder="${escapeHtml(item.folder)}">${escapeHtml(item.folder)}</span>
        <h2 class="memo-title">${highlightText(item.title || "(제목 없음)", q)}</h2>
        <button type="button" class="memo-delete" data-id="${item.id}" aria-label="삭제">✕</button>
      </div>
      ${imagesHtml}
      ${item.body ? `<div class="memo-body">${highlightText(item.body, q)}</div>` : ""}
      ${linkHtml}
      <div class="memo-export-bar">
        <button type="button" class="export-chip gmail" data-id="${item.id}">Gmail 보내기</button>
        <button type="button" class="export-chip kakao" data-id="${item.id}">카톡 나에게 보내기</button>
      </div>
    `;

    row.appendChild(timeEl);
    row.appendChild(bubble);
    feedArea.appendChild(row);
  }

  feedArea.scrollTop = feedArea.scrollHeight;
}

function buildMemoShareText(item) {
  const parts = [`[${item.folder}] ${item.title || "(제목 없음)"}`];
  if (item.body) parts.push(item.body);
  if (item.url) parts.push(`링크: ${item.url}`);
  return parts.join("\n\n");
}

function exportToGmail(item) {
  const subject = encodeURIComponent(`[MY LIFE MEMO] ${item.title || "기록"}`);
  const body = encodeURIComponent(buildMemoShareText(item));
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

async function exportToKakaoShare(item) {
  const text = buildMemoShareText(item);
  const files = Array.isArray(item.images)
    ? item.images.map((src, idx) => dataUrlToFile(src, `memo-${item.id}-${idx + 1}.jpg`))
    : [];

  if (navigator.share) {
    try {
      const shareData = {
        title: item.title || "MY LIFE MEMO",
        text,
      };
      if (item.url) shareData.url = item.url;
      if (files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        shareData.files = files;
      }
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("내용을 복사했어요! 카톡 '나와의 채팅'에 붙여넣어 주세요.");
  } catch {
    showToast("이 브라우저에서는 공유 창을 열 수 없어요.");
  }
}

async function handleSave() {
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();
  const rawLink = linkInput.value.trim();
  const explicitUrl = normalizeUrl(rawLink);
  const detectedUrl = explicitUrl || extractUrlFromText(body);
  const folder = folderSelect.value;

  if (rawLink && !explicitUrl) {
    showToast("올바른 웹주소(예: https://...)를 입력해 주세요.");
    return;
  }

  if (!title && !body && pendingImages.length === 0 && !detectedUrl) {
    showToast("제목, 본문, 사진 또는 웹주소를 입력해 주세요.");
    return;
  }

  await addMemo({
    folder,
    title: title || (pendingImages.length > 0 ? "사진 기록" : detectedUrl ? "웹주소 기록" : "(제목 없음)"),
    body,
    images: [...pendingImages],
    url: detectedUrl,
    createdAt: Date.now(),
  });

  titleInput.value = "";
  bodyInput.value = "";
  linkInput.value = "";
  linkInputWrap.classList.add("hidden");
  btnAttachLink.classList.remove("active");
  pendingImages = [];
  renderPendingImages();

  if (currentFolder !== folder) {
    setActiveFolder(folder);
  } else {
    await renderFeed();
  }
  showToast(`'${folder}' 폴더에 저장됐어요!`);
}

function setActiveFolder(folder) {
  currentFolder = folder;
  folderSelect.value = folder;
  tabButtons.forEach((btn) => {
    const active = btn.dataset.folder === folder;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  renderFeed();
}

function openDataModal() {
  dataStats.textContent = `전체 저장된 기록: ${cachedMemos.length}건 (현재 폴더 '${currentFolder}')`;
  dataModal.classList.remove("hidden");
}

function closeDataModal() {
  dataModal.classList.add("hidden");
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveFolder(btn.dataset.folder);
  });
});

btnSave.addEventListener("click", handleSave);

searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderFeed();
});

btnClearSearch.addEventListener("click", () => {
  searchQuery = "";
  searchInput.value = "";
  renderFeed();
});

btnAttachPhoto.addEventListener("click", () => {
  photoFileInput.click();
});

photoFileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const dataUrl = await compressImageFile(file);
    pendingImages.push(dataUrl);
  }
  photoFileInput.value = "";
  if (folderSelect.value === "메모") {
    folderSelect.value = "사진";
  }
  renderPendingImages();
});

bodyInput.addEventListener("paste", async (e) => {
  const items = Array.from(e.clipboardData?.items || []);
  const imageItems = items.filter((it) => it.type.startsWith("image/"));
  if (imageItems.length === 0) return;

  e.preventDefault();
  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) continue;
    const dataUrl = await compressImageFile(file);
    pendingImages.push(dataUrl);
  }
  if (folderSelect.value === "메모") {
    folderSelect.value = "캡쳐";
  }
  renderPendingImages();
  showToast("캡쳐 이미지를 첨부했어요!");
});

pendingImagesEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".pending-remove");
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  pendingImages.splice(idx, 1);
  renderPendingImages();
});

btnAttachLink.addEventListener("click", () => {
  const willShow = linkInputWrap.classList.contains("hidden");
  linkInputWrap.classList.toggle("hidden", !willShow);
  btnAttachLink.classList.toggle("active", willShow);
  if (willShow) {
    if (folderSelect.value === "메모") {
      folderSelect.value = "웹주소";
    }
    linkInput.focus();
  }
});

btnCloseLink.addEventListener("click", () => {
  linkInput.value = "";
  linkInputWrap.classList.add("hidden");
  btnAttachLink.classList.remove("active");
});

feedArea.addEventListener("click", async (e) => {
  const delBtn = e.target.closest(".memo-delete");
  if (delBtn) {
    const id = Number(delBtn.dataset.id);
    await deleteMemo(id);
    await renderFeed();
    showToast("기록을 삭제했어요.");
    return;
  }

  const gmailBtn = e.target.closest(".export-chip.gmail");
  if (gmailBtn) {
    const item = cachedMemos.find((m) => m.id === Number(gmailBtn.dataset.id));
    if (item) exportToGmail(item);
    return;
  }

  const kakaoBtn = e.target.closest(".export-chip.kakao");
  if (kakaoBtn) {
    const item = cachedMemos.find((m) => m.id === Number(kakaoBtn.dataset.id));
    if (item) await exportToKakaoShare(item);
    return;
  }

  const copyBtn = e.target.closest(".link-copy-btn");
  if (copyBtn) {
    const url = copyBtn.dataset.url;
    try {
      await navigator.clipboard.writeText(url);
      showToast("웹주소를 복사했어요.");
    } catch {
      showToast("복사 권한을 확인해 주세요.");
    }
    return;
  }

  const imgEl = e.target.closest(".memo-img");
  if (imgEl) {
    lightboxImg.src = imgEl.src;
    lightbox.classList.remove("hidden");
  }
});

lightboxClose.addEventListener("click", () => {
  lightbox.classList.add("hidden");
  lightboxImg.src = "";
});

lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) {
    lightbox.classList.add("hidden");
    lightboxImg.src = "";
  }
});

document.getElementById("btnExportMenu").addEventListener("click", openDataModal);
document.getElementById("btnMoreMenu").addEventListener("click", openDataModal);
btnCloseDataModal.addEventListener("click", closeDataModal);
dataModal.addEventListener("click", (e) => {
  if (e.target === dataModal) closeDataModal();
});

btnBackupDownload.addEventListener("click", async () => {
  const all = await getAllMemos();
  const payload = {
    app: "MY LIFE MEMO",
    version: 1,
    exportedAt: new Date().toISOString(),
    memos: all,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `my-life-memo-backup-${today}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`백업 파일(${all.length}건)을 저장했어요!`);
  closeDataModal();
});

btnRestoreTrigger.addEventListener("click", () => {
  restoreFileInput.click();
});

restoreFileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed.memos) ? parsed.memos : Array.isArray(parsed) ? parsed : [];
    if (items.length === 0) {
      showToast("복원할 기록이 없는 파일이에요.");
      return;
    }

    const existing = await getAllMemos();
    const existingKeys = new Set(existing.map((m) => `${m.createdAt}|${m.title}`));
    let addedCount = 0;

    for (const item of items) {
      const key = `${item.createdAt}|${item.title}`;
      if (existingKeys.has(key)) continue;
      await addMemo({
        folder: item.folder || "기타",
        title: item.title || "(제목 없음)",
        body: item.body || "",
        images: Array.isArray(item.images) ? item.images : [],
        url: item.url || "",
        createdAt: item.createdAt || Date.now(),
      });
      addedCount++;
    }

    await renderFeed();
    showToast(`${addedCount}건의 기록을 복원했어요!`);
    closeDataModal();
  } catch {
    showToast("백업 파일을 읽을 수 없어요.");
  } finally {
    restoreFileInput.value = "";
  }
});

btnCopyFolderText.addEventListener("click", async () => {
  const folderItems = cachedMemos
    .filter((m) => m.folder === currentFolder)
    .sort((a, b) => a.createdAt - b.createdAt);

  if (folderItems.length === 0) {
    showToast(`'${currentFolder}' 폴더가 비어 있어요.`);
    return;
  }

  const text = folderItems
    .map((m) => `[${formatDateLabel(m.createdAt)} ${formatTimeLabel(m.createdAt)}]\n${buildMemoShareText(m)}`)
    .join("\n\n----------------\n\n");

  try {
    await navigator.clipboard.writeText(text);
    showToast(`'${currentFolder}' 폴더 ${folderItems.length}건을 복사했어요!`);
    closeDataModal();
  } catch {
    showToast("복사 권한을 확인해 주세요.");
  }
});

(async function init() {
  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  db = await openDatabase();
  await renderFeed();
})();
