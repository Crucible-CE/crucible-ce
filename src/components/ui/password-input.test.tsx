// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordInput } from "./password-input";

describe("PasswordInput (C6)", () => {
  it("toggles between password and text, with an accessible label", () => {
    render(<PasswordInput id="pw" defaultValue="secret" />);
    const input = document.getElementById("pw") as HTMLInputElement;
    expect(input.type).toBe("password");

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", "pw");
    expect(toggle).toHaveAttribute("type", "button"); // never submits the form

    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  it("forwards Input props (required, autoComplete, onChange)", () => {
    render(<PasswordInput id="pw2" required autoComplete="new-password" placeholder="New password" />);
    const input = document.getElementById("pw2") as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(input.placeholder).toBe("New password");
  });
});
