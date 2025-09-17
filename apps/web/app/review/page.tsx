"use client";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

type SeedState = "draft" | "ready";

type Seed = {
  id: string;
  title: string;
  notes?: string | null;
  tags: string[];
  state: SeedState;
  createdAt: number;
};

type SeedResponse = {
  items: Seed[];
  meta?: { count: number };
  filters?: Record<string, unknown>;
};

type Draft = {
  id: string;
  platform: string;
  originalText: string;
  editedText?: string | null;
  createdAt: number;
  updatedAt: number;
  generatorMeta?: {
    promptVersionId?: string | null;
    runId: string;
    generatedAt: number;
    reused: boolean;
  } | null;
  approvalJob?: {
    jobId: string;
    runAt: number;
    status: "pending" | "cancelled" | "completed";
  } | null;
};

type DraftAudit = {
  id: string;
  editor: string;
  editedText: string;
  createdAt: number;
};

type ProviderInfo = {
  key: string;
  displayName: string;
  constraints: {
    maxTextLength?: number;
  };
};

type FilterState = {
  state: "all" | SeedState;
  tag: string | null;
  search: string;
};

const STATE_OPTIONS: Array<{ label: string; value: "all" | SeedState }> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Ready", value: "ready" },
];

const PLATFORM_OPTIONS = ["linkedin", "x", "instagram", "facebook", "tiktok"];

const sidebarStyle: CSSProperties = {
  width: 300,
  borderRight: "1px solid #e2e2e2",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const listItemStyle: CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 10,
  padding: 12,
  cursor: "pointer",
  display: "grid",
  gap: 8,
};

const activeItemStyle: CSSProperties = {
  ...listItemStyle,
  borderColor: "#0a8",
  boxShadow: "0 0 0 1px rgba(10, 136, 96, 0.2)",
};

export default function ReviewPage() {
  const [filters, setFilters] = useState<FilterState>({ state: "all", tag: null, search: "" });
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [selectedSeedId, setSelectedSeedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [platforms, setPlatforms] = useState<string[]>(["linkedin", "x"]);
  const [message, setMessage] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loadingSeeds, setLoadingSeeds] = useState(false);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [seedForm, setSeedForm] = useState({ title: "", notes: "", tags: "" });
  const [editForm, setEditForm] = useState({ title: "", notes: "", tags: "" });
  const [savingSeed, setSavingSeed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deletingSeed, setDeletingSeed] = useState(false);
  const [togglingState, setTogglingState] = useState(false);
  const [generationSummary, setGenerationSummary] = useState<Array<{ platform: string; status: string; error?: string }>>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [draftDetails, setDraftDetails] = useState<Draft | null>(null);
  const [draftAuditTrail, setDraftAuditTrail] = useState<DraftAudit[]>([]);
  const [draftEditText, setDraftEditText] = useState<string>("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validating, setValidating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    seeds.forEach((seed) => {
      seed.tags?.forEach((tag) => set.add(tag));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [seeds]);

  const selectedSeed = useMemo(() => seeds.find((seed) => seed.id === selectedSeedId) || null, [seeds, selectedSeedId]);

  const applySeedSelection = useCallback((items: Seed[]) => {
    setSeeds(items);
    if (!items.length) {
      setSelectedSeedId(null);
      setDrafts([]);
      return;
    }
    setSelectedSeedId((prev) => {
      if (prev && items.some((seed) => seed.id === prev)) {
        return prev;
      }
      return items[0].id;
    });
  }, []);

  const loadSeeds = useCallback(async () => {
    setLoadingSeeds(true);
    try {
      const params = new URLSearchParams();
      if (filters.state !== "all") params.set("state", filters.state);
      if (filters.tag) params.set("tag", filters.tag);
      if (filters.search.trim().length) params.set("q", filters.search.trim());
      const url = params.toString().length ? `/api/seeds?${params.toString()}` : "/api/seeds";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("load_failed");
      const data: SeedResponse = await response.json();
      const normalized = (data.items || []).map((seed) => ({
        ...seed,
        tags: seed.tags || [],
      }));
      applySeedSelection(normalized);
    } catch (err) {
      console.error(err);
      setMessage("Failed to load seeds");
    } finally {
      setLoadingSeeds(false);
    }
  }, [applySeedSelection, filters.state, filters.tag, filters.search]);

  const ensureCsrf = useCallback(async () => {
    if (csrfToken) return csrfToken;
    const response = await fetch("/api/csrf-token", { credentials: "include" });
    if (!response.ok) throw new Error("csrf_fetch_failed");
    const data = await response.json();
    setCsrfToken(data.csrfToken);
    return data.csrfToken as string;
  }, [csrfToken]);

  const loadDrafts = useCallback(
    async (seedId: string | null) => {
      if (!seedId) {
        setDrafts([]);
        setSelectedDraftId(null);
        return;
      }
      setLoadingDrafts(true);
      try {
        const response = await fetch(`/api/drafts?seedId=${seedId}`, { credentials: "include" });
        if (!response.ok) throw new Error("drafts_failed");
        const data = await response.json();
        const items = (data.items || []) as Draft[];
        setDrafts(items);
        if (items.length) {
          setSelectedDraftId((prev) => (prev && items.some((draft) => draft.id === prev) ? prev : items[0].id));
        } else {
          setSelectedDraftId(null);
        }
      } catch (err) {
        console.error(err);
        setMessage("Failed to load drafts");
      } finally {
        setLoadingDrafts(false);
      }
    },
    []
  );

  const loadDraftDetails = useCallback(
    async (draftId: string) => {
      try {
        const response = await fetch(`/api/drafts/${draftId}`, { credentials: "include" });
        if (!response.ok) throw new Error("draft_detail_failed");
        const data: { draft: Draft; audits: DraftAudit[] } = await response.json();
        setDraftDetails(data.draft);
        setDraftEditText(data.draft.editedText ?? data.draft.originalText);
        setDraftAuditTrail(data.audits || []);
        setValidationErrors([]);
      } catch (err) {
        console.error(err);
        setMessage("Unable to load draft details");
      }
    },
    []
  );

  async function validateDraftText(platform: string, text: string, signal?: AbortSignal) {
    setValidating(true);
    try {
      const response = await fetch(`/api/preview/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, text }),
        signal,
      });
      if (!response.ok) throw new Error("validation_failed");
      const result = await response.json();
      setValidationErrors(result.errors || []);
    } catch (err) {
      const error = err as { name?: string };
      if (error?.name === "AbortError") return;
      console.error(err);
      setValidationErrors(["Validation error"]);
    } finally {
      setValidating(false);
    }
  }

  useEffect(() => {
    loadSeeds();
  }, [loadSeeds]);

  useEffect(() => {
    async function fetchProviders() {
      try {
        const response = await fetch("/api/providers", { credentials: "include" });
        if (!response.ok) return;
        const data = await response.json();
        setProviders(data.providers || []);
      } catch (err) {
        console.error(err);
      }
    }
    fetchProviders();
  }, []);

  useEffect(() => {
    if (selectedSeed) {
      setEditForm({
        title: selectedSeed.title,
        notes: selectedSeed.notes ?? "",
        tags: selectedSeed.tags.join(", "),
      });
      setSelectedDraftId(null);
      setDraftDetails(null);
      setDraftAuditTrail([]);
      setDraftEditText("");
      setValidationErrors([]);
      loadDrafts(selectedSeed.id);
    } else {
      setEditForm({ title: "", notes: "", tags: "" });
      setSelectedDraftId(null);
      setDraftDetails(null);
      setDraftAuditTrail([]);
      setDraftEditText("");
      setValidationErrors([]);
      loadDrafts(null);
    }
    setGenerationSummary([]);
  }, [selectedSeed, loadDrafts]);

  useEffect(() => {
    if (!selectedDraftId) {
      setDraftDetails(null);
      setDraftAuditTrail([]);
      setDraftEditText("");
      setValidationErrors([]);
      return;
    }
    loadDraftDetails(selectedDraftId);
  }, [selectedDraftId, loadDraftDetails]);

  useEffect(() => {
    if (!draftDetails) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      validateDraftText(draftDetails.platform, draftEditText, controller.signal).catch((err) => {
        if (err?.name === "AbortError") return;
        console.error(err);
      });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [draftDetails, draftEditText]);

  async function createSeed() {
    if (!seedForm.title.trim()) {
      setMessage("Seed title is required");
      return;
    }
    setSavingSeed(true);
    setMessage(null);
    try {
      const token = await ensureCsrf();
      const tags = parseTagsInput(seedForm.tags);
      const body = {
        title: seedForm.title.trim(),
        notes: seedForm.notes.trim() || undefined,
        tags,
      };
      const response = await fetch("/api/seeds", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": token },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("create_failed");
      setSeedForm({ title: "", notes: "", tags: "" });
      setMessage("Seed captured");
      await loadSeeds();
    } catch (err) {
      console.error(err);
      setMessage("Unable to create seed");
    } finally {
      setSavingSeed(false);
    }
  }

  async function saveSeedEdits() {
    if (!selectedSeed) return;
    const patch: Record<string, unknown> = {};
    const normalizedTitle = editForm.title.trim();
    if (!normalizedTitle) {
      setMessage("Title cannot be empty");
      return;
    }
    if (normalizedTitle !== selectedSeed.title) {
      patch.title = normalizedTitle;
    }
    const normalizedNotes = editForm.notes.trim();
    if ((selectedSeed.notes ?? "") !== normalizedNotes) {
      patch.notes = normalizedNotes.length ? normalizedNotes : null;
    }
    const tagList = parseTagsInput(editForm.tags);
    if (!arraysEqual(tagList, selectedSeed.tags)) {
      patch.tags = tagList;
    }
    if (Object.keys(patch).length === 0) {
      setMessage("No changes to save");
      return;
    }
    setSavingSeed(true);
    setMessage(null);
    try {
      const token = await ensureCsrf();
      const response = await fetch(`/api/seeds/${selectedSeed.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": token },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("update_failed");
      setMessage("Seed updated");
      await loadSeeds();
    } catch (err) {
      console.error(err);
      setMessage("Unable to update seed");
    } finally {
      setSavingSeed(false);
    }
  }

  async function toggleSeedState() {
    if (!selectedSeed) return;
    setTogglingState(true);
    setMessage(null);
    try {
      const token = await ensureCsrf();
      const nextState: SeedState = selectedSeed.state === "draft" ? "ready" : "draft";
      const response = await fetch(`/api/seeds/${selectedSeed.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": token },
        credentials: "include",
        body: JSON.stringify({ state: nextState }),
      });
      if (!response.ok) throw new Error("state_failed");
      setMessage(`Marked seed as ${nextState}`);
      await loadSeeds();
    } catch (err) {
      console.error(err);
      setMessage("Unable to toggle seed state");
    } finally {
      setTogglingState(false);
    }
  }

  async function deleteSeed(seedId: string) {
    if (!window.confirm("Delete this seed? This cannot be undone.")) return;
    setDeletingSeed(true);
    setMessage(null);
    try {
      const token = await ensureCsrf();
      const response = await fetch(`/api/seeds/${seedId}`, {
        method: "DELETE",
        headers: { "CSRF-Token": token },
        credentials: "include",
      });
      if (!response.ok) throw new Error("delete_failed");
      setMessage("Seed deleted");
      await loadSeeds();
    } catch (err) {
      console.error(err);
      setMessage("Unable to delete seed");
    } finally {
      setDeletingSeed(false);
    }
  }

  async function saveDraftEdits() {
    if (!draftDetails) return;
    setSavingDraft(true);
    setMessage(null);
    try {
      const token = await ensureCsrf();
      const response = await fetch(`/api/drafts/${draftDetails.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": token },
        credentials: "include",
        body: JSON.stringify({ text: draftEditText }),
      });
      if (!response.ok) throw new Error("save_failed");
      const data = await response.json();
      const updatedDraft = data.draft as Draft;
      setDraftDetails(updatedDraft);
      setDraftAuditTrail(data.audits || []);
      setDrafts((prev) => prev.map((draft) => (draft.id === updatedDraft.id ? updatedDraft : draft)));
      setMessage("Draft updated");
    } catch (err) {
      console.error(err);
      setMessage("Unable to save draft edits");
    } finally {
      setSavingDraft(false);
    }
  }

  function resetDraftEdits() {
    if (!draftDetails) return;
    setDraftEditText(draftDetails.originalText);
  }

  function getConstraintsForPlatform(platform: string) {
    return providers.find((provider) => provider.key === platform)?.constraints;
  }

  async function cancelApproval() {
    if (!draftDetails?.approvalJob || draftDetails.approvalJob.status !== "pending") return;
    setUndoBusy(true);
    setMessage(null);
    try {
      const token = await ensureCsrf();
      const response = await fetch(`/api/approve/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": token },
        credentials: "include",
        body: JSON.stringify({ jobId: draftDetails.approvalJob.jobId, draftId: draftDetails.id }),
      });
      if (!response.ok) throw new Error("undo_failed");
      setMessage("Approval cancelled");
      await loadDraftDetails(draftDetails.id);
      if (selectedSeedId) await loadDrafts(selectedSeedId);
    } catch (err) {
      console.error(err);
      setMessage("Unable to cancel approval");
    } finally {
      setUndoBusy(false);
    }
  }

  async function generateDrafts(seedId: string) {
    setGenerating(true);
    setMessage(null);
    setGenerationSummary([]);
    try {
      const token = await ensureCsrf();
      const response = await fetch(`/api/drafts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": token },
        credentials: "include",
        body: JSON.stringify({ seedId, platforms }),
      });
      if (!response.ok) throw new Error("generate_failed");
      const payload = await response.json();
      const summary = (payload.results || []) as Array<{ platform: string; status: string; error?: string }>;
      setGenerationSummary(summary);
      const failures = summary.filter((result) => result.status === "failed");
      if (failures.length) {
        setMessage(`Generation issues on ${failures.length} platform${failures.length > 1 ? "s" : ""}`);
      } else {
        setMessage("Drafts generated");
      }
      if (payload.drafts) {
        const items = payload.drafts as Draft[];
        setDrafts(items);
        if (items.length) {
          setSelectedDraftId((prev) => (prev && items.some((draft) => draft.id === prev) ? prev : items[0].id));
        }
      } else {
        await loadDrafts(seedId);
      }
    } catch (err) {
      console.error(err);
      setMessage("Failed to generate drafts");
    } finally {
      setGenerating(false);
    }
  }

  async function approveDraft(draftId: string) {
    setMessage(null);
    try {
      const token = await ensureCsrf();
      const response = await fetch(`/api/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CSRF-Token": token },
        credentials: "include",
        body: JSON.stringify({ draftId, delayMs: 5000 }),
      });
      if (!response.ok) throw new Error("approve_failed");
      setMessage("Draft queued for publish");
    } catch (err) {
      console.error(err);
      setMessage("Unable to approve draft");
    }
  }

  return (
    <main style={{ display: "flex", minHeight: "100vh", background: "#fafafa" }}>
      <aside style={sidebarStyle}>
        <div>
          <h2 style={{ margin: "0 0 12px" }}>Seeds</h2>
          <input
            placeholder="Search"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc" }}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {STATE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setFilters((prev) => ({ ...prev, state: option.value }))}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: option.value === filters.state ? "1px solid #0a8" : "1px solid #ccc",
                background: option.value === filters.state ? "rgba(10,136,96,0.1)" : "#fff",
                color: option.value === filters.state ? "#0a8" : "#333",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 13, color: "#555" }}>Tags</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <TagChip
              label="All"
              active={!filters.tag}
              onClick={() => setFilters((prev) => ({ ...prev, tag: null }))}
            />
            {availableTags.map((tag) => (
              <TagChip
                key={tag}
                label={tag}
                active={filters.tag === tag}
                onClick={() => setFilters((prev) => ({ ...prev, tag }))}
              />
            ))}
          </div>
        </div>
        <section style={{ flex: 1, overflowY: "auto", display: "grid", gap: 8 }}>
          {loadingSeeds && <p style={{ color: "#666" }}>Loading seeds…</p>}
          {!loadingSeeds && seeds.length === 0 && <p style={{ color: "#666" }}>No seeds yet.</p>}
          {seeds.map((seed) => (
            <div
              key={seed.id}
              style={seed.id === selectedSeedId ? activeItemStyle : listItemStyle}
              onClick={() => setSelectedSeedId(seed.id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{seed.title}</strong>
                <StateBadge state={seed.state} />
              </div>
              {seed.tags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {seed.tags.map((tag) => (
                    <span key={tag} style={{ background: "#eef7f4", color: "#0a8", padding: "2px 8px", borderRadius: 999, fontSize: 11 }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <p style={{ margin: 0, color: "#777", fontSize: 12 }}>{formatTimestamp(seed.createdAt)}</p>
            </div>
          ))}
        </section>
      </aside>

      <section style={{ flex: 1, padding: 24, display: "grid", gap: 24 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, background: "#fff" }}>
          <h2 style={{ marginTop: 0 }}>Capture New Seed</h2>
          <div style={{ display: "grid", gap: 12 }}>
            <input
              placeholder="Seed title"
              value={seedForm.title}
              onChange={(e) => setSeedForm((prev) => ({ ...prev, title: e.target.value }))}
              style={inputStyle}
            />
            <textarea
              placeholder="Notes or context"
              value={seedForm.notes}
              onChange={(e) => setSeedForm((prev) => ({ ...prev, notes: e.target.value }))}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <input
              placeholder="Tags (comma separated)"
              value={seedForm.tags}
              onChange={(e) => setSeedForm((prev) => ({ ...prev, tags: e.target.value }))}
              style={inputStyle}
            />
            <button style={buttonPrimary} onClick={createSeed} disabled={savingSeed}>
              {savingSeed ? "Saving…" : "Add Seed"}
            </button>
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, background: "#fff" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <h2 style={{ margin: 0 }}>Seed Details</h2>
              {selectedSeed ? (
                <p style={{ margin: "4px 0", color: "#777" }}>Created {formatTimestamp(selectedSeed.createdAt)}</p>
              ) : (
                <p style={{ margin: "4px 0", color: "#777" }}>Select a seed to view details.</p>
              )}
            </div>
            {selectedSeed && (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={toggleSeedState} style={buttonSecondary} disabled={togglingState}>
                  {togglingState ? "Updating…" : selectedSeed.state === "draft" ? "Mark Ready" : "Mark Draft"}
                </button>
                <button onClick={() => deleteSeed(selectedSeed.id)} style={{ ...buttonSecondary, color: "#c00", borderColor: "#f5b5b5" }} disabled={deletingSeed}>
                  {deletingSeed ? "Deleting…" : "Delete"}
                </button>
              </div>
            )}
          </header>

          {selectedSeed && (
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <input
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                style={inputStyle}
              />
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
              />
              <input
                value={editForm.tags}
                onChange={(e) => setEditForm((prev) => ({ ...prev, tags: e.target.value }))}
                style={inputStyle}
              />
              <button style={buttonPrimary} onClick={saveSeedEdits} disabled={savingSeed}>
                {savingSeed ? "Saving…" : "Save Changes"}
              </button>
            </div>
          )}
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, background: "#fff" }}>
          <h2 style={{ marginTop: 0 }}>Draft Generation</h2>
          {selectedSeed ? (
            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <p style={{ margin: "0 0 8px", color: "#555" }}>Platforms</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {PLATFORM_OPTIONS.map((platform) => {
                    const checked = platforms.includes(platform);
                    return (
                      <label key={platform} style={{ fontSize: 14 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setPlatforms((prev) =>
                              e.target.checked ? Array.from(new Set([...prev, platform])) : prev.filter((value) => value !== platform),
                            )
                          }
                          style={{ marginRight: 6 }}
                        />
                        {platform}
                      </label>
                    );
                  })}
                </div>
              </div>
              <button style={buttonPrimary} onClick={() => generateDrafts(selectedSeed.id)} disabled={generating || platforms.length === 0}>
                {generating ? "Generating…" : "Generate Drafts"}
              </button>
              {generationSummary.length > 0 && (
                <div style={{ background: "#f7f7f7", borderRadius: 8, padding: 12, display: "grid", gap: 6 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>Latest Generation</h3>
                  {generationSummary.map((result) => (
                    <div key={result.platform} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span>{result.platform}</span>
                      <span style={{ color: result.status === "failed" ? "#c00" : result.status === "reused" ? "#777" : "#0a8" }}>
                        {result.status}
                        {result.error ? ` — ${result.error}` : ""}
                      </span>
                    </div>
                  ))}
                  {generationSummary.some((result) => result.status === "failed") && (
                    <button
                      style={{ ...buttonSecondary, fontSize: 12, padding: "6px 12px", justifySelf: "start" }}
                      onClick={() => {
                        const failed = generationSummary.filter((result) => result.status === "failed").map((result) => result.platform);
                        setPlatforms((prev) => Array.from(new Set([...failed])));
                        setMessage("Retry platforms reselected");
                      }}
                    >
                      Retry Failed Platforms
                    </button>
                  )}
                </div>
              )}
              <section>
                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Drafts</h3>
                {loadingDrafts && <p style={{ color: "#666" }}>Loading drafts…</p>}
                {!loadingDrafts && drafts.length === 0 && <p style={{ color: "#666" }}>No drafts yet for this seed.</p>}
                <div style={{ display: "grid", gap: 12 }}>
                  {drafts.map((draft) => {
                    const selected = draft.id === selectedDraftId;
                    return (
                      <article
                        key={draft.id}
                        onClick={() => setSelectedDraftId(draft.id)}
                        style={{
                          border: "1px solid",
                          borderColor: selected ? "#0a8" : "#eee",
                          borderRadius: 8,
                          padding: 12,
                          cursor: "pointer",
                          background: selected ? "rgba(10,136,96,0.05)" : "#fff",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <strong>{draft.platform}</strong>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              style={{ ...buttonSecondary, fontSize: 12, padding: "4px 10px" }}
                              onClick={(event) => {
                                event.stopPropagation();
                                approveDraft(draft.id);
                              }}
                            >
                              Approve
                            </button>
                          </div>
                        </header>
                        {draft.generatorMeta && (
                          <p style={{ margin: "4px 0", color: "#777", fontSize: 12 }}>
                            Generated {formatTimestamp(draft.generatorMeta.generatedAt)} {draft.generatorMeta.reused ? "(reused)" : ""}
                            {draft.generatorMeta.promptVersionId ? ` • Prompt ${draft.generatorMeta.promptVersionId.substring(0, 6)}` : ""}
                          </p>
                        )}
                        <p style={{ margin: 0, color: "#999", fontSize: 11 }}>
                          Updated {formatTimestamp(draft.updatedAt)}
                        </p>
                        <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 2, maxHeight: 140, overflow: "hidden" }}>
                          {(draft.editedText || draft.originalText).slice(0, 220)}
                          {((draft.editedText || draft.originalText).length ?? 0) > 220 ? "…" : ""}
                        </pre>
                      </article>
                    );
                  })}
                </div>
                {selectedDraftId && draftDetails && (
                  <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 16 }}>
                    {(() => {
                      const constraints = getConstraintsForPlatform(draftDetails.platform);
                      const max = constraints?.maxTextLength;
                      const charCount = draftEditText.length;
                      const remaining = typeof max === "number" ? max - charCount : null;
                      return (
                        <div style={{ display: "grid", gap: 16 }}>
                          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <h3 style={{ margin: 0, fontSize: 16 }}>Preview &amp; Edit — {draftDetails.platform}</h3>
                              <p style={{ margin: "4px 0", color: "#777", fontSize: 12 }}>
                                Original captured {formatTimestamp(draftDetails.createdAt)}
                              </p>
                            </div>
                            <div style={{ fontSize: 12, color: remaining !== null && remaining < 0 ? "#c00" : "#555" }}>
                              {max ? `${charCount}/${max} characters` : `${charCount} characters`}
                              {remaining !== null && remaining < 0 ? " — over limit" : ""}
                              {validating && " · validating…"}
                            </div>
                          </header>
                          {draftDetails.approvalJob && (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                background: "#eef7f4",
                                padding: "8px 12px",
                                borderRadius: 8,
                                fontSize: 12,
                                color: draftDetails.approvalJob.status === "pending" ? "#0a8" : "#777",
                              }}
                            >
                              <span>
                                Approval status: {draftDetails.approvalJob.status}
                                {draftDetails.approvalJob.status === "pending" && ` • ${formatCountdown(draftDetails.approvalJob.runAt)}`}
                              </span>
                              {draftDetails.approvalJob.status === "pending" && (
                                <button
                                  style={{ ...buttonSecondary, fontSize: 12, padding: "4px 10px" }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    cancelApproval();
                                  }}
                                  disabled={undoBusy}
                                >
                                  {undoBusy ? "Cancelling…" : "Undo"}
                                </button>
                              )}
                            </div>
                          )}
                          <div style={{ display: "grid", gap: 12 }}>
                            <div>
                              <h4 style={{ margin: "0 0 4px", fontSize: 13, color: "#555" }}>Original</h4>
                              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "#f7f7f7", padding: 12, borderRadius: 8 }}>{draftDetails.originalText}</pre>
                            </div>
                            <div>
                              <h4 style={{ margin: "0 0 4px", fontSize: 13, color: "#555" }}>Editable</h4>
                              <textarea
                                value={draftEditText}
                                onChange={(e) => setDraftEditText(e.target.value)}
                                rows={8}
                                style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
                              />
                              {validationErrors.length > 0 && (
                                <ul style={{ marginTop: 8, color: "#c00", fontSize: 12, paddingLeft: 20 }}>
                                  {validationErrors.map((error) => (
                                    <li key={error}>{error}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button style={buttonPrimary} onClick={saveDraftEdits} disabled={savingDraft}>
                                {savingDraft ? "Saving…" : "Save"}
                              </button>
                              <button style={buttonSecondary} onClick={resetDraftEdits}>
                                Reset to Original
                              </button>
                            </div>
                          </div>
                          <section>
                            <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>Change History</h4>
                            {draftAuditTrail.length === 0 ? (
                              <p style={{ color: "#777", fontSize: 12 }}>No edits recorded yet.</p>
                            ) : (
                              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                                {draftAuditTrail.map((entry) => (
                                  <li key={entry.id} style={{ background: "#f7f7f7", padding: 10, borderRadius: 8 }}>
                                    <p style={{ margin: 0, fontSize: 12, color: "#555" }}>
                                      {formatTimestamp(entry.createdAt)} — {entry.editor}
                                    </p>
                                    <pre style={{ marginTop: 4, whiteSpace: "pre-wrap", fontSize: 12 }}>{entry.editedText}</pre>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </section>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <p style={{ color: "#666" }}>Select a seed to generate drafts.</p>
          )}
        </div>

        {message && (
          <div style={{ padding: 12, borderRadius: 8, background: "#eef7f4", color: "#0a8" }}>{message}</div>
        )}
      </section>
    </main>
  );
}

function TagChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        borderRadius: 999,
        padding: "4px 10px",
        border: active ? "1px solid #0a8" : "1px solid #ccc",
        background: active ? "rgba(10,136,96,0.1)" : "#fff",
        color: active ? "#0a8" : "#333",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function StateBadge({ state }: { state: SeedState }) {
  const color = state === "ready" ? "#0a8" : "#555";
  const background = state === "ready" ? "rgba(10,136,96,0.1)" : "#eee";
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, color, background }}>{state}</span>
  );
}

function parseTagsInput(input: string): string[] {
  if (!input.trim().length) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  input
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = tag.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        tags.push(tag);
      }
    });
  return tags;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map((value) => value.toLowerCase()));
  const setB = new Set(b.map((value) => value.toLowerCase()));
  if (setA.size !== setB.size) return false;
  for (const value of setA) if (!setB.has(value)) return false;
  return true;
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #ccc",
  fontSize: 14,
  background: "#fff",
};

const buttonPrimary: CSSProperties = {
  background: "#0a8",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 14,
  cursor: "pointer",
};

const buttonSecondary: CSSProperties = {
  background: "#fff",
  color: "#333",
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 14,
  cursor: "pointer",
};

function formatTimestamp(value: number) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "Unknown";
  }
}

function formatCountdown(runAt: number) {
  const diff = runAt - Date.now();
  if (diff <= 0) return "due now";
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
