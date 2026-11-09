import { execFileSync } from "node:child_process";
import path from "node:path";

// The compose file sits at the repository root; COMPOSE_PROJECT_NAME, when CI sets one, picks the stack.
const ROOT = path.resolve(__dirname, "../..");

/** Runs WP-CLI against the shop under test, in the stack's own wpcli container. */
export function wp(...args: string[]): string {
  return execFileSync("docker", ["compose", "exec", "-T", "wpcli", "wp", ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

let wooCommerceVersionRead: number[] | null = null;

/** The shop's WooCommerce version as [major, minor, patch], read once. */
export function wooCommerceVersion(): number[] {
  if (!wooCommerceVersionRead) {
    wooCommerceVersionRead = wp("plugin", "get", "woocommerce", "--field=version")
      .trim()
      .split(".")
      .map((part) => parseInt(part, 10) || 0);
  }
  return wooCommerceVersionRead;
}

/** Whether the shop's WooCommerce is older than `major.minor`. */
export function wooCommerceBelow(major: number, minor: number): boolean {
  const [have, haveMinor] = wooCommerceVersion();
  return have < major || (have === major && haveMinor < minor);
}

export function setOption(name: string, value: string): void {
  wp("option", "update", name, value);
}

/** Undoes every cart shape and subscriber mode docker/mu-plugins/two-e2e-carts.php armed. */
export function resetCartShapes(): void {
  wp("eval-file", "/opt/tillit-payment-gateway/tests/e2e/provision/cart-shapes-reset.php");
}
