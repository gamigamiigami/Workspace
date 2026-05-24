// らくだ先生 投稿管理ダッシュボード - メインロジック

const STORAGE_KEY = "rakuda-dashboard-config";
const API_BASE = "https://api.github.com";

let config = {
  token: "",
  owner: "",
  repo: "",
};

let pendingPost = null;
let currentFilter = "all";

// =========================
// 認証管理
// =========================

function loadAuth() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    config = JSON.parse(saved);
    document.getElementById("github-token").value = config.token;
    document.getElementById("repo-owner").value = config.owner;
    document.getElementById("repo-name").value = config.repo;
    if (config.token) {
      verifyAndLoad();
    }
  }
}

function saveAuth() {
  config.token = document.getElementById("github-token").value.trim();
  config.owner = document.getElementById("repo-owner").value.trim();
  config.repo = document.getElementById("repo-name").value.trim();

  if (!config.token || !config.owner || !config.repo) {
    setAuthStatus("全項目を入力してください", "error");
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  verifyAndLoad();
}

function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
  config = { token: "", owner: "", repo: "" };
  document.getElementById("github-token").value = "";
  setAuthStatus("クリアしました", "");
  hideMainSections();
}

function setAuthStatus(msg, cls) {
  const el = document.getElementById("auth-status");
  el.textContent = msg;
  el.className = cls;
}

function hideMainSections() {
  document.getElementById("sns-section").classList.add("hidden");
  document.getElementById("note-section").classList.add("hidden");
  document.getElementById("booth-section").classList.add("hidden");
  document.getElementById("runs-section").classList.add("hidden");
}

async function verifyAndLoad() {
  setAuthStatus("接続中...", "");
  try {
    const r = await ghApi(`/repos/${config.owner}/${config.repo}`);
    if (r.full_name) {
      setAuthStatus(`✅ 接続成功: ${r.full_name}`, "success");
      document.getElementById("sns-section").classList.remove("hidden");
      document.getElementById("note-section").classList.remove("hidden");
      document.getElementById("booth-section").classList.remove("hidden");
      document.getElementById("runs-section").classList.remove("hidden");
      loadAllContent();
    } else {
      setAuthStatus("接続失敗: リポジトリにアクセスできません", "error");
    }
  } catch (e) {
    setAuthStatus(`接続失敗: ${e.message}`, "error");
  }
}

// =========================
// GitHub API ラッパー
// =========================

async function ghApi(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(opts.headers || {}),
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function ghReadFile(path) {
  const r = await ghApi(`/repos/${config.owner}/${config.repo}/contents/${path}`);
  if (r.content) {
    return decodeURIComponent(escape(atob(r.content.replace(/\n/g, ""))));
  }
  return "";
}

async function ghListDir(path) {
  try {
    return await ghApi(`/repos/${config.owner}/${config.repo}/contents/${path}`);
  } catch (e) {
    return [];
  }
}

async function ghTriggerWorkflow(workflowFile, inputs = {}) {
  return ghApi(
    `/repos/${config.owner}/${config.repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs }),
    }
  );
}

// =========================
// SNS 投稿一覧（X/Threads/Instagram）
// =========================

async function loadSnsPosts() {
  const container = document.getElementById("sns-posts");
  container.innerHTML = `<p class="placeholder">読み込み中...</p>`;

  try {
    // 直近のweeklyファイルを取得
    const files = await ghListDir("projects/rakuda-sensei/sns/weekly");
    const weeklyFiles = files
      .filter((f) => f.name.endsWith("-x-posts.md"))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 1);

    if (weeklyFiles.length === 0) {
      container.innerHTML = `<p class="placeholder">週次ファイルがまだ生成されていません。<br>毎週金曜21:00 UTCに自動生成されます。</p>`;
      return;
    }

    const md = await ghReadFile(weeklyFiles[0].path);
    const posts = parseWeeklyMd(md, weeklyFiles[0].name);

    // 投稿済みログの読み込み
    let xPosted = "";
    let threadsPosted = "";
    try { xPosted = await ghReadFile("projects/rakuda-sensei/sns/.x-posted.log"); } catch {}
    try { threadsPosted = await ghReadFile("projects/rakuda-sensei/sns/.threads-posted.log"); } catch {}

    renderSnsPosts(posts, xPosted, threadsPosted);
  } catch (e) {
    container.innerHTML = `<p class="placeholder">エラー: ${e.message}</p>`;
  }
}

function parseWeeklyMd(md, filename) {
  // ファイル名から週開始日を取得
  const weekMatch = filename.match(/(\d{4}-\d{2}-\d{2})-x-posts/);
  if (!weekMatch) return [];
  const weekStart = new Date(weekMatch[1]);
  const year = weekStart.getFullYear();

  const posts = [];
  const dayRegex = /##\s*(\d+)\/(\d+)\([月火水木金土日]\)/g;
  let dayMatch;
  const dayPositions = [];
  while ((dayMatch = dayRegex.exec(md)) !== null) {
    dayPositions.push({ index: dayMatch.index, month: dayMatch[1], day: dayMatch[2] });
  }

  for (let i = 0; i < dayPositions.length; i++) {
    const start = dayPositions[i].index;
    const end = i + 1 < dayPositions.length ? dayPositions[i + 1].index : md.length;
    const section = md.slice(start, end);

    const slotRegex = /###\s*(朝|夜)/g;
    let slotMatch;
    const slots = [];
    while ((slotMatch = slotRegex.exec(section)) !== null) {
      slots.push({ name: slotMatch[1], index: slotMatch.index });
    }

    for (let j = 0; j < slots.length; j++) {
      const ss = slots[j].index;
      const se = j + 1 < slots.length ? slots[j + 1].index : section.length;
      const slotText = section.slice(ss, se);

      const bodyMatch = slotText.match(/-\s*本文[：:]\s*\n((?:(?!- タグ).*\n?)+)/);
      if (!bodyMatch) continue;
      let body = bodyMatch[1].trim().replace(/\n-\s*タグ.*$/s, "").trim();

      const tagsMatch = slotText.match(/-\s*タグ[：:]\s*(.+)/);
      const tags = tagsMatch ? tagsMatch[1].trim() : "";

      const typeMatch = slotText.match(/-\s*型[：:]\s*(.+)/);
      const type = typeMatch ? typeMatch[1].trim() : "";

      const date = `${year}-${String(dayPositions[i].month).padStart(2, "0")}-${String(dayPositions[i].day).padStart(2, "0")}`;
      posts.push({
        date,
        slot: slots[j].name,
        type,
        body,
        tags,
      });
    }
  }
  return posts;
}

function renderSnsPosts(posts, xPosted, threadsPosted) {
  const container = document.getElementById("sns-posts");

  const filtered = posts.filter((p) => {
    const isPostedX = xPosted.includes(`${p.date}-${p.slot}`);
    if (currentFilter === "posted") return isPostedX;
    if (currentFilter === "pending") return !isPostedX;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p class="placeholder">該当する投稿がありません</p>`;
    return;
  }

  container.innerHTML = filtered
    .map((p, idx) => {
      const key = `${p.date}-${p.slot}`;
      const xDone = xPosted.includes(key);
      const tDone = threadsPosted.includes(key);
      const statusBadge = xDone ? "✅ X投稿済" : "📅 未投稿";
      const tBadge = tDone ? "✅ Threads投稿済" : "";
      return `
        <div class="post-item ${xDone ? "posted" : ""}" data-idx="${posts.indexOf(p)}">
          <div class="post-meta">
            <span>${p.date} ${p.slot} (${p.type})</span>
            <span class="badge">${statusBadge}</span>
          </div>
          <div class="post-body">${escapeHtml(p.body)}</div>
          <div class="post-tags">${escapeHtml(p.tags)}</div>
          ${tBadge ? `<div style="font-size:0.8rem;color:#4CAF50;">${tBadge}</div>` : ""}
          <div class="post-actions">
            <button onclick='openPostModal(${JSON.stringify(p).replace(/'/g, "&apos;")})'>🚀 投稿</button>
          </div>
        </div>
      `;
    })
    .join("");
}

// =========================
// 投稿モーダル
// =========================

function openPostModal(post) {
  pendingPost = post;
  document.getElementById("modal-title").textContent = `${post.date} ${post.slot} を投稿`;
  document.getElementById("modal-content").textContent = post.body + (post.tags ? `\n\n${post.tags}` : "");
  document.getElementById("modal-result").textContent = "";
  document.getElementById("modal-result").className = "";
  document.getElementById("execute-btn").disabled = false;
  document.getElementById("post-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("post-modal").classList.add("hidden");
  pendingPost = null;
}

async function executePost() {
  if (!pendingPost) return;
  const platforms = [];
  if (document.getElementById("platform-x").checked) platforms.push("x");
  if (document.getElementById("platform-threads").checked) platforms.push("threads");

  if (platforms.length === 0) {
    document.getElementById("modal-result").textContent = "プラットフォームを選択してください";
    document.getElementById("modal-result").className = "error";
    return;
  }

  const btn = document.getElementById("execute-btn");
  btn.disabled = true;
  btn.textContent = "投稿中...";
  document.getElementById("modal-result").textContent = "";

  const results = [];
  const text = pendingPost.body + (pendingPost.tags ? `\n\n${pendingPost.tags}` : "");

  for (const p of platforms) {
    try {
      if (p === "x") {
        await ghTriggerWorkflow("post-to-x.yml", { force: "true" });
      } else if (p === "threads") {
        await ghTriggerWorkflow("post-to-threads.yml", { text, force: "true" });
      }
      results.push(`${p}: ✅ ワークフロー起動`);
    } catch (e) {
      results.push(`${p}: ❌ ${e.message}`);
    }
  }

  document.getElementById("modal-result").innerHTML = results.join("<br>") +
    "<br><br>📊 進捗は「直近の自動化実行」で確認してください（数十秒〜数分かかります）";
  document.getElementById("modal-result").className = "success";
  btn.textContent = "🚀 今すぐ投稿";
  btn.disabled = false;

  setTimeout(loadRuns, 5000);
}

// =========================
// note 記事
// =========================

async function loadNoteArticles() {
  const container = document.getElementById("note-articles");
  try {
    const files = await ghListDir("projects/rakuda-sensei/articles");
    const mdFiles = files.filter((f) => f.name.endsWith(".md"));

    if (mdFiles.length === 0) {
      container.innerHTML = `<p class="placeholder">記事ファイルなし</p>`;
      return;
    }

    container.innerHTML = mdFiles
      .map((f) => {
        const path = f.path;
        return `
          <div class="post-item">
            <div class="post-meta">
              <span>${f.name}</span>
              <span class="badge">未投稿</span>
            </div>
            <div class="post-body">パス: <code>${path}</code></div>
            <div class="post-actions">
              <button onclick="postNoteArticle('${path}')">🚀 noteに投稿</button>
              <button onclick="window.open('https://github.com/${config.owner}/${config.repo}/blob/main/${path}', '_blank')" class="secondary">👀 中身を見る</button>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    container.innerHTML = `<p class="placeholder">エラー: ${e.message}</p>`;
  }
}

async function postNoteArticle(path) {
  if (!confirm(`${path} をnoteに投稿しますか？`)) return;
  try {
    await ghTriggerWorkflow("post-to-note.yml", { article_path: path });
    alert("✅ note投稿ワークフローを起動しました。直近の自動化実行で進捗を確認してください。");
    setTimeout(loadRuns, 3000);
  } catch (e) {
    alert(`❌ エラー: ${e.message}`);
  }
}

// =========================
// BOOTH 商品
// =========================

async function loadBoothProducts() {
  const container = document.getElementById("booth-products");
  try {
    const products = await ghListDir("projects/rakuda-sensei/products");

    if (!products.length) {
      container.innerHTML = `<p class="placeholder">商品なし</p>`;
      return;
    }

    const items = [];
    for (const p of products) {
      if (p.type === "dir") {
        const files = await ghListDir(p.path);
        const htmlFile = files.find((f) => f.name.endsWith(".html"));
        if (htmlFile) {
          items.push(`
            <div class="post-item">
              <div class="post-meta">
                <span>${p.name}</span>
                <span class="badge">出品準備</span>
              </div>
              <div class="post-body">パス: <code>${htmlFile.path}</code></div>
              <div class="post-actions">
                <button onclick="postBoothProduct('${htmlFile.path}')">🚀 BOOTHに出品</button>
                <button onclick="window.open('https://github.com/${config.owner}/${config.repo}/blob/main/${htmlFile.path}', '_blank')" class="secondary">👀 中身を見る</button>
              </div>
            </div>
          `);
        }
      }
    }

    container.innerHTML = items.length ? items.join("") : `<p class="placeholder">出品可能な商品なし</p>`;
  } catch (e) {
    container.innerHTML = `<p class="placeholder">エラー: ${e.message}</p>`;
  }
}

async function postBoothProduct(path) {
  const pdfPath = prompt("添付PDFのパス（省略可）:", "");
  if (pdfPath === null) return;
  try {
    const inputs = { product_path: path };
    if (pdfPath) inputs.pdf_path = pdfPath;
    await ghTriggerWorkflow("post-to-booth.yml", inputs);
    alert("✅ BOOTH出品ワークフローを起動しました。");
    setTimeout(loadRuns, 3000);
  } catch (e) {
    alert(`❌ エラー: ${e.message}`);
  }
}

// =========================
// Actions実行ログ
// =========================

async function loadRuns() {
  const container = document.getElementById("runs-list");
  try {
    const r = await ghApi(
      `/repos/${config.owner}/${config.repo}/actions/runs?per_page=10`
    );
    if (!r.workflow_runs || r.workflow_runs.length === 0) {
      container.innerHTML = `<p class="placeholder">実行履歴なし</p>`;
      return;
    }
    container.innerHTML = r.workflow_runs
      .map((run) => {
        const status = run.conclusion || run.status;
        const time = new Date(run.created_at).toLocaleString("ja-JP");
        return `
          <div class="run-item">
            <div>
              <strong>${run.name}</strong><br>
              <small style="color:var(--text-muted)">${time}</small>
            </div>
            <div>
              <span class="run-status ${status}">${status}</span>
              <a href="${run.html_url}" target="_blank" style="margin-left:8px; color:var(--rakuda-brown);">詳細</a>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    container.innerHTML = `<p class="placeholder">エラー: ${e.message}</p>`;
  }
}

// =========================
// ユーティリティ
// =========================

function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function loadAllContent() {
  loadSnsPosts();
  loadNoteArticles();
  loadBoothProducts();
  loadRuns();
}

// フィルタボタン
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("filter-btn")) {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    currentFilter = e.target.dataset.filter;
    loadSnsPosts();
  }
});

// 初期化
document.addEventListener("DOMContentLoaded", loadAuth);
