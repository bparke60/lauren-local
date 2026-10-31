const $ = (s) => document.querySelector(s);
async function api(path, body) {
  const r = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Request failed");
  return data;
}
function el(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
let last = "";
async function refresh() {
  try {
    const data = await api("/api/local");
    $("#connection").textContent = data.connected
      ? data.busy
        ? "● Working locally"
        : "● Local engine ready"
      : "○ Open LM Studio to connect";
    $("#model").textContent = data.model;
    $("#network").checked = data.networkEnabled;
    $("#jobCount").textContent =
      `${data.jobs.filter((j) => j.status === "queued" || j.status === "running").length} active`;
    const signature = JSON.stringify([data.jobs, data.lists, data.runs]);
    if (signature === last) return;
    last = signature;
    $("#jobs").replaceChildren();
    for (const job of data.jobs) {
      const card = el("article", undefined, "job " + job.status);
      card.append(
        el(
          "div",
          `${job.status} · ${new Date(job.due_at).toLocaleString()} · ${job.network ? "web allowed" : "offline"}`,
          "meta",
        ),
        el("h3", job.prompt),
      );
      if (job.result) {
        const result = JSON.parse(job.result);
        const details = el("details");
        details.append(el("summary", "Read result"), el("pre", result.text));
        for (const source of result.citations || []) {
          try {
            const u = new URL(source.url);
            if (!["http:", "https:"].includes(u.protocol)) continue;
            const a = el("a", source.title || source.url);
            a.href = u.href;
            a.target = "_blank";
            a.rel = "noreferrer";
            details.append(a, el("br"));
          } catch {}
        }
        card.append(details);
      }
      if (job.error) card.append(el("p", job.error));
      if (["queued", "failed", "interrupted"].includes(job.status)) {
        const action = job.status === "queued" ? "cancel" : "retry";
        const b = el("button", action === "cancel" ? "Cancel" : "Retry");
        b.onclick = async () => {
          b.disabled = true;
          try {
            await api(`/api/local/jobs/${job.id}/${action}`, {});
            await refresh();
          } catch (e) {
            $("#message").textContent = e.message;
            b.disabled = false;
          }
        };
        card.append(b);
      }
      $("#jobs").append(card);
    }
    if (!data.jobs.length)
      $("#jobs").append(
        el("p", "Nothing waiting. Your next head start begins above.", "empty"),
      );
    $("#lists").replaceChildren();
    for (const list of data.lists) {
      const card = el("article", undefined, "list");
      card.append(el("h3", list.title));
      const ul = el("ul");
      for (const item of list.items) ul.append(el("li", item));
      card.append(ul);
      $("#lists").append(card);
    }
    if (!data.lists.length)
      $("#lists").append(
        el("p", "Ask Lauren to save a list, or leave her a task.", "empty"),
      );
    const table = el("table");
    for (const run of data.runs) {
      const tr = el("tr");
      for (const value of [
        new Date(run.at).toLocaleTimeString(),
        run.model,
        (run.elapsed_ms / 1000).toFixed(1) + " seconds",
        run.tool_count + " tools",
        run.ok ? "Completed" : "Stopped",
      ])
        tr.append(el("td", value));
      table.append(tr);
    }
    $("#runs").replaceChildren(table);
  } catch (error) {
    $("#connection").textContent = "Core unavailable";
    $("#message").textContent = error.message;
  }
}
$("#taskForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/local/jobs", {
      prompt: $("#prompt").value,
      dueAt: $("#dueAt").value
        ? new Date($("#dueAt").value).toISOString()
        : new Date().toISOString(),
      network: $("#taskNetwork").checked,
    });
    $("#prompt").value = "";
    $("#message").textContent =
      "Saved. You can leave this window; Lauren will keep working while her desktop app is running.";
    await refresh();
  } catch (error) {
    $("#message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$("#network").onchange = async () => {
  try {
    await api("/api/local/settings", { networkEnabled: $("#network").checked });
    await refresh();
  } catch (error) {
    $("#message").textContent = error.message;
  }
};
$("#switchModel").onclick = async () => {
  const b = $("#switchModel");
  b.disabled = true;
  b.textContent = "Loading model…";
  try {
    await api("/api/local/settings", { model: $("#modelChoice").value });
    await refresh();
    $("#message").textContent =
      "Model ready. Only the selected Lauren model is loaded.";
  } catch (error) {
    $("#message").textContent = error.message;
  } finally {
    b.disabled = false;
    b.textContent = "Switch model";
  }
};
refresh();
setInterval(refresh, 5000);
