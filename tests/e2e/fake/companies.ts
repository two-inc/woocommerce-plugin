import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The companies the e2e fake answers company search and lookup with
 * (TWO-27195). The shop reads the same file, through
 * docker/mu-plugins/two-e2e-company-search.php, so a spec can name what it
 * expects to find.
 */
export type FakeCompany = {
  country: string;
  name: string;
  national_identifier: { id: string };
  lookup_id: string;
  addresses: Array<Record<string, string>>;
};

export const FAKE_COMPANIES: FakeCompany[] = JSON.parse(
  readFileSync(path.join(__dirname, "companies.json"), "utf8")
);

/** The fixture of that name; throws on a name no fixture carries, so a typo fails loudly. */
export function fakeCompany(name: string): FakeCompany {
  const company = FAKE_COMPANIES.find((c) => c.name === name);
  if (!company) throw new Error(`no fake company named ${name}`);
  return company;
}
