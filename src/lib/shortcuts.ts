function normalizeKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized === "esc") {
    return "escape";
  }
  if (normalized === "space") {
    return " ";
  }
  return normalized;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const tokens = shortcut
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return false;
  }

  let expectsShift = false;
  let expectsAlt = false;
  let expectsMeta = false;
  let expectsCtrl = false;
  let expectsCommandOrControl = false;
  let expectedKey = "";

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    switch (normalized) {
      case "shift":
        expectsShift = true;
        break;
      case "alt":
      case "option":
        expectsAlt = true;
        break;
      case "meta":
      case "cmd":
      case "command":
        expectsMeta = true;
        break;
      case "ctrl":
      case "control":
        expectsCtrl = true;
        break;
      case "cmdorctrl":
      case "commandorcontrol":
        expectsCommandOrControl = true;
        break;
      default:
        expectedKey = normalizeKey(normalized);
        break;
    }
  }

  if (expectsShift && !event.shiftKey) {
    return false;
  }
  if (expectsAlt && !event.altKey) {
    return false;
  }
  if (expectsMeta && !event.metaKey) {
    return false;
  }
  if (expectsCtrl && !event.ctrlKey) {
    return false;
  }
  if (expectsCommandOrControl && !(event.metaKey || event.ctrlKey)) {
    return false;
  }

  if (!expectedKey) {
    return false;
  }

  return normalizeKey(event.key) === expectedKey;
}

export function normalizeGlobalShortcut(shortcut: string): string {
  return shortcut.replace(/cmdorctrl/gi, "CommandOrControl");
}
