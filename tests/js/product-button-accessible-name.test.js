/**
 * The product-page buy button's ACCESSIBLE NAME (TWO-25800).
 *
 * The button shows "Buy with" followed by the brand's mark, matching the
 * PayPal button the merchant asked us to match, which means the mark is the
 * only thing naming the brand. If it were decorative the control would
 * announce "Buy with" and nothing else, and that failure is invisible in a
 * screenshot, which is exactly how it would reach a merchant.
 *
 * The markup is read from fixtures the PHP suite writes as it renders, so this
 * runs against what the plugin actually emits rather than a copy of it. The
 * PHP spec fails if a committed fixture disagrees with what it rendered.
 */

const fs = require("fs");
const path = require("path");
const { computeAccessibleName } = require("dom-accessibility-api");

function buttonFrom(fixture) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", fixture), "utf8");
  document.body.innerHTML = html;
  const button = document.querySelector("button.twoinc-product-button");
  expect(button).not.toBeNull();
  return button;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the buy button's accessible name", () => {
  test("names the brand through the mark, with the text as the fragment before it", () => {
    const button = buttonFrom("product-button-with-mark.html");

    expect(button.textContent.trim()).toBe("Buy with");
    expect(computeAccessibleName(button)).toBe("Buy with Two");
  });

  test("names the brand as text where the brand ships no mark", () => {
    const button = buttonFrom("product-button-without-mark.html");

    expect(button.querySelector("img")).toBeNull();
    expect(computeAccessibleName(button)).toBe("Buy with Two");
  });

  test("a decorative mark would lose the brand, which is why it is not one", () => {
    const button = buttonFrom("product-button-with-mark.html");
    const mark = button.querySelector("img.twoinc-product-button__mark");

    expect(mark.getAttribute("alt")).toBe("Two");
    expect(mark.hasAttribute("aria-hidden")).toBe(false);

    // What the earlier, correct-at-the-time decision would give us now.
    mark.setAttribute("alt", "");
    mark.setAttribute("aria-hidden", "true");
    expect(computeAccessibleName(button)).toBe("Buy with");
  });
});
