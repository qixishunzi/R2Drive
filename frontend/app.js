(function () {
  const { layer } = layui;

  const storageKeys = {
    currentPrefix: "r2drive.currentPrefix"
  };

  const elements = {
    loginScreen: document.querySelector("#login-screen"),
    loginForm: document.querySelector("#login-form"),
    loginUsername: document.querySelector("#login-username"),
    loginPassword: document.querySelector("#login-password"),
    loginStatus: document.querySelector("#login-status"),
    appShell: document.querySelector("#app-shell"),
    sessionUser: document.querySelector("#session-user"),
    logoutButton: document.querySelector("#logout-button"),
    backButton: document.querySelector("#back-button"),
    newFolderButton: document.querySelector("#new-folder-button"),
    uploadTrigger: document.querySelector("#upload-trigger"),
    uploadFile: document.querySelector("#upload-file"),
    refreshButton: document.querySelector("#refresh-button"),
    statusBar: document.querySelector("#status-bar"),
    folderStats: document.querySelector("#folder-stats"),
    breadcrumbs: document.querySelector("#breadcrumbs"),
    dropzone: document.querySelector("#dropzone"),
    entryList: document.querySelector("#entry-list"),
    entryTemplate: document.querySelector("#entry-item-template")
  };

  const state = {
    session: null,
    files: [],
    folders: [],
    prefix: "",
    uploading: false
  };

  function normalizePrefix(value) {
    const trimmed = String(value || "").trim().replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
    return trimmed ? `${trimmed}/` : "";
  }

  function formatSize(bytes) {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  function setStatus(message, isError) {
    elements.statusBar.textContent = message || "";
    elements.statusBar.classList.toggle("hidden", !message);
    elements.statusBar.style.color = isError ? "#ff6b6b" : "";
  }

  function setLoginStatus(message, isError) {
    elements.loginStatus.textContent = message || "";
    elements.loginStatus.style.color = isError ? "#ff6b6b" : "";
  }

  async function apiFetch(path, init) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: new Headers(init?.headers || {})
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const error = new Error(payload?.error || `请求失败: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response;
  }

  function loadUiState() {
    state.prefix = normalizePrefix(localStorage.getItem(storageKeys.currentPrefix) || "");
  }

  function saveUiState() {
    localStorage.setItem(storageKeys.currentPrefix, state.prefix);
  }

  function currentFolderLabel() {
    return state.prefix || "根目录";
  }

  function setAuthenticated(session) {
    state.session = session;
    elements.sessionUser.textContent = session.username;
    elements.loginScreen.classList.add("hidden");
    elements.appShell.classList.remove("hidden");
    setLoginStatus("", false);
  }

  function setLoggedOut() {
    state.session = null;
    elements.loginScreen.classList.remove("hidden");
    elements.appShell.classList.add("hidden");
    elements.loginPassword.value = "";
    setStatus("", false);
  }

  function getEntriesForCurrentPrefix() {
    const folders = new Map();
    const files = [];

    for (const folder of state.folders) {
      if (!folder.key.startsWith(state.prefix)) {
        continue;
      }

      const remainder = folder.key.slice(state.prefix.length);
      if (!remainder) {
        continue;
      }

      const separatorIndex = remainder.indexOf("/");
      if (separatorIndex === -1) {
        folders.set(remainder, {
          type: "folder",
          name: remainder,
          key: `${state.prefix}${remainder}/`,
          uploaded: folder.uploaded,
          size: null
        });
      } else {
        const folderName = remainder.slice(0, separatorIndex);
        if (!folders.has(folderName)) {
          folders.set(folderName, {
            type: "folder",
            name: folderName,
            key: `${state.prefix}${folderName}/`,
            uploaded: folder.uploaded,
            size: null
          });
        }
      }
    }

    for (const file of state.files) {
      if (!file.key.startsWith(state.prefix)) {
        continue;
      }

      const remainder = file.key.slice(state.prefix.length);
      if (!remainder) {
        continue;
      }

      const separatorIndex = remainder.indexOf("/");
      if (separatorIndex === -1) {
        files.push({ type: "file", ...file, name: remainder });
      } else {
        const folderName = remainder.slice(0, separatorIndex);
        if (!folders.has(folderName)) {
          folders.set(folderName, {
            type: "folder",
            name: folderName,
            key: `${state.prefix}${folderName}/`,
            uploaded: file.uploaded,
            size: null
          });
        }
      }
    }

    const entries = [...folders.values(), ...files];
    entries.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "folder" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    return entries;
  }

  function renderBreadcrumbs() {
    elements.breadcrumbs.innerHTML = "";
    const segments = [{ label: "全部文件", prefix: "" }];
    let acc = "";
    for (const part of state.prefix.split("/").filter(Boolean)) {
      acc += `${part}/`;
      segments.push({ label: part, prefix: acc });
    }

    for (const segment of segments) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = segment.label;
      button.addEventListener("click", () => openPrefix(segment.prefix));
      elements.breadcrumbs.appendChild(button);
    }
  }

  function openPreviewLayer(title, node) {
    const container = document.createElement("div");
    container.className = "preview-modal";
    container.appendChild(node);
    layer.open({
      type: 1,
      title,
      area: ["min(1100px, 96vw)", "min(86vh, 900px)"],
      shadeClose: true,
      content: container
    });
  }

  async function createDirectLink(key, ttlSeconds) {
    return apiFetch("/api/direct-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, ttlSeconds, permanent: ttlSeconds == null })
    });
  }

  async function createPreviewLink(key, ttlSeconds) {
    return apiFetch("/api/preview-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, ttlSeconds })
    });
  }

  async function createFolder(path) {
    return apiFetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path })
    });
  }

  async function deleteFolder(path) {
    return apiFetch(`/api/folders/${encodeURIComponent(path)}`, {
      method: "DELETE"
    });
  }

  function getExtension(key) {
    const index = key.lastIndexOf(".");
    return index === -1 ? "" : key.slice(index + 1).toLowerCase();
  }

  async function previewFile(file) {
    try {
      setStatus(`正在生成预览链接: ${file.key}`, false);
      const result = await createPreviewLink(file.key, 1800);
      const extension = getExtension(file.key);
      let node;

      if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(extension)) {
        node = document.createElement("img");
        node.src = result.url;
        node.alt = file.key;
        node.className = "preview-image";
      } else if (["mp4", "webm", "mov", "m4v"].includes(extension)) {
        node = document.createElement("video");
        node.src = result.url;
        node.controls = true;
        node.className = "preview-video";
      } else if (["mp3", "wav", "ogg", "m4a", "flac"].includes(extension)) {
        node = document.createElement("audio");
        node.src = result.url;
        node.controls = true;
        node.className = "preview-audio";
      } else if (extension === "pdf") {
        node = document.createElement("iframe");
        node.src = result.url;
        node.className = "preview-frame";
        node.title = file.key;
      } else if (["txt", "md", "json", "js", "css", "html", "xml", "csv", "log"].includes(extension)) {
        const response = await fetch(result.url);
        const text = await response.text();
        node = document.createElement("pre");
        node.className = "preview-text";
        node.textContent = text.slice(0, 200000);
      } else {
        await navigator.clipboard.writeText(result.url);
        layer.msg("该文件暂不支持预览，已复制直链", { icon: 1 });
        return;
      }

      openPreviewLayer(file.key, node);
    } catch (error) {
      setStatus(error.message, true);
      layer.msg(error.message, { icon: 2 });
    }
  }

  function actionButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function askLinkDuration() {
    return new Promise((resolve) => {
      const content = `
        <div style="padding:16px 6px 0;">
          <select id="link-ttl-select" class="layui-input">
            <option value="3600">1 小时</option>
            <option value="86400">1 天</option>
            <option value="604800">7 天</option>
            <option value="permanent">永久有效</option>
          </select>
        </div>
      `;
      const index = layer.open({
        type: 1,
        title: "设置直链有效期",
        area: ["320px", "220px"],
        content,
        btn: ["生成直链", "取消"],
        yes() {
          const value = document.querySelector("#link-ttl-select")?.value;
          layer.close(index);
          resolve(value === "permanent" ? null : Number(value));
        },
        btn2() {
          resolve(undefined);
        },
        cancel() {
          resolve(undefined);
        }
      });
    });
  }

  function renderEntries() {
    const entries = getEntriesForCurrentPrefix();
    elements.backButton.disabled = !state.prefix;
    elements.folderStats.textContent = `${currentFolderLabel()} · ${entries.length} 项`;

    if (!entries.length) {
      elements.entryList.className = "entry-list empty-state";
      elements.entryList.textContent = "当前目录为空。你可以新建文件夹，或者把文件直接拖进来。";
      return;
    }

    elements.entryList.className = "entry-list";
    elements.entryList.innerHTML = "";
    for (const entry of entries) {
      const fragment = elements.entryTemplate.content.cloneNode(true);
      const row = fragment.querySelector(".entry-row");
      const main = fragment.querySelector(".entry-main");
      const icon = fragment.querySelector(".entry-icon");
      const name = fragment.querySelector(".entry-name");
      const size = fragment.querySelector(".entry-size");
      const time = fragment.querySelector(".entry-time");
      const actions = fragment.querySelector(".entry-actions");

      name.textContent = entry.name;
      size.textContent = entry.type === "folder" ? "-" : formatSize(entry.size);
      time.textContent = entry.uploaded ? new Date(entry.uploaded).toLocaleString() : "-";

      if (entry.type === "folder") {
        icon.textContent = "#";
        main.addEventListener("click", () => openPrefix(entry.key));
        actions.appendChild(actionButton("打开", "layui-btn layui-btn-sm layui-btn-primary", () => openPrefix(entry.key)));
        actions.appendChild(actionButton("删除", "layui-btn layui-btn-sm layui-btn-danger", async () => {
          if (!window.confirm(`确认删除文件夹 ${entry.key} 及其全部内容？`)) {
            return;
          }

          try {
            await deleteFolder(entry.key);
            layer.msg("文件夹已删除", { icon: 1 });
            await refreshFiles();
          } catch (error) {
            setStatus(error.message, true);
            layer.msg(error.message, { icon: 2 });
          }
        }));
      } else {
        icon.textContent = "*";
        icon.classList.add("file");
        main.addEventListener("click", () => previewFile(entry));
        actions.appendChild(actionButton("预览", "layui-btn layui-btn-sm layui-btn-primary", () => previewFile(entry)));
        actions.appendChild(actionButton("复制直链", "layui-btn layui-btn-sm layui-btn-normal", async () => {
          try {
            const ttlSeconds = await askLinkDuration();
            if (ttlSeconds === undefined) {
              return;
            }

            const result = await createDirectLink(entry.key, ttlSeconds);
            await navigator.clipboard.writeText(result.url);
            layer.msg("直链已复制", { icon: 1 });
          } catch (error) {
            setStatus(error.message, true);
            layer.msg(error.message, { icon: 2 });
          }
        }));
        actions.appendChild(actionButton("删除", "layui-btn layui-btn-sm layui-btn-danger", async () => {
          if (!window.confirm(`确认删除 ${entry.key} ?`)) {
            return;
          }

          try {
            await apiFetch(`/api/files/${encodeURIComponent(entry.key)}`, { method: "DELETE" });
            layer.msg("文件已删除", { icon: 1 });
            await refreshFiles();
          } catch (error) {
            setStatus(error.message, true);
            layer.msg(error.message, { icon: 2 });
          }
        }));
      }

      row.dataset.type = entry.type;
      elements.entryList.appendChild(fragment);
    }
  }

  function renderBrowser() {
    renderBreadcrumbs();
    renderEntries();
  }

  function openPrefix(prefix) {
    state.prefix = normalizePrefix(prefix);
    saveUiState();
    renderBrowser();
  }

  function parentPrefix(prefix) {
    const parts = prefix.split("/").filter(Boolean);
    parts.pop();
    return parts.length ? `${parts.join("/")}/` : "";
  }

  async function refreshFiles() {
    try {
      setStatus("正在加载文件列表...", false);
      const data = await apiFetch("/api/files");
      state.files = data.files || [];
      state.folders = data.folders || [];
      renderBrowser();
      setStatus(`已加载 ${state.files.length} 个对象。`, false);
    } catch (error) {
      if (error.status === 401) {
        setLoggedOut();
      }
      setStatus(error.message, true);
      layer.msg(error.message, { icon: 2 });
    }
  }

  async function uploadEntries(entries) {
    if (!entries.length) {
      return;
    }

    state.uploading = true;
    try {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry.kind === "folder") {
          await createFolder(entry.path);
          continue;
        }

        setStatus(`正在上传 ${index + 1}/${entries.length}: ${entry.path}`, false);
        await apiFetch(`/api/upload?key=${encodeURIComponent(entry.path)}`, {
          method: "POST",
          headers: { "content-type": entry.file.type || "application/octet-stream" },
          body: entry.file
        });
      }

      layer.msg("上传完成", { icon: 1 });
      await refreshFiles();
    } catch (error) {
      setStatus(error.message, true);
      layer.msg(error.message, { icon: 2 });
    } finally {
      state.uploading = false;
    }
  }

  async function collectEntry(entry, basePrefix, output) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      output.push({ kind: "file", file, path: `${basePrefix}${file.name}` });
      return;
    }

    if (entry.isDirectory) {
      const folderPath = `${basePrefix}${entry.name}`;
      output.push({ kind: "folder", path: folderPath });
      const reader = entry.createReader();
      const children = [];
      while (true) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) {
          break;
        }
        children.push(...batch);
      }
      for (const child of children) {
        await collectEntry(child, `${folderPath}/`, output);
      }
    }
  }

  async function collectDroppedItems(items) {
    const output = [];
    const usedEntries = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) {
        usedEntries.push(entry);
      }
    }

    if (usedEntries.length) {
      for (const entry of usedEntries) {
        await collectEntry(entry, state.prefix, output);
      }
      return output;
    }

    for (const item of items) {
      const file = item.getAsFile ? item.getAsFile() : null;
      if (file) {
        output.push({ kind: "file", file, path: `${state.prefix}${file.name}` });
      }
    }
    return output;
  }

  async function handleChosenFiles(fileList) {
    const entries = [...fileList].map((file) => ({
      kind: "file",
      file,
      path: `${state.prefix}${file.name}`
    }));
    await uploadEntries(entries);
  }

  async function createFolderPrompt() {
    layer.prompt({
      title: "新建文件夹",
      formType: 0,
      placeholder: "输入文件夹名称"
    }, async (value, index) => {
      const folderName = normalizePrefix(value).replace(/\/$/, "");
      if (!folderName) {
        layer.msg("请输入文件夹名称", { icon: 2 });
        return;
      }

      try {
        await createFolder(`${state.prefix}${folderName}`);
        layer.close(index);
        layer.msg("文件夹已创建", { icon: 1 });
        await refreshFiles();
      } catch (error) {
        setStatus(error.message, true);
        layer.msg(error.message, { icon: 2 });
      }
    });
  }

  function bindDropzone() {
    const prevent = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      elements.dropzone.addEventListener(eventName, prevent);
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      elements.dropzone.addEventListener(eventName, () => elements.dropzone.classList.add("dragover"));
    });

    ["dragleave", "drop"].forEach((eventName) => {
      elements.dropzone.addEventListener(eventName, () => elements.dropzone.classList.remove("dragover"));
    });

    elements.dropzone.addEventListener("drop", async (event) => {
      if (state.uploading) {
        return;
      }

      const items = [...(event.dataTransfer?.items || [])];
      const entries = await collectDroppedItems(items);
      await uploadEntries(entries);
    });
  }

  async function login(username, password) {
    const data = await apiFetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    setAuthenticated(data.session);
    layer.msg("登录成功", { icon: 1 });
    await refreshFiles();
  }

  async function logout() {
    try {
      await apiFetch("/api/logout", { method: "POST" });
    } catch {
    }
    setLoggedOut();
    layer.msg("已退出登录", { icon: 1 });
  }

  async function hydrateSession() {
    try {
      const data = await apiFetch("/api/session");
      if (!data.authenticated) {
        setLoggedOut();
        return;
      }

      setAuthenticated(data.session);
      await refreshFiles();
    } catch {
      setLoggedOut();
    }
  }

  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = elements.loginUsername.value.trim();
    const password = elements.loginPassword.value;
    if (!username || !password) {
      setLoginStatus("请填写账号和密码。", true);
      return;
    }

    try {
      setLoginStatus("正在登录...", false);
      await login(username, password);
    } catch (error) {
      setLoginStatus(error.message, true);
      layer.msg(error.message, { icon: 2 });
    }
  });

  elements.logoutButton.addEventListener("click", logout);
  elements.backButton.addEventListener("click", () => openPrefix(parentPrefix(state.prefix)));
  elements.newFolderButton.addEventListener("click", createFolderPrompt);
  elements.uploadTrigger.addEventListener("click", () => elements.uploadFile.click());
  elements.uploadFile.addEventListener("change", async (event) => {
    await handleChosenFiles(event.target.files || []);
    elements.uploadFile.value = "";
  });
  elements.refreshButton.addEventListener("click", refreshFiles);

  loadUiState();
  bindDropzone();
  renderBrowser();
  hydrateSession();
})();
