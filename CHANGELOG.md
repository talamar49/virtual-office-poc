# 📋 Changelog

> Generated automatically from conventional commits
> Last updated: 2026-03-16

## [Unreleased] — 2026-03-16

### ✨ Features

- agent mood system — emoji expressions based on state ([`f8b0dab`](https://github.com/talamar49/virtual-office-poc/commit/f8b0dab6e1a28323b0e1311d6798d578c67dda60))
- export office state as PNG or PDF ([`8c3dd03`](https://github.com/talamar49/virtual-office-poc/commit/8c3dd03e1a19552de924b0748417f755bb81ce2a))
- agent grouping with drag & drop + group management UI ([`5f20bc9`](https://github.com/talamar49/virtual-office-poc/commit/5f20bc9e10b5c00f3c82a528f5fc92daa46022fe))
- V8 characters (33 sprites) + mini-map + hover tooltip ([`47cf46e`](https://github.com/talamar49/virtual-office-poc/commit/47cf46e289f4535d2333cfaba6602dc1c355aa71))
- search/filter agents + keyboard shortcuts + shortcuts modal ([`06dc35f`](https://github.com/talamar49/virtual-office-poc/commit/06dc35f4bf3474c33bea8314ee3aa11b74b445ac))
- Dockerfile + docker-compose.yml + fix @types/multer ([`a6dccd4`](https://github.com/talamar49/virtual-office-poc/commit/a6dccd4bffc29c35485f1bd822e4b1e44d184347))
- 6-tier scaling system (XS→XXL) — auto-resize office by agent count ([`36a1306`](https://github.com/talamar49/virtual-office-poc/commit/36a1306d439fc502c67afc474851d03fdb4d225a))
- dynamic office scaling (XS→XXL) + max cap warning ([`b9cd84e`](https://github.com/talamar49/virtual-office-poc/commit/b9cd84ecf2839eb2b1af0781069261f5251722da))
- v6 complete — cubicle_work, lounge_sofa, coffee_station + oriented walls ([`6827259`](https://github.com/talamar49/virtual-office-poc/commit/682725961ea49405bc242d066f05a16c42594a07))
- UI sprites — room signs, status icons, coffee mug ([`145478a`](https://github.com/talamar49/virtual-office-poc/commit/145478a70ce2141d47c7ffe7b32b32129a34378b))
- v7 character sprites — 64×64 with shadow, v7→legacy fallback chain ([`dd75fd3`](https://github.com/talamar49/virtual-office-poc/commit/dd75fd3d25526bacb62befdddfe5dbae91259eb6))
- v6 asset system — sprite-based tiles, room walls, per-room furniture placement ([`a129bab`](https://github.com/talamar49/virtual-office-poc/commit/a129bab1b13765460fbca24ad7969383a3136114))
- drag & drop seating — custom agent seat assignments ([`68179de`](https://github.com/talamar49/virtual-office-poc/commit/68179ded39002959d14ac98d85392284a31b4d22))
- amir's v4 hires assets (cubicle, coffee, lounge, meeting, reception, server rack) ([`7b19b6d`](https://github.com/talamar49/virtual-office-poc/commit/7b19b6dfefee51cd25a6db626e98c2f935f02805))
- agent pathfinding — L-shape waypoint movement between rooms ([`c617f26`](https://github.com/talamar49/virtual-office-poc/commit/c617f2653bebb55c22acee29b82d22d42bb2ef85))
- mirror Chat UI messages to Discord channel — user messages appear in agent's Discord channel ([`55faed0`](https://github.com/talamar49/virtual-office-poc/commit/55faed0ef373287dd11e8638372d0d59ddd8570e))
- desktop zoom + pan — scroll to zoom, drag to pan, shift+scroll horizontal pan ([`a2feae6`](https://github.com/talamar49/virtual-office-poc/commit/a2feae6703eec331d14163097349e2553e582201))
- vo CLI tool (install/update/config/status/logs) + README docs ([`d7057de`](https://github.com/talamar49/virtual-office-poc/commit/d7057defaa794157545dd6b9bd614bd0553759d4))
- auto-detect Gateway token + URL from ~/.openclaw/openclaw.json ([`9a0d984`](https://github.com/talamar49/virtual-office-poc/commit/9a0d9842c462388817c4946cb7c66803e44cdecd))
- voice + attachments + i18n + loading (#8) ([`2fc1adf`](https://github.com/talamar49/virtual-office-poc/commit/2fc1adfae9be3b1466692383d2215c99319ff9d5))
- i18n + loading animation + chat fixes (#7) ([`78da012`](https://github.com/talamar49/virtual-office-poc/commit/78da01254b6f7855143b3d5d993b16d384851725))
- chat UI improvements (#4) ([`5501cd7`](https://github.com/talamar49/virtual-office-poc/commit/5501cd7bf64ae6f1bf05469a80f650c02873fe76))
- Heebo font + ExpandableTask + right wall + floor zones ([`ccb0663`](https://github.com/talamar49/virtual-office-poc/commit/ccb0663e26a38d99ba09ca352345302804452347))
- improved task bubble design + show for idle agents ([`ff2a2be`](https://github.com/talamar49/virtual-office-poc/commit/ff2a2be239866ab60a7492ad51a30d86fc19f976))
- dynamic WORK_AGENTS_PER_ROW based on agent count ([`c3f946f`](https://github.com/talamar49/virtual-office-poc/commit/c3f946f5966e27ff7858281eb368d88012a5ab55))
- amir's sitting character sprites (all agents) + docs + reports ([`d6c6011`](https://github.com/talamar49/virtual-office-poc/commit/d6c601149119ffd216ab1ecda8bfd0e2cc79cf3e))
- bidirectional chat — poll agent responses and show in bubbles ([`76bdc6e`](https://github.com/talamar49/virtual-office-poc/commit/76bdc6e601056ee57d3617e6e31c4b2295c04d78))
- space out office layout — 20×16 grid, wider cubicle + lounge spacing ([`77eb39c`](https://github.com/talamar49/virtual-office-poc/commit/77eb39c01b24330ff580ec9155fb7767d44a18b7))
- noa's Chat UI component + amir asset updates ([`7af9b40`](https://github.com/talamar49/virtual-office-poc/commit/7af9b406323aa139e41dfb84171541276a49018f))
- amir's upgraded assets — 46 files (decorations, furniture, tiles) ([`4800e1e`](https://github.com/talamar49/virtual-office-poc/commit/4800e1ed8ccab0985e5edabd063ad34d640c61f3))
- wire up chat-to-agent from detail panel ([`6a4437c`](https://github.com/talamar49/virtual-office-poc/commit/6a4437ca5b026058c2ef35951a8540ae5430bb62))
- Virtual Office POC — isometric pixel art with dynamic agent discovery ([`e44dafc`](https://github.com/talamar49/virtual-office-poc/commit/e44dafc9541ab3ff5baf648fa45e7c7ce4526bed))

### 🐛 Bug Fixes

- agents face south (toward camera) — desks placed 1 row north behind agent ([`73509e1`](https://github.com/talamar49/virtual-office-poc/commit/73509e17f6491dc8599ecfd3d6b6db1b49781feb))
- agent seat overlap — per-room allocation + collision detection ([`75a65fc`](https://github.com/talamar49/virtual-office-poc/commit/75a65fcba925b3c735c9836eda5fedaf31b5973c))
- SPRITE_SIZE=64 + wall orientation (north/east variants) ([`3a59fc8`](https://github.com/talamar49/virtual-office-poc/commit/3a59fc83a4ae802e0eaad8636bc6cee25e02b4c2))
- chat dedup actually works — deduplicateMessages by text+role, applied everywhere ([`f9f863b`](https://github.com/talamar49/virtual-office-poc/commit/f9f863bbb5f37379e04d59fc6a1c33d25d6f4fd3))
- invalid token no longer freezes on loading — shows error + redirects to settings after 3 failures ([`0981c94`](https://github.com/talamar49/virtual-office-poc/commit/0981c94673a7af1052dd84ededa7ede630685ad8))
- replace Press Start 2P pixel font with Heebo — readable in both Hebrew and English ([`d351c3b`](https://github.com/talamar49/virtual-office-poc/commit/d351c3b4f15c2379314e49ab058299ddca5715f9))
- eliminate ALL hardcoded Hebrew — buttons, zone labels, edit mode, sound, send, expand/collapse all use i18n ([`63a5d9b`](https://github.com/talamar49/virtual-office-poc/commit/63a5d9b9a67e7c02c30af612f79500e0000b0ae9))
- complete i18n — all hardcoded Hebrew now bilingual (state labels, time ago, decorations, task, notifications) ([`f2de98f`](https://github.com/talamar49/virtual-office-poc/commit/f2de98f15a2d34e89273f6f4b59c96ddc50cf68e))
- i18n actually works — state labels, agent cards, direction all respond to language toggle ([`57b7a56`](https://github.com/talamar49/virtual-office-poc/commit/57b7a566678168c22a9eea266405388877bb22ca))
- grid shrink + walk sprites + cubicle sprites (#6) ([`7db579a`](https://github.com/talamar49/virtual-office-poc/commit/7db579a3fc590e2a0e0188c96b81906ee4729dcb))
- floor render uses FLOOR_MAP dimensions, better debug logging ([`652a3ec`](https://github.com/talamar49/virtual-office-poc/commit/652a3ec84f1f790c5231a00c1040163254e58a2d))
- prefer discord sessions for chat routing + internal msg filter on history endpoint ([`d104ebb`](https://github.com/talamar49/virtual-office-poc/commit/d104ebbec3d6c146e024132c2ef5ae4e6374e307))
- stable fixedIndex via sorted IDs, rebuild spots on every buildAgents, debug logging ([`946a97c`](https://github.com/talamar49/virtual-office-poc/commit/946a97cb3d3473bfa9a25baa5eac022a23a8af7c))
- filter internal messages (announce/heartbeat/no_reply) from chat UI + dedup helper ([`1d5378c`](https://github.com/talamar49/virtual-office-poc/commit/1d5378c529bf7c2feafe8e7c9c4c53065cc214c9))
- restore Noa layout (#5) ([`fdb5ca2`](https://github.com/talamar49/virtual-office-poc/commit/fdb5ca2b291b7b214b1b9cc5dc735e621db1a61c))
- dynamic cubicle assignment — 3-row layout without overlap (#3) ([`7ba90d0`](https://github.com/talamar49/virtual-office-poc/commit/7ba90d0bded0f9291cb028240a0344d2ef16d3f0))
- layout lounge overlap — prevent cubicle/lounge zone collision (#2) ([`55ad6e3`](https://github.com/talamar49/virtual-office-poc/commit/55ad6e301277b2628d57c04f5c51c9698fc7f9cd))
- layout lounge overlap — prevent cubicle/lounge zone collision (#1) ([`a5ad52b`](https://github.com/talamar49/virtual-office-poc/commit/a5ad52b1270a29159ed01be977cb93f01dd47a5f))
- proxy params→args — task label now shows correctly ([`d182878`](https://github.com/talamar49/virtual-office-poc/commit/d18287894bac38b6d5d0780176bee3eb735e7bc7))
- empty task label in detail panel — add state-based fallbacks ([`9772e70`](https://github.com/talamar49/virtual-office-poc/commit/9772e7022b464ca0579bc818cdfeb13aad178f3c))
- 3 high-priority bugs ([`994480e`](https://github.com/talamar49/virtual-office-poc/commit/994480e0ae4519d37d89c1cac7ab0769b2600e9f))
- touch drag also uses in-place mutation (prevents crash on mobile) ([`c6be2ab`](https://github.com/talamar49/virtual-office-poc/commit/c6be2ab95c6b6786f368df1094efc87b6b5df2e0))
- detail panel now updates agent task in real-time from polling ([`e116abe`](https://github.com/talamar49/virtual-office-poc/commit/e116abe3e793366e91e89d4b843c913a911058ac))
- agent click — nearest-agent approach replaces bounding-box hit test ([`b823e35`](https://github.com/talamar49/virtual-office-poc/commit/b823e359c1eb98d908061b827e48e224b6f77f6a))
- drag decoration uses ref mutation instead of setState on mousemove ([`e6e34c2`](https://github.com/talamar49/virtual-office-poc/commit/e6e34c2d2bba4d20a6a291640bb2cb9153679fa2))
- add .gitignore, remove node_modules and dist from tracking ([`cf87d89`](https://github.com/talamar49/virtual-office-poc/commit/cf87d89d7b527de5aad93e08c9bd15667588398c))

### ⚡ Performance

- faster polling (2s) with change detection, remove Vercel deploy plan ([`d9c293a`](https://github.com/talamar49/virtual-office-poc/commit/d9c293ad8002486b62e198a1c16f21e4127f81b9))
- fix decoration drag crash — in-place mutation during drag, no allocations ([`ce8f562`](https://github.com/talamar49/virtual-office-poc/commit/ce8f562f2423262a8917ad35d8d2271ccdb39c4e))

### 📝 Documentation

- one-liner install.sh + updated README with systemd auto-restart ([`2b1ee6c`](https://github.com/talamar49/virtual-office-poc/commit/2b1ee6caa9ac877f469724897303336e3b1b4b65))
- add comprehensive README + server/.env.example ([`299da75`](https://github.com/talamar49/virtual-office-poc/commit/299da75c0113aaaa6d943c0744f16361db0d03fd))

### ♻️ Refactoring

- horizontal zone layout — lounge(top) → work(middle) → errors(bottom), scales to 50+ agents ([`1d184ff`](https://github.com/talamar49/virtual-office-poc/commit/1d184ffe16fae704c8255464c665e9781a36b151))
- fully dynamic office — no hardcoded agents, grid scales with agent count ([`bf41470`](https://github.com/talamar49/virtual-office-poc/commit/bf41470e660e79d3330daf59a23550fa62267189))

### 🔧 Chores

- amir's v7 walk sprites update ([`6b5fb6f`](https://github.com/talamar49/virtual-office-poc/commit/6b5fb6f63db9de820cab4612af78e5b6c8b700cd))
- amir's new character sprites + server updates ([`370a545`](https://github.com/talamar49/virtual-office-poc/commit/370a545714bcc123b5d5c93c54394804227a4695))
- add amir's pixel art assets + agent detail panel fix (e116abe) ([`48503a0`](https://github.com/talamar49/virtual-office-poc/commit/48503a076a52b74a9f44cb1dbc58b7d9c95cc405))

### 🚀 CI/CD

- add GitHub Actions pipeline (tsc + vite build) ([`2ce8735`](https://github.com/talamar49/virtual-office-poc/commit/2ce87358b035a510e73b82983ad9a2d7fcc83698))

### 📌 Other

- remove exposed gateway token + personal paths (#4) ([`e144fd9`](https://github.com/talamar49/virtual-office-poc/commit/e144fd9c9c7d6f4b1035c015e2c84d527d8ab418))
- replace personal username with openclaw org in all URLs ([`d6efd17`](https://github.com/talamar49/virtual-office-poc/commit/d6efd17f136ec055e2fea6c06dc395e91451f8d9))
- [fix] chat backend v2 — session priority, after-based polling, server-side filter ([`9b2c206`](https://github.com/talamar49/virtual-office-poc/commit/9b2c206ef53401aeb6ea6c27058e87a26774a8c6))

