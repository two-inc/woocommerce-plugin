---
description: "Rules for readme.txt changelog and upgrade-notice entries, which are merchant copy on the public wordpress.org listing."
---

# readme.txt changelog entries are merchant copy on the public listing

`readme.txt`'s `== Changelog ==` and `== Upgrade Notice ==` render on the
wordpress.org listing, and the upgrade notice is what a merchant sees in their
admin when the update is offered. Merchant copy, not an engineering changelog.

- **No Linear ticket ids and no internal references.** They mean nothing to a
  merchant and this listing is public.
- **Describe changes against the last RELEASED version, not against
  development.** A bug introduced and fixed while a feature was being built is
  not news: nobody ever had it. `git grep -l <feature> <previous-tag>` settles
  whether the feature shipped before.
- **Write what changes in their shop**, then what it means for them, naming
  real admin paths. Not a feature name, not a commit subject.
- **A release with nothing merchant-visible says so** ("maintenance release")
  rather than dressing up a chore.
- The sections wordpress.org recognises are `== Description ==`,
  `== Installation ==`, `== Frequently Asked Questions ==`, `== Screenshots ==`,
  `== Changelog ==`, `== Upgrade Notice ==`. A Markdown `##` heading is not a
  section: it renders inside whichever section precedes it, which is why the
  whole listing was one Description block until 2.24.0.

`release.yml` builds the GitHub Release body with `--generate-notes`, which is
a pull request list for engineers and separate from the above.
