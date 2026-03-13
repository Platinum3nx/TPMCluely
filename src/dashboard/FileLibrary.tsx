import { useRef } from "react";

import type { KnowledgeFileRecord } from "../lib/types";

interface FileLibraryProps {
  files: KnowledgeFileRecord[];
  onSaveFile: (input: { name: string; mimeType: string; content: string }) => Promise<void>;
  onDeleteFile: (fileId: string) => Promise<void>;
}

export function FileLibrary({ files, onSaveFile, onDeleteFile }: FileLibraryProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileSelection(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) {
      return;
    }

    const content = await file.text();
    await onSaveFile({
      name: file.name,
      mimeType: file.type || "text/plain",
      content,
    });
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <article className="card">
      <div className="section-header">
        <p className="card-title">Knowledge Library</p>
        <span className="section-meta">{files.length} files</span>
      </div>

      <label className="field">
        <span>Add Reference File</span>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.json,.csv,.log"
          onChange={(event) => void handleFileSelection(event.target.files)}
        />
      </label>

      <div className="card-stack">
        {files.length === 0 ? (
          <div className="empty-block">
            <strong>No reference files yet</strong>
            <p>Add text-based notes, specs, or runbooks that future prompt/context flows can reference.</p>
          </div>
        ) : (
          files.map((file) => (
            <div key={file.id} className="session-list-item">
              <div>
                <strong>{file.name}</strong>
                <p>{file.excerpt || "No preview available."}</p>
                <span>{file.mimeType}</span>
              </div>
              <div className="toolbar-row">
                <button type="button" className="secondary-button" onClick={() => void onDeleteFile(file.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </article>
  );
}
