import { useEffect, useState } from "react";

import type { PromptRecord } from "../lib/types";

interface PromptLibraryProps {
  prompts: PromptRecord[];
  onSavePrompt: (input: { id?: string; name: string; content: string; isDefault?: boolean; makeActive?: boolean }) => Promise<void>;
  onDeletePrompt: (promptId: string) => Promise<void>;
}

export function PromptLibrary({ prompts, onSavePrompt, onDeletePrompt }: PromptLibraryProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [makeActive, setMakeActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (!editingId) {
      return;
    }

    const prompt = prompts.find((entry) => entry.id === editingId);
    if (!prompt) {
      setEditingId(null);
      return;
    }

    setName(prompt.name);
    setContent(prompt.content);
    setMakeActive(prompt.isActive);
    setIsDefault(prompt.isDefault);
  }, [editingId, prompts]);

  async function handleSubmit() {
    if (!name.trim() || !content.trim()) {
      return;
    }

    await onSavePrompt({
      id: editingId ?? undefined,
      name,
      content,
      isDefault,
      makeActive,
    });

    setEditingId(null);
    setName("");
    setContent("");
    setMakeActive(true);
    setIsDefault(false);
  }

  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Prompt Library</p>
        <span className="section-meta">{prompts.length} prompts</span>
      </div>

      <div className="card-stack">
        <label className="field">
          <span>Prompt Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Incident risk coach" />
        </label>
        <label className="field">
          <span>Prompt Content</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Favor concise, risk-aware answers with explicit owners and rollout caveats."
            rows={5}
          />
        </label>
        <div className="toggle-list">
          <button
            type="button"
            className={`toggle-card ${makeActive ? "toggle-card-on" : ""}`}
            onClick={() => setMakeActive((current) => !current)}
          >
            <div>
              <strong>Make Active</strong>
              <p>New sessions will snapshot this prompt when they start.</p>
            </div>
            <span>{makeActive ? "On" : "Off"}</span>
          </button>
          <button
            type="button"
            className={`toggle-card ${isDefault ? "toggle-card-on" : ""}`}
            onClick={() => setIsDefault((current) => !current)}
          >
            <div>
              <strong>Default Prompt</strong>
              <p>Mark this as the library default for future edits and onboarding.</p>
            </div>
            <span>{isDefault ? "On" : "Off"}</span>
          </button>
        </div>
        <div className="toolbar-row">
          <button type="button" onClick={() => void handleSubmit()}>
            {editingId ? "Update Prompt" : "Create Prompt"}
          </button>
          {editingId ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setEditingId(null);
                setName("");
                setContent("");
                setMakeActive(true);
                setIsDefault(false);
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="card-stack">
        {prompts.length === 0 ? (
          <div className="empty-block">
            <strong>No custom prompts yet</strong>
            <p>Create a prompt to shape future sessions without rewriting the app-wide system prompt.</p>
          </div>
        ) : (
          prompts.map((prompt) => (
            <div key={prompt.id} className="session-list-item">
              <div>
                <strong>{prompt.name}</strong>
                <p>{prompt.content}</p>
                <span>
                  {prompt.isActive ? "Active" : "Inactive"}
                  {prompt.isDefault ? " · Default" : ""}
                </span>
              </div>
              <div className="toolbar-row">
                <button type="button" className="secondary-button" onClick={() => setEditingId(prompt.id)}>
                  Edit
                </button>
                <button type="button" className="secondary-button" onClick={() => void onDeletePrompt(prompt.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </article>
  );
}
