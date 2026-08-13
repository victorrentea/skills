# victor-skills

Public [Claude Code](https://claude.com/claude-code) skills by [Victor Rentea](https://victorrentea.ro).

## Install

```
/plugin marketplace add victorrentea/skills
/plugin install victor-skills@victor-skills
```

Then restart Claude Code (or `/plugin` → reload) and the skills below become available.

## Skills

| Skill | What it does |
|---|---|
| `/gratar` | Interviews you relentlessly about a plan, one numbered question at a time, before a line of code is written. Functional 🧑‍💼 → tester 🥷 → technical 🧑‍💻. |
| `grilling` | Same stress-test, but auto-triggered by phrases like "grill me on this design". |
| `db` | Blocks any index/migration/query advice until the real schema has been inspected. No recommendations from memory. |
| `jmeter` | Turns "hit this endpoint with 50 threads" into a JMX test plan and opens it in the JMeter GUI. |
| `tooltips` | Rules for adding or restyling hover hints in a web UI — fires even on a bare `title=` attribute. |
| `why` | Reconstructs *why* Claude did what it did, from the session transcript and captured reasoning summaries. |
| `scribd-to-pdf` | Captures a public Scribd document into a single PDF via headless Chromium. |

## Requirements

- `jmeter` — JMeter on your `PATH`, or `JMETER_HOME` set.
- `scribd-to-pdf` — `pip install playwright pillow` + `playwright install chromium`.

## License

MIT
