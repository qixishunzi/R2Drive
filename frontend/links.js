(function () {
  const { layer } = layui;

  const elements = {
    refresh: document.querySelector("#refresh-links"),
    status: document.querySelector("#links-status"),
    list: document.querySelector("#links-list"),
    template: document.querySelector("#link-item-template")
  };

  function setStatus(message, isError) {
    elements.status.textContent = message || "";
    elements.status.classList.toggle("hidden", !message);
    elements.status.style.color = isError ? "#ff6b6b" : "";
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

    return response.json();
  }

  function formatRemaining(seconds, permanent) {
    if (permanent) {
      return "永久有效";
    }
    if (seconds <= 0) {
      return "已过期";
    }

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days} 天 ${hours} 小时`;
    if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
    return `${minutes} 分钟`;
  }

  function askLinkDuration(currentPermanent) {
    return new Promise((resolve) => {
      const content = `
        <div style="padding:16px 6px 0;">
          <select id="manage-link-ttl-select" class="layui-input">
            <option value="3600">1 小时</option>
            <option value="86400">1 天</option>
            <option value="604800">7 天</option>
            <option value="permanent" ${currentPermanent ? "selected" : ""}>永久有效</option>
          </select>
        </div>
      `;
      const index = layer.open({
        type: 1,
        title: "修改直链有效期",
        area: ["320px", "220px"],
        content,
        btn: ["保存", "取消"],
        yes() {
          const value = document.querySelector("#manage-link-ttl-select")?.value;
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

  function button(label, className, handler) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = className;
    node.textContent = label;
    node.addEventListener("click", handler);
    return node;
  }

  async function loadLinks() {
    try {
      setStatus("正在加载直链...", false);
      const data = await apiFetch("/api/links");
      const links = data.links || [];
      if (!links.length) {
        elements.list.className = "entry-list empty-state";
        elements.list.textContent = "当前还没有创建任何直链。";
        setStatus("", false);
        return;
      }

      elements.list.className = "entry-list";
      elements.list.innerHTML = "";
      for (const link of links) {
        const fragment = elements.template.content.cloneNode(true);
        fragment.querySelector(".link-file").textContent = link.key;
        fragment.querySelector(".link-url").textContent = link.url;
        fragment.querySelector(".link-remaining").textContent = formatRemaining(link.remainingSeconds, link.permanent);
        const actions = fragment.querySelector(".entry-actions");
        actions.appendChild(button("复制", "layui-btn layui-btn-sm layui-btn-normal", async () => {
          await navigator.clipboard.writeText(link.url);
          layer.msg("直链已复制", { icon: 1 });
        }));
        actions.appendChild(button("修改时长", "layui-btn layui-btn-sm layui-btn-primary", async () => {
          const ttlSeconds = await askLinkDuration(link.permanent);
          if (ttlSeconds === undefined) {
            return;
          }
          await apiFetch(`/api/links/${encodeURIComponent(link.id)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ttlSeconds, permanent: ttlSeconds == null })
          });
          layer.msg("直链时长已更新", { icon: 1 });
          await loadLinks();
        }));
        actions.appendChild(button("删除", "layui-btn layui-btn-sm layui-btn-danger", async () => {
          if (!window.confirm(`确认删除直链 ${link.key} ?`)) {
            return;
          }
          await apiFetch(`/api/links/${encodeURIComponent(link.id)}`, { method: "DELETE" });
          layer.msg("直链已删除", { icon: 1 });
          await loadLinks();
        }));
        elements.list.appendChild(fragment);
      }
      setStatus(`已加载 ${links.length} 个直链。`, false);
    } catch (error) {
      if (error.status === 401) {
        window.location.href = "/";
        return;
      }
      setStatus(error.message, true);
      layer.msg(error.message, { icon: 2 });
    }
  }

  elements.refresh.addEventListener("click", loadLinks);
  loadLinks();
})();
