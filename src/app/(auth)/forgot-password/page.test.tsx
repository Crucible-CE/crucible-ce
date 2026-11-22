import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email/transport", () => ({ activeEmailTransport: h.transport }));

import ForgotPasswordPage from "./page";

beforeEach(() => vi.clearAllMocks());

describe("/forgot-password", () => {
  it("without email: no form, just who to ask", () => {
    h.transport.mockReturnValue(null);
    render(ForgotPasswordPage());
    expect(screen.getByTestId("no-email-notice")).toHaveTextContent(
      "Email isn't set up on this server. Ask an administrator to reset your password.",
    );
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send reset link" })).toBeNull();
  });

  it("with email: the usual form", () => {
    h.transport.mockReturnValue("smtp");
    render(ForgotPasswordPage());
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeInTheDocument();
    expect(screen.queryByTestId("no-email-notice")).toBeNull();
  });
});
