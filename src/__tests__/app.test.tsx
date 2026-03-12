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
    render(<App />);

    expect(await screen.findByText(/Session-first meeting intelligence/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "K", metaKey: true, shiftKey: true });

    expect(await screen.findByText(/Shortcut First/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start (Listening|Session)/i })).toBeInTheDocument();
  });

  it("shows screen sharing controls after starting a manual listening session", async () => {
    render(<App />);

    expect(await screen.findByText(/Session-first meeting intelligence/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "K", metaKey: true, shiftKey: true });
    fireEvent.click(await screen.findByRole("button", { name: /Start Session/i }));

    expect(await screen.findByRole("button", { name: /Share Screen/i })).toBeInTheDocument();
    expect(screen.getByText(/Transcript grounded/i)).toBeInTheDocument();
  });
});
