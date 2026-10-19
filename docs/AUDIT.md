# Legacy audit and reconstruction record

## Scope reviewed

- Original commit: `39fe345d362fb860ec2a6968958a65e634af5fa9`
- Original tracked files: 67
- Active Discord reference: `llms-full.txt`
- Reference size: 2,832,560 bytes and 47,168 newline-terminated lines
- Reference SHA-256:
  `89240dedfcd681954a8bdc46ac1750741b6ba537e6444e769563700a92e4123a`
- Original public commands: 39
- Original provider integrations: 11

The full Discord reference was streamed, hashed, and indexed across all 3,293
headings. Implementation-critical sections were then cross-checked directly:
Gateway lifecycle and intents, Gateway events and close codes, application
command objects and bulk overwrite routes, interaction objects and callbacks,
the three-second acknowledgement deadline, component structures and custom ID
limits, message embeds and attachments, multipart uploads, OAuth2 permissions,
and REST rate limits.

## Legacy issues identified

1. The active runtime was built entirely on `discord.js`, contrary to the new
   direct-API constraint.
2. Nineteen media commands were not registered with Discord's `nsfw` flag or
   modern installation/context fields, even though a runtime check attempted
   to restrict them.
3. Sixteen copied command templates referenced provider functions they had not
   imported. Most branches were currently unreachable, but a source-list edit
   could turn them into immediate `ReferenceError` failures.
4. `handler/commands.js` called `logWarn` without importing it.
5. The package test script always exited with failure and provided no tests.
6. Package repository, issue, homepage, description, author, and license
   metadata did not match the actual repository or root MIT license.
7. The NekoBot authorization value was hard-coded in public source and docs.
8. N-SFW downloads disabled certificate validation automatically.
9. Oboobs and Obutts use plaintext HTTP endpoints.
10. Provider selection made one attempt and returned an error instead of
    falling back to another configured source.
11. The command modules contained large repeated dispatch blocks with
    unreachable branches, making endpoint parity difficult to audit.
12. Gateway behavior, reconnection, heartbeat state, and REST rate limiting
    were delegated to the wrapper and therefore absent from repository-owned
    code.
13. The old `GuildMessages` intent omitted direct-message dispatches, while the
    mention handler and documentation implied broader context support.
14. `.gitignore` excluded only `node_modules/`, leaving caches, bytecode,
    generated media, logs, archives, and build artifacts exposed to accidental
    commits.

## Reconstruction decisions

- Every original tracked item except `llms-full.txt` was moved to
  `archive/legacy/` with its relative path and bytes unchanged.
- Every public command was recreated in its own source file.
- All media commands now carry `nsfw: true`, guild/user installation types, and
  guild/bot-DM/private-channel contexts.
- The active `/cosplay` extension adds two feed-only scraper transports without
  modifying the byte-for-byte legacy archive or its parity baseline.
- The active `/buttplug` Real group adds one PornPics cover-feed transport;
  parity still requires the archived N-SFW call in its Anime group.
- Original endpoint categories, query parameters, provider headers, style
  groups, and command choice values are covered by executable parity tests.
- The hard-coded NekoBot value became a secret-manager environment variable.
- N-SFW now reads only `url_japan` and downloads from its exact Osaka hostname.
  That host may tolerate only `CERT_HAS_EXPIRED` after a separate hostname
  identity check; all other trust failures remain blocked and no global
  insecure-TLS switch exists.
- Media is never persisted to the repository or runtime filesystem.
- The current 10 MiB Discord default attachment limit is used while honoring a
  lower per-interaction `attachment_size_limit`.

## Verification contract

`npm run validate` must pass before publication. It verifies:

- no binary or generated artifact is present;
- no active high-level Discord wrapper import exists;
- the complete archive matches the original commit byte-for-byte;
- all active JavaScript parses;
- all 41 active public commands load exactly once;
- every media command has modern age/context metadata;
- every legacy command option and provider category is retained;
- raw REST authorization, 429 retry, and error behavior;
- raw Gateway URL, identify/resume payload, and close-code behavior;
- modal, autocomplete, option, and component-state parsing;
- provider-specific NekoBot and Waifu.im header/query contracts.

## Follow-up runtime verification

The second verification pass executes every archived media command with
mocked Discord builders and provider transports. Explicit option groups and
the archived random source ranges are exercised, and the reachable provider
calls are compared directly with each modern command declaration. Separate
provider contract tests cover all 11 archived transports plus both active
cosplay feeds and the active PornPics cover feed, including query objects,
headers, response fields, random ranges, DNS/SNI routing, retry counts, feed
parsing, URL promotion, native-attachment rendering, and blocked-payload
rejection behavior.

This pass also hardened interaction handling against duplicate Gateway
dispatches, ambiguous callback retries, expired tokens, legacy refresh IDs,
and detached promise rejections. See `COMMAND_PARITY.md` and
`TROUBLESHOOTING.md` for the resulting evidence and operational guidance.
