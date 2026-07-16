import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppFooter } from "./app-footer";

describe("AppFooter", () => {
  it("renders the product version injected from VERSION", () => {
    const html = renderToStaticMarkup(<AppFooter />);

    expect(html).toContain(`v${__APP_VERSION__}`);
    expect(html).not.toContain("v1.0.0");
  });
});
