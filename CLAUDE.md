# CLAUDE.md

## Checking consumers after a release

`vars.PI_REVIEW_MODELS` resolves against the **caller** repo (and its org), not this
repo, and the `v1` tag auto-advances to `main` on every push. So after cutting a
release only SHA-pinned consumers need a bump.

Find every consumer:

```bash
for O in hivemq hivemq-cloud; do
  gh api -X GET "search/code?q=hivemq-pi-review-action+org:$O&per_page=100" \
    --jq '.items[] | "\(.repository.full_name)  \(.path)"'
done
```

For each hit, read the pinned ref and any model override:

```bash
gh api "repos/$REPO/contents/$FILE" --jq '.content' | base64 -d \
  | grep -oE 'uses: hivemq/hivemq-pi-review-action[^@]*@[A-Za-z0-9._-]+'
gh api "repos/$REPO/actions/variables/PI_REVIEW_MODELS" --jq '.value'
```

- `@v1` → already on `main`, nothing to do.
- `@<sha>` → open a PR bumping the SHA and the trailing `# vX.Y.Z` comment (and any
  `# Pinned to the vX.Y.Z commit SHA` prose above it).
- A `PI_REVIEW_MODELS` override pins models explicitly, so a default-model change
  does not reach that repo — check the override value before assuming it does.

Org-level variables need `admin:org`; without it `gh api orgs/hivemq/actions/variables`
returns 403 and an org-wide override would be invisible to this check.
