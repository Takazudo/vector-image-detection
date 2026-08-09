import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

it("provides a DOM test baseline for later library components", () => {
  render(<output aria-label="test readiness">DOM ready</output>);
  expect(screen.getByLabelText("test readiness").textContent).toBe("DOM ready");
});
