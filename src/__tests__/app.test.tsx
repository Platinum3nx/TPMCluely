import { fireEvent, render, screen } from "@testing-library/react";
import App from "../App";

describe("App shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the foundation hero after bootstrap", async () => {
    render(<App />);

    expect(await screen.findByText(/Session-first meeting intelligence/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^TPMCluely$/i })).toBeInTheDocument();
  });

  it("opens the listening overlay from the keyboard shortcut before a session exists", async () => {
    window.localStorage.setItem(
      "cluely.desktop.secrets",
      JSON.stringify({
        deepgram_api_key: "test-deepgram",
        gemini_api_key: "test-gemini",
      })
    );

    render(<App />);

    expect(await screen.findByText(/Session-first meeting intelligence/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "K", metaKey: true, shiftKey: true });

    expect(await screen.findByText(/Shortcut First/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start Listening/i })).toBeInTheDocument();
  });
});
