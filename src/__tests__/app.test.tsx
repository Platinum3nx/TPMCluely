import { render, screen } from "@testing-library/react";
import App from "../App";

describe("App shell", () => {
  it("renders the foundation hero after bootstrap", async () => {
    render(<App />);

    expect(await screen.findByText(/Session-first meeting intelligence/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^TPMCluely$/i })).toBeInTheDocument();
  });
});
